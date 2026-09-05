import { type ChildProcess, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import * as Schema from "effect/Schema";
import { FleetService } from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import {
  ProjectGitHubService,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import {
  agentProviders,
  managedComputerSetupProviders,
  normalizeAddedProviders,
} from "../src/lib/agent-provider";
import {
  configDirectory,
  gitValueAt,
  loadConfig,
  saveConfig,
} from "./command-support";
import {
  addedAgentProviders,
  type Config,
  type TeamConfig,
} from "./config-contract";
import { createAuthenticatedConnectClient } from "./connect-client";
import { providerAuthenticated } from "./managed-computer-setup-agent";
import { configuredComputerUseAssignmentPath } from "./computer-use-desktop-manager";
import { runWorkerSupervisor } from "./managed-computer-supervisor";
import {
  ensureRepository,
  runSimpleCommand,
} from "./project-repository-bootstrap";
import { SANDBOX_NOVNC_PORT, SANDBOX_NOVNC_TOKEN_FILE, SANDBOX_SCHEMA_VERSION } from "./sandbox-image";
import {
  registerProjectExecutionWorker,
  unregisterTeamExecutionWorker,
} from "./worker-commands";

/**
 * In-container half of the Docker sandbox.
 *
 * `briar sandbox up` pipes one JSON payload into `briar sandbox bootstrap`
 * over `docker exec` stdin, so no credential is ever written to the Docker
 * host. The payload carries the owner's Briar session, every project the
 * sandbox should serve, and optional provider credentials that can be copied
 * verbatim (Codex keeps a plain file; Claude Code on macOS keeps its token in
 * the Keychain and must sign in inside the container instead).
 */

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const HttpsUrl = Schema.String.check(
  Schema.makeFilter((value) =>
    (URL.canParse(value) && new URL(value).protocol === "https:") ||
    "Expected an HTTPS URL"
  ),
);

const BootstrapTeam = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  agentToken: Schema.String.check(Schema.isStartsWith("briar_agent_")),
});

export const SandboxBootstrapPayload = Schema.Struct({
  schemaVersion: Schema.Literal(SANDBOX_SCHEMA_VERSION),
  apiUrl: HttpsUrl,
  userToken: Schema.String.check(Schema.isMinLength(16)),
  label: Schema.String.check(Schema.isLengthBetween(1, 100)),
  teams: Schema.Array(BootstrapTeam).check(Schema.isMinLength(1)),
  codexAuth: Schema.optional(Schema.String.check(Schema.isMinLength(2))),
  /** `opencode.json`: model routing and custom providers, not a credential. */
  opencodeConfig: Schema.optional(Schema.String.check(Schema.isMinLength(2))),
  opencodeAuth: Schema.optional(Schema.String.check(Schema.isMinLength(2))),
  grokAuth: Schema.optional(Schema.String.check(Schema.isMinLength(2))),
  /**
   * Providers the owner added on the Mac. A provider that is not built in —
   * Grok, for one — reads as disabled in the container until it is on this
   * list, so the sandbox worker would never advertise it however well the CLI
   * is installed and signed in.
   */
  addedProviders: Schema.optional(Schema.Array(Schema.Literals(agentProviders))),
  gitIdentity: Schema.optional(Schema.Struct({
    name: Schema.String.check(Schema.isLengthBetween(1, 200)),
    email: Schema.String.check(Schema.isLengthBetween(3, 320)),
  })),
}).annotate({ parseOptions: strictParseOptions });
export type SandboxBootstrapPayload = typeof SandboxBootstrapPayload.Type;

export const decodeSandboxBootstrapPayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(SandboxBootstrapPayload),
  strictParseOptions,
);

const SandboxState = Schema.Struct({
  schemaVersion: Schema.Literal(SANDBOX_SCHEMA_VERSION),
  label: Schema.String,
  teamIds: Schema.Array(Schema.String.check(Schema.isUUID())),
  bootstrappedAt: Schema.String,
  /** Managed computer record that lets the app open this sandbox's desktop. */
  managedComputerId: Schema.optional(Schema.String.check(Schema.isUUID())),
}).annotate({ parseOptions: strictParseOptions });
export type SandboxState = typeof SandboxState.Type;

