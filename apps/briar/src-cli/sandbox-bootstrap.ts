import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
import { runWorkerSupervisor } from "./managed-computer-supervisor";
import {
  ensureRepository,
  runSimpleCommand,
} from "./project-repository-bootstrap";
import { SANDBOX_SCHEMA_VERSION } from "./sandbox-image";
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
  now: () => new Date(),
  log: (message) => console.error(message),
};

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
  const missing = teams.filter((project) =>
    !project.registered || !project.repositoryPresent
  );
  const detail = state === null
    ? "Waiting for bootstrap."
    : missing.length > 0
      ? `Bootstrap incomplete for ${missing.map((project) => project.id).join(", ")}.`
      : !supervisorRunning
        ? "Worker supervisor is not running."
        : "Sandbox is ready.";
  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    ready: state !== null && missing.length === 0 && supervisorRunning,
    supervisorRunning,
    detail,
    teams,
    providers,
  };
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
};

/**
 * Unbind every worker this sandbox registered so `briar sandbox rm` leaves
 * nothing behind on the server. Failures are reported per team rather than
 * thrown: the container is going away either way, and the caller decides how
 * loudly to warn.
 */
export async function runSandboxUnregister(overrides: {
  readonly loadConfig?: () => Promise<Config>;
  readonly readState?: () => Promise<SandboxState | null>;
  readonly unregister?: typeof unregisterTeamExecutionWorker;
} = {}): Promise<SandboxUnregisterResult> {
  const config = await (overrides.loadConfig ?? loadConfig)();
  const state = await (overrides.readState ?? readSandboxState)();
  const unregister = overrides.unregister ?? unregisterTeamExecutionWorker;
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  const teams: SandboxUnregisterResult["teams"][number][] = [];
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
  return { teams };
}

export function sandboxWorkerTeamIds(config: Config, state: SandboxState | null) {
  const desired = new Set(state?.teamIds ?? []);
  return config.teams
    .filter((project) => desired.has(project.id) && project.executionWorker)
    .map((project) => project.id)
    .sort();
}

/** Keep one `briar worker` per bootstrapped team alive inside the container. */
export async function runSandboxSupervisor(directory = configDirectory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(sandboxSupervisorPidPath(directory), `${process.pid}\n`, {
    mode: 0o600,
  });
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
    await rm(sandboxSupervisorPidPath(directory), { force: true });
  }
}
