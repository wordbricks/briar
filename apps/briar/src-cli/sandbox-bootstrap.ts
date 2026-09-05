import { type ChildProcess, spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import * as Schema from "effect/Schema";
import {
  ProjectGitHubService,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import {
  managedComputerSetupProviders,
} from "../src/lib/agent-provider";
import {
  configDirectory,
  gitValueAt,
  loadConfig,
  saveConfig,
} from "./command-support";
import type { Config, TeamConfig } from "./config-contract";
import { createAuthenticatedConnectClient } from "./connect-client";
import { providerAuthenticated } from "./managed-computer-setup-agent";
import { configuredComputerUseAssignmentPath } from "./computer-use-desktop-manager";
import { runWorkerSupervisor } from "./managed-computer-supervisor";
import {
  ensureRepository,
  runSimpleCommand,
} from "./project-repository-bootstrap";
import { SANDBOX_NOVNC_PORT, SANDBOX_NOVNC_TOKEN_FILE, SANDBOX_SCHEMA_VERSION } from "./sandbox-image";
import { registerProjectExecutionWorker } from "./worker-commands";

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
}).annotate({ parseOptions: strictParseOptions });
export type SandboxState = typeof SandboxState.Type;
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

async function writeCodexAuth(contents: string, home = homedir()) {
  const target = join(home, ".codex", "auth.json");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, contents, { mode: 0o600 });
  await chmod(target, 0o600);
}

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
  readonly writeGitIdentity: (
    identity: { readonly name: string; readonly email: string },
  ) => Promise<void>;
  readonly writeState: (state: SandboxState) => Promise<void>;
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
  writeCodexAuth,
  writeGitIdentity,
  writeState: writeSandboxState,
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
  await dependencies.writeState({
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    label: payload.label,
    teamIds: payload.teams.map((project) => project.id),
    bootstrappedAt: dependencies.now().toISOString(),
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
    computerUse: { serviceHealthy, displays },
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

export function boxServiceCommand(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.BRIAR_CLI?.trim();
  if (configured && isAbsolute(configured)) return [configured, "sandbox", "box-exec"];
  const entry = process.argv[1];
  if (!entry || !isAbsolute(entry)) {
    throw new Error("Unable to resolve the Briar CLI entry point");
  }
  return [process.execPath, entry, "sandbox", "box-exec"];
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