/**
 * Credential file for the remote-desktop relay agent. It mirrors the managed
 * computer's `worker-credential.json`: the worker credential doubles as the
 * relay credential because the relay authenticates the agent as a worker
 * device and matches it against the managed computer's device id.
 */
export const SandboxRemoteAgentConfig = Schema.Struct({
  credential: Schema.String.check(Schema.isStartsWith("briar_worker_")),
  deviceId: Schema.String.check(Schema.isMinLength(1)),
  organizationId: Schema.String.check(Schema.isUUID()),
  managedComputerId: Schema.String.check(Schema.isUUID()),
  apiOrigin: HttpsUrl,
}).annotate({ parseOptions: strictParseOptions });
export type SandboxRemoteAgentConfig = typeof SandboxRemoteAgentConfig.Type;
const decodeSandboxRemoteAgentConfig = Schema.decodeUnknownSync(
  Schema.fromJsonString(SandboxRemoteAgentConfig),
  strictParseOptions,
);

export const sandboxRemoteAgentConfigPath = (directory = configDirectory) =>
  join(directory, "remote-agent.json");

export async function readSandboxRemoteAgentConfig(
  directory = configDirectory,
): Promise<SandboxRemoteAgentConfig | null> {
  try {
    return decodeSandboxRemoteAgentConfig(
      await readFile(sandboxRemoteAgentConfigPath(directory), "utf8"),
    );
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return null;
    throw new Error("Sandbox remote agent config is unreadable; rerun `briar sandbox up`");
  }
}

async function writeSandboxRemoteAgentConfig(
  config: SandboxRemoteAgentConfig,
  directory = configDirectory,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    sandboxRemoteAgentConfigPath(directory),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
}
const decodeSandboxState = Schema.decodeUnknownSync(
  Schema.fromJsonString(SandboxState),
  strictParseOptions,
);

export const sandboxStatePath = (directory = configDirectory) =>
  join(directory, "sandbox.json");
export const sandboxSupervisorPidPath = (directory = configDirectory) =>
  join(directory, "sandbox-supervisor.pid");

/** State files written before the project-to-team rename used `projectIds`. */
export function migrateLegacySandboxState(raw: string): string {
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed && typeof parsed === "object" && "projectIds" in parsed &&
    !("teamIds" in parsed)
  ) {
    const legacy = parsed as { projectIds?: unknown; teamIds?: unknown };
    legacy.teamIds = legacy.projectIds;
    delete legacy.projectIds;
    return JSON.stringify(parsed);
  }
  return raw;
}

export async function readSandboxState(
  directory = configDirectory,
): Promise<SandboxState | null> {
  try {
    return decodeSandboxState(
      migrateLegacySandboxState(await readFile(sandboxStatePath(directory), "utf8")),
    );
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return null;
    throw new Error("Sandbox state file is unreadable; rerun `briar sandbox up`");
  }
}

async function writeSandboxState(state: SandboxState, directory = configDirectory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    sandboxStatePath(directory),
    `${JSON.stringify(state, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/**
 * Copy one provider file the owner handed over. The directory is owner-only
 * and the file is rewritten in place, so rerunning `briar sandbox up` refreshes
 * a rotated credential without ever widening its mode.
 */
async function writeProviderFile(target: string, contents: string) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, contents, { mode: 0o600 });
  await chmod(target, 0o600);
}

/** The XDG base directory, or its home-relative default. */
const baseDirectory = (variable: string, home: string, fallback: string) => {
  const configured = process.env[variable]?.trim();
  return configured ? configured : join(home, fallback);
};

export const sandboxOpencodeConfigPath = (home = homedir()) =>
  join(baseDirectory("XDG_CONFIG_HOME", home, ".config"), "opencode", "opencode.json");

export const sandboxOpencodeAuthPath = (home = homedir()) =>
  join(
    baseDirectory("XDG_DATA_HOME", home, join(".local", "share")),
    "opencode",
    "auth.json",
  );

const writeCodexAuth = (contents: string, home = homedir()) =>
  writeProviderFile(join(home, ".codex", "auth.json"), contents);

const writeOpencodeConfig = (contents: string, home = homedir()) =>
  writeProviderFile(sandboxOpencodeConfigPath(home), contents);

const writeOpencodeAuth = (contents: string, home = homedir()) =>
  writeProviderFile(sandboxOpencodeAuthPath(home), contents);

const writeGrokAuth = (contents: string, home = homedir()) =>
  writeProviderFile(join(home, ".grok", "auth.json"), contents);

export type SandboxBootstrapDependencies = {
  readonly loadConfig: () => Promise<Config>;
  readonly saveConfig: (config: Config) => Promise<void>;
  readonly fetchRepositoryCredential: (
    apiUrl: string,
    project: { id: string; agentToken: string },
  ) => Promise<Parameters<typeof ensureRepository>[0]>;
  readonly ensureRepository: typeof ensureRepository;
  readonly registerWorker: typeof registerProjectExecutionWorker;
  readonly writeCodexAuth: (contents: string) => Promise<void>;
  readonly writeOpencodeConfig: (contents: string) => Promise<void>;
  readonly writeOpencodeAuth: (contents: string) => Promise<void>;
  readonly writeGrokAuth: (contents: string) => Promise<void>;
  readonly writeGitIdentity: (
    identity: { readonly name: string; readonly email: string },
  ) => Promise<void>;
  readonly writeState: (state: SandboxState) => Promise<void>;
  readonly registerComputer: (input: {
    apiUrl: string;
    userToken: string;
    organizationId: string;
    deviceId: string;
    label: string;
  }) => Promise<{ managedComputerId: string }>;
  readonly writeRemoteAgentConfig: (config: SandboxRemoteAgentConfig) => Promise<void>;
  readonly computerUseHealthy: () => Promise<boolean>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => Date;
  readonly log: (message: string) => void;
};

const fetchRepositoryCredential: SandboxBootstrapDependencies["fetchRepositoryCredential"] =
  async (apiUrl, project) => {
    const client = createAuthenticatedConnectClient(
      ProjectGitHubService,
      apiUrl,
      project.agentToken,
    );
    const response = await client.createProjectGitHubCredential({
      projectId: project.id,
    });
    return requiredMessage(
      response.credential,
      "createProjectGitHubCredential.credential",
    );
  };

/**
 * Agents commit inside the container, and git cannot infer an identity from a
 * container hostname. Mirror the owner's global git identity unless the
 * container already has one.
 */
async function writeGitIdentity(identity: { readonly name: string; readonly email: string }) {
  const signal = new AbortController().signal;
  for (const [key, value] of [["user.name", identity.name], ["user.email", identity.email]] as const) {
    if (gitValueAt(homedir(), ["config", "--global", "--get", key])) continue;
    await runSimpleCommand("git", ["config", "--global", key, value], signal);
  }
}

const defaultDependencies: SandboxBootstrapDependencies = {
  loadConfig,
  saveConfig,
  fetchRepositoryCredential,
  ensureRepository,
  registerWorker: registerProjectExecutionWorker,
  writeCodexAuth: (contents) => writeCodexAuth(contents),
  writeOpencodeConfig: (contents) => writeOpencodeConfig(contents),
  writeOpencodeAuth: (contents) => writeOpencodeAuth(contents),
  writeGrokAuth: (contents) => writeGrokAuth(contents),
  writeGitIdentity,
  writeState: writeSandboxState,
  registerComputer: async (input) => {
    const client = createAuthenticatedConnectClient(
      FleetService,
      input.apiUrl,
      input.userToken,
      { binary: true },
    );
    const response = await client.registerSandboxComputer({
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      label: input.label,
    });
    const computer = requiredMessage(response.computer, "registerSandboxComputer.computer");
    return { managedComputerId: computer.id };
  },
  writeRemoteAgentConfig: writeSandboxRemoteAgentConfig,
  computerUseHealthy: () => computerUseServiceHealthy(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => new Date(),
  log: (message) => console.error(message),
};

export const COMPUTER_USE_HEALTH_URL = "http://127.0.0.1:1337/healthz";

/** True when the in-container Computer Use box service answers its health check. */
export async function computerUseServiceHealthy(
  fetchImplementation: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImplementation(COMPUTER_USE_HEALTH_URL, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const health = await response.json() as Record<string, unknown>;
    return health.ok === true && health.computerUseSupported === true;
  } catch {
    return false;
  }
}

async function waitForComputerUseService(
  healthy: () => Promise<boolean>,
  sleep: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthy()) return true;
    await sleep(1_000);
  }
  return false;
}

/**
 * Converge the container onto the payload: session, provider credentials,
 * one verified clone per team, and one execution-worker registration per
 * team. Every step is idempotent so `briar sandbox up` can rerun it.
 */
export async function runSandboxBootstrap(
  payload: SandboxBootstrapPayload,
  overrides: Partial<SandboxBootstrapDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = await dependencies.loadConfig();
  config.apiUrl = payload.apiUrl;
  config.userToken = payload.userToken;
  if (payload.codexAuth !== undefined) {
    await dependencies.writeCodexAuth(payload.codexAuth);
  }
  if (payload.opencodeConfig !== undefined) {
    await dependencies.writeOpencodeConfig(payload.opencodeConfig);
  }
  if (payload.opencodeAuth !== undefined) {
    await dependencies.writeOpencodeAuth(payload.opencodeAuth);
  }
  if (payload.grokAuth !== undefined) {
    await dependencies.writeGrokAuth(payload.grokAuth);
  }
  // A provider this container has not added stays disabled however well it is
  // installed, so mirror the Mac's added set and switch each one on. Both
  // steps go through the shared normalizer, which keeps the list in menu order
  // and free of duplicates when `up` is rerun.
  if (payload.addedProviders !== undefined) {
    config.addedProviders = normalizeAddedProviders([
      ...addedAgentProviders(config),
      ...payload.addedProviders,
    ]);
    for (const provider of payload.addedProviders) {
      config.agentProviders[provider] = true;
    }
  }
  if (payload.gitIdentity !== undefined) {
    await dependencies.writeGitIdentity(payload.gitIdentity);
  }
  // Worker registration probes the Computer Use box service and only
  // advertises the capability when a display can be driven, so give the
  // supervisor a moment to bring the service up before registering.
  if (!await waitForComputerUseService(dependencies.computerUseHealthy, dependencies.sleep, 90_000)) {
    dependencies.log(
      "Computer Use box service is not healthy; workers register without Computer Use",
    );
  }
  const signal = new AbortController().signal;
  for (const project of payload.teams) {
    dependencies.log(`Preparing team ${project.id}`);
    const credential = await dependencies.fetchRepositoryCredential(
      payload.apiUrl,
      project,
    );
    const repositoryPath = await dependencies.ensureRepository(credential, signal);
    const existing = config.teams.find((candidate) => candidate.id === project.id);
    const next: TeamConfig = {
      ...existing,
      id: project.id,
      repositoryPath,
      repositoryRemote: credential.cloneUrl,
      agentToken: project.agentToken,
      apiUrl: payload.apiUrl,
    };
    config.teams = [
      ...config.teams.filter((candidate) => candidate.id !== project.id),
      next,
    ];
    await dependencies.saveConfig(config);
    const registration = await dependencies.registerWorker({
      config,
      project: next,
      userToken: payload.userToken,
      label: payload.label,
    });
    dependencies.log(
      `Registered worker ${registration.workerId} for team ${project.id}`,
    );
  }
  // Join the remote-desktop relay: register this sandbox's worker device as a
  // managed computer so the app can open its desktop, and hand the relay
  // agent the same worker credential the relay authenticates with.
  let managedComputerId: string | undefined;
  const relayWorker = config.teams
    .filter((team) => payload.teams.some((project) => project.id === team.id))
    .map((team) => team.executionWorker)
    .find((worker) => worker?.token);
  if (relayWorker?.token) {
    try {
      const registered = await dependencies.registerComputer({
        apiUrl: payload.apiUrl,
        userToken: payload.userToken,
        organizationId: relayWorker.organizationId,
        deviceId: relayWorker.deviceId,
        label: payload.label,
      });
      managedComputerId = registered.managedComputerId;
      await dependencies.writeRemoteAgentConfig({
        credential: relayWorker.token,
        deviceId: relayWorker.deviceId,
        organizationId: relayWorker.organizationId,
        managedComputerId,
        apiOrigin: payload.apiUrl,
      });
      dependencies.log(`Registered sandbox desktop as managed computer ${managedComputerId}`);
    } catch (error) {
      dependencies.log(
        `Sandbox desktop was not registered for remote viewing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  await dependencies.writeState({
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    label: payload.label,
    teamIds: payload.teams.map((project) => project.id),
    bootstrappedAt: dependencies.now().toISOString(),
    ...(managedComputerId ? { managedComputerId } : {}),
  });
}

export async function readStdin(stream: NodeJS.ReadableStream = process.stdin) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Report how far this container got, in the shape `briar sandbox status`
 * expects. `ready` means every desired team is registered, cloned, and
 * supervised.
 */
export async function sandboxReport(input: {
  readonly config?: Config;
  readonly state?: SandboxState | null;
  readonly supervisorPid?: number | null;
  readonly repositoryPresent?: (path: string) => boolean;
  readonly providerSignedIn?: (provider: string) => Promise<boolean>;
  readonly computerUseHealthy?: () => Promise<boolean>;
  readonly displays?: () => Promise<readonly SandboxDisplay[]>;
  readonly primaryDisplay?: () => Promise<boolean>;
} = {}) {
  const config = input.config ?? await loadConfig();
  const state = input.state === undefined ? await readSandboxState() : input.state;
  const supervisorPid = input.supervisorPid === undefined
    ? await readSupervisorPid()
    : input.supervisorPid;
  const repositoryPresent = input.repositoryPresent ??
    ((path: string) => gitValueAt(path, ["rev-parse", "--show-toplevel"]) !== null);
  const providerSignedIn = input.providerSignedIn ??
    ((provider: string) =>
      providerAuthenticated(
        provider as (typeof managedComputerSetupProviders)[number],
      ).catch(() => false));
  const desired = state?.teamIds ?? [];
  const teams = desired.map((id) => {
    const project = config.teams.find((candidate) => candidate.id === id);
    const repositoryPath = project?.repositoryPath ?? null;
    return {
      id,
      registered: project?.executionWorker !== undefined,
      workerId: project?.executionWorker?.workerId ?? null,
      repositoryPath,
      repositoryPresent: repositoryPath !== null && repositoryPresent(repositoryPath),
    };
  });
  const providers = Object.fromEntries(
    await Promise.all(
      managedComputerSetupProviders
        .filter((provider) => config.agentProviders[provider])
        .map(async (provider) => [provider, await providerSignedIn(provider)] as const),
    ),
  );
  const supervisorRunning = supervisorPid !== null && processAlive(supervisorPid);
  const serviceHealthy = await (input.computerUseHealthy ?? computerUseServiceHealthy)();
  const displays = await (input.displays ?? assignedDisplays)();
  const primaryDisplay = await (input.primaryDisplay ?? primaryDisplayListening)();
  const missing = teams.filter((project) =>
    !project.registered || !project.repositoryPresent
  );
  const detail = state === null
    ? "Waiting for bootstrap."
    : missing.length > 0
      ? `Bootstrap incomplete for ${missing.map((project) => project.id).join(", ")}.`
      : !supervisorRunning
        ? "Worker supervisor is not running."
        : !serviceHealthy
          ? "Computer Use box service is not healthy."
          : "Sandbox is ready.";
  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    ready: state !== null && missing.length === 0 && supervisorRunning && serviceHealthy,
    supervisorRunning,
    computerUse: { serviceHealthy, displays, primaryDisplay },
    managedComputerId: state?.managedComputerId ?? null,
    detail,
    teams,
    providers,
  };
}

export type SandboxDisplay = { readonly agentId: string; readonly displayIndex: number };

/** Displays the box service currently holds for agents, without their owner tokens. */
export async function assignedDisplays(
  path = configuredComputerUseAssignmentPath(),
): Promise<SandboxDisplay[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      assignments?: { agentId?: unknown; displayIndex?: unknown }[];
    };
    return (parsed.assignments ?? []).flatMap((assignment) =>
      typeof assignment.agentId === "string" && typeof assignment.displayIndex === "number"
        ? [{ agentId: assignment.agentId, displayIndex: assignment.displayIndex }]
        : []
    );
  } catch {
    return [];
  }
}

async function readSupervisorPid(directory = configDirectory) {
  try {
    const raw = (await readFile(sandboxSupervisorPidPath(directory), "utf8")).trim();
    return /^[1-9][0-9]{0,9}$/u.test(raw) ? Number.parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

export type SandboxUnregisterResult = {
  readonly teams: ReadonlyArray<{
    readonly id: string;
    readonly workerId: string | null;
    readonly state: "unbound" | "not_registered" | "failed";
    readonly detail?: string;
  }>;
  /** Whether the sandbox's managed computer record was removed from the relay. */
  readonly computerRemoved: boolean;
};

/**
 * Unbind every worker this sandbox registered so `briar sandbox rm` leaves
 * nothing behind on the server. Failures are reported per team rather than
 * thrown: the container is going away either way, and the caller decides how
 * loudly to warn.
 */
async function unregisterSandboxComputer(input: {
  apiUrl: string;
  userToken: string;
  organizationId: string;
  deviceId: string;
}) {
  const client = createAuthenticatedConnectClient(
    FleetService,
    input.apiUrl,
    input.userToken,
    { binary: true },
  );
  const response = await client.unregisterSandboxComputer({
    organizationId: input.organizationId,
    deviceId: input.deviceId,
  });
  return response.removed;
}

export async function runSandboxUnregister(overrides: {
  readonly loadConfig?: () => Promise<Config>;
  readonly readState?: () => Promise<SandboxState | null>;
  readonly unregister?: typeof unregisterTeamExecutionWorker;
  readonly readRemoteAgentConfig?: () => Promise<SandboxRemoteAgentConfig | null>;
  readonly unregisterComputer?: typeof unregisterSandboxComputer;
} = {}): Promise<SandboxUnregisterResult> {
  const config = await (overrides.loadConfig ?? loadConfig)();
  const state = await (overrides.readState ?? readSandboxState)();
  const unregister = overrides.unregister ?? unregisterTeamExecutionWorker;
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  const teams: SandboxUnregisterResult["teams"][number][] = [];
  const remoteAgent = await (overrides.readRemoteAgentConfig ?? readSandboxRemoteAgentConfig)()
    .catch(() => null);
  let computerRemoved = false;
  if (remoteAgent && userToken) {
    const worker = config.teams
      .map((team) => team.executionWorker)
      .find((candidate) => candidate?.deviceId === remoteAgent.deviceId);
    if (worker) {
      try {
        computerRemoved = await (overrides.unregisterComputer ?? unregisterSandboxComputer)({
          apiUrl: remoteAgent.apiOrigin,
          userToken,
          organizationId: worker.organizationId,
          deviceId: remoteAgent.deviceId,
        });
      } catch {
        computerRemoved = false;
      }
    }
    await rm(sandboxRemoteAgentConfigPath(), { force: true });
  }
  for (const id of state?.teamIds ?? []) {
    const team = config.teams.find((candidate) => candidate.id === id);
    if (!team?.executionWorker) {
      teams.push({ id, workerId: null, state: "not_registered" });
      continue;
    }
    if (!userToken) {
      teams.push({
        id,
        workerId: team.executionWorker.workerId,
        state: "failed",
        detail: "No Briar session token in the sandbox",
      });
      continue;
    }
    try {
      const result = await unregister({
        config,
        team,
        userToken,
        reason: "explicit_user_unlink",
      });
      teams.push({ id, workerId: result.workerId, state: "unbound" });
    } catch (error) {
      teams.push({
        id,
        workerId: team.executionWorker.workerId,
        state: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { teams, computerRemoved };
}

export function sandboxWorkerTeamIds(config: Config, state: SandboxState | null) {
  const desired = new Set(state?.teamIds ?? []);
  return config.teams
    .filter((project) => desired.has(project.id) && project.executionWorker)
    .map((project) => project.id)
    .sort();
}

/**
 * Keep a long-running child of the supervisor alive with exponential backoff.
 * Used for the Computer Use box service (which owns the Xvnc displays and the
 * loopback exec endpoints) and for the noVNC bridge that lets the owner watch
 * those displays.
 */
export function keepChildAlive(
  name: string,
  command: readonly string[],
  stop: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    let child: ChildProcess | undefined;
    let attempt = 0;
    const launch = () => {
      if (stop.aborted) return resolve();
      const startedAt = Date.now();
      child = spawn(command[0]!, command.slice(1), { stdio: "inherit", env: process.env });
      console.log(JSON.stringify({ event: `sandbox_${name}_started`, pid: child.pid ?? null }));
      child.once("exit", (code, signal) => {
        child = undefined;
        if (stop.aborted) return resolve();
        attempt = Date.now() - startedAt >= 60_000 ? 1 : Math.min(6, attempt + 1);
        const delayMs = Math.min(60_000, 1_000 * 2 ** (attempt - 1));
        console.error(JSON.stringify({
          event: `sandbox_${name}_exited`,
          code,
          signal,
          restartInMs: delayMs,
        }));
        setTimeout(launch, delayMs);
      });
    };
    stop.addEventListener("abort", () => {
      if (child) child.kill("SIGTERM");
      else resolve();
    }, { once: true });
    launch();
  });
}

/**
 * noVNC token routing: `?token=displayN` reaches the Xvnc server of display
 * `:N`. Every index the desktop manager may assign is listed up front so the
 * bridge never needs restarting when a display appears.
 */
export function novncTokenFileContents(maxDisplayIndex = 100): string {
  return Array.from({ length: maxDisplayIndex }, (_, index) => index + 1)
    .map((display) => `display${display}: 127.0.0.1:${5_900 + display}`)
    .join("\n") + "\n";
}

export function novncCommand(tokenFile = SANDBOX_NOVNC_TOKEN_FILE) {
  return [
    "/usr/bin/websockify",
    "--web",
    "/usr/share/novnc",
    "--token-plugin",
    "TokenFile",
    "--token-source",
    tokenFile,
    `0.0.0.0:${SANDBOX_NOVNC_PORT}`,
  ];
}

export const SANDBOX_PRIMARY_DISPLAY_INDEX = 1;
export const SANDBOX_PRIMARY_DISPLAY_PORT = 5_900 + SANDBOX_PRIMARY_DISPLAY_INDEX;

export function primaryDisplayCommand() {
  return ["/opt/briar/bin/briar-remote-desktop"];
}

/** True when the owner's display :1 accepts VNC connections on loopback. */
export function primaryDisplayListening(
  port = SANDBOX_PRIMARY_DISPLAY_PORT,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (listening: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function cliCommand(...args: string[]) {
  const configured = process.env.BRIAR_CLI?.trim();
  if (configured && isAbsolute(configured)) return [configured, ...args];
  const entry = process.argv[1];
  if (!entry || !isAbsolute(entry)) {
    throw new Error("Unable to resolve the Briar CLI entry point");
  }
  return [process.execPath, entry, ...args];
}

export function boxServiceCommand() {
  return cliCommand("sandbox", "box-exec");
}

/**
 * Keep the box service and one `briar worker` per bootstrapped team alive
 * inside the container.
 */
export async function runSandboxSupervisor(directory = configDirectory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(sandboxSupervisorPidPath(directory), `${process.pid}\n`, {
    mode: 0o600,
  });
  const stop = new AbortController();
  await mkdir(dirname(SANDBOX_NOVNC_TOKEN_FILE), { recursive: true, mode: 0o700 });
  await writeFile(SANDBOX_NOVNC_TOKEN_FILE, novncTokenFileContents(), { mode: 0o600 });
  const children = Promise.all([
    keepChildAlive("box_service", boxServiceCommand(), stop.signal),
    keepChildAlive("novnc", novncCommand(), stop.signal),
    // Display :1 is the owner's desktop, always available like Grok Bot's
    // default display and the managed computer's remote desktop; agents use
    // :2 and above through the box service.
    keepChildAlive("primary_display", primaryDisplayCommand(), stop.signal),
    keepChildAlive("remote_agent", cliCommand("sandbox", "remote-agent"), stop.signal),
  ]);
  try {
    await runWorkerSupervisor({
      // The state file is re-read on every reconcile so a later bootstrap
      // can add or drop projects without restarting the container.
      desiredProjectIds: async (config) =>
        sandboxWorkerTeamIds(config, await readSandboxState(directory)),
      childEnvironment: () => ({}),
      eventPrefix: "sandbox_worker",
    });
  } finally {
    stop.abort();
    await Promise.race([children, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await rm(sandboxSupervisorPidPath(directory), { force: true });
  }
}
