import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  agentProviders,
  type AgentProvider,
} from "../src/lib/agent-provider";
import {
  decodeManagedComputerSetupClientMessage,
  type ManagedComputerSetupAgentMessage,
  type ManagedComputerSetupProvider,
} from "../src/lib/managed-computer-setup-protocol";
import {
  managedComputerRemoteHeartbeatIntervalMs,
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
  managedComputerRemoteHeartbeatTimeoutMs,
} from "../src/lib/managed-computer-remote-protocol";
import { cliVersion, gitValueAt, loadConfig, request, saveConfig } from "./command-support";
import type { ManagedComputerRemoteAgentConfig } from "./managed-computer-remote-session-agent";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  claudeAuthenticated,
  grokAuthenticated,
  healthyWorkerProviders,
  inspectWorkerProviderHealth,
  opencodeAuthenticated,
} from "./provider-health";
import { projectWithRemoteSettings } from "./project-settings-sync";
import { WorkflowConfig } from "./config-contract";

const SetupContextResponse = Schema.Struct({
  session: Schema.Struct({
    id: Schema.String.check(Schema.isUUID()),
    projectId: Schema.String.check(Schema.isUUID()),
    expiresAt: Schema.String,
  }),
  project: Schema.Struct({
    id: Schema.String.check(Schema.isUUID()),
    name: Schema.String.check(Schema.isLengthBetween(1, 200)),
  }),
  settings: Schema.Struct({
    velenOrg: Schema.NullOr(Schema.String),
    dataSource: Schema.NullOr(Schema.String),
    linear: Schema.Struct({
      enabled: Schema.Boolean,
      source: Schema.NullOr(Schema.String),
      teamKey: Schema.NullOr(Schema.String),
    }),
    githubRepository: Schema.NullOr(
      Schema.String.check(
        Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
      ),
    ),
    githubRepositoryId: Schema.optional(Schema.NullOr(
      Schema.Int.check(Schema.isGreaterThan(0)),
    )),
    workflow: WorkflowConfig,
  }),
  repositoryCredential: Schema.optional(Schema.Struct({
    project: Schema.Struct({
      id: Schema.String.check(Schema.isUUID()),
      organizationId: Schema.String.check(Schema.isUUID()),
    }),
    repository: Schema.Struct({
      id: Schema.Int.check(Schema.isGreaterThan(0)),
      fullName: Schema.String,
      cloneUrl: Schema.String,
    }),
    username: Schema.String,
    password: Schema.String.check(Schema.isMinLength(1)),
    expiresAt: Schema.String,
  })),
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const SetupBindResponse = Schema.Struct({
  managedComputerId: Schema.String.check(Schema.isUUID()),
  organizationId: Schema.String.check(Schema.isUUID()),
  projectId: Schema.String.check(Schema.isUUID()),
  deviceId: Schema.String,
  worker: Schema.Struct({
    id: Schema.String.check(Schema.isLengthBetween(1, 128)),
    label: Schema.String,
    maxConcurrentSessions: Schema.Int,
    readiness: Schema.String,
  }),
  duplicate: Schema.Boolean,
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const SetupRelayControl = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("setup_controller_ready"),
    sessionId: Schema.String.check(Schema.isUUID()),
  }),
  Schema.Struct({
    type: Schema.Literal("setup_controller_ended"),
    sessionId: Schema.String.check(Schema.isUUID()),
  }),
]);

const decodeContext = Schema.decodeUnknownSync(SetupContextResponse, {
  errors: "all",
});
const decodeBinding = Schema.decodeUnknownSync(SetupBindResponse, {
  errors: "all",
});
const decodeRelayControl = Schema.decodeUnknownOption(SetupRelayControl);

type CommandSpec = {
  binary: string;
  args: readonly string[];
  environment?: NodeJS.ProcessEnv;
};

type InteractiveProcess = {
  exited: Promise<number>;
  write: (value: string) => void;
  kill: () => void;
};

export type ManagedComputerSetupCommandRunner = (
  spec: CommandSpec,
  onOutput: (output: string) => void,
) => InteractiveProcess;

type SetupChallenge = Pick<
  Extract<ManagedComputerSetupAgentMessage, { type: "challenge" }>,
  "kind" | "verificationUri" | "userCode"
>;

const ansiPattern = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu;
const urlPattern = /https:\/\/[^\s<>"']+/giu;
const deviceCodePattern = /\b[A-Z0-9]{4,5}(?:-[A-Z0-9]{4,5}){1,3}\b/u;

export function cleanManagedSetupOutput(output: string) {
  return output.replace(ansiPattern, "").replaceAll("\r", "\n");
}

export function authenticationFailureMessage(output: string) {
  const cleaned = cleanManagedSetupOutput(output);
  if (/(?:command not found|:\s*not found\b)/iu.test(cleaned)) {
    return "Authentication command is not available on this computer";
  }
  if (/(?:permission denied|os error 13)/iu.test(cleaned)) {
    return "Authentication credential storage is not writable";
  }
  return "Authentication command failed";
}

function firstUrl(output: string, hosts: readonly string[]) {
  return cleanManagedSetupOutput(output).match(urlPattern)?.find((value) => {
    try {
      return hosts.some((host) => new URL(value).hostname.endsWith(host));
    } catch {
      return false;
    }
  })?.replace(/[),.;]+$/u, "");
}

function deviceCode(output: string) {
  return cleanManagedSetupOutput(output).toUpperCase().match(deviceCodePattern)?.[0];
}

export function githubSetupChallenge(output: string): SetupChallenge | null {
  const userCode = deviceCode(output);
  const verificationUri = firstUrl(output, ["github.com"]);
  if (!userCode) return null;
  return {
    kind: "device_code",
    verificationUri: verificationUri ?? "https://github.com/login/device",
    ...(userCode ? { userCode } : {}),
  };
}

export function providerSetupChallenge(
  provider: ManagedComputerSetupProvider,
  output: string,
): SetupChallenge | null {
  if (provider === "opencode") {
    return {
      kind: "api_key",
      verificationUri: "https://opencode.ai/auth",
    };
  }
  if (provider === "claude") {
    const verificationUri = firstUrl(output, ["claude.ai", "anthropic.com"]);
    return verificationUri
      ? { kind: "authorization_code", verificationUri }
      : null;
  }
  const hosts = provider === "codex"
    ? ["openai.com"]
    : ["x.ai"];
  const verificationUri = firstUrl(output, hosts);
  const userCode = deviceCode(output);
  if (!userCode) return null;
  return {
    kind: "device_code",
    verificationUri: verificationUri ?? (provider === "codex"
      ? "https://auth.openai.com/activate"
      : "https://auth.x.ai"),
    ...(userCode ? { userCode } : {}),
  };
}

export function managedComputerProviderAuthCommand(
  provider: ManagedComputerSetupProvider,
): CommandSpec {
  if (provider === "codex") {
    return { binary: "codex", args: ["login", "--device-auth"] };
  }
  if (provider === "claude") {
    return { binary: "claude", args: ["auth", "login", "--claudeai"] };
  }
  if (provider === "grok") {
    return { binary: "grok", args: ["login", "--device-auth"] };
  }
  return {
    binary: "opencode",
    args: ["auth", "login", "--provider", "opencode", "--pure"],
  };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export const runManagedComputerSetupCommand: ManagedComputerSetupCommandRunner = (
  spec,
  onOutput,
) => {
  const command = [spec.binary, ...spec.args].map(shellQuote).join(" ");
  const child = spawn(
    "script",
    [
      "--quiet",
      "--return",
      "--flush",
      "--echo",
      "never",
      "--command",
      command,
      "/dev/null",
    ],
    {
      env: { ...process.env, ...spec.environment },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  return {
    exited: new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code) => resolveExit(code ?? 1));
    }),
    write: (value) => child.stdin.write(value),
    kill: () => child.kill("SIGTERM"),
  };
};

function commandStatus(binary: string, args: string[]) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
    timeout: 15_000,
  });
  return { status: result.status, stdout: result.stdout };
}

async function providerAuthenticated(provider: ManagedComputerSetupProvider) {
  if (provider === "codex") {
    return commandStatus("codex", ["login", "status"]).status === 0;
  }
  if (provider === "claude") return claudeAuthenticated("claude");
  if (provider === "grok") return grokAuthenticated(homedir(), Date.now());
  return opencodeAuthenticated(homedir());
}

function abortError() {
  const error = new Error("Managed computer setup was cancelled");
  error.name = "AbortError";
  return error;
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

async function runSimpleCommand(
  binary: string,
  args: string[],
  signal: AbortSignal,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const child = spawn(binary, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const exited = new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  try {
    const code = await Promise.race([exited, waitForAbort(signal)]);
    if (code !== 0) throw new Error(`${binary} command failed`);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return false;
    throw error;
  }
}

function githubRepositoryFromRemote(remote: string) {
  const normalized = remote.trim().replace(/\.git$/u, "");
  const https = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/iu);
  if (https) return https[1]!.toLowerCase();
  const ssh = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/iu);
  return ssh?.[1]?.toLowerCase() ?? null;
}

async function ensureRepository(
  credential: NonNullable<
    typeof SetupContextResponse.Type["repositoryCredential"]
  >,
  signal: AbortSignal,
) {
  const repository = credential.repository.fullName;
  if (
    credential.project.id.length === 0 ||
    credential.repository.id <= 0 ||
    credential.repository.cloneUrl !== `https://github.com/${repository}.git`
  ) {
    throw new Error("Managed repository credential identity is invalid");
  }
  if (Date.parse(credential.expiresAt) <= Date.now() + 30_000) {
    throw new Error("Managed repository credential expired; restart setup to retry");
  }
  const configuredRoot = process.env.BRIAR_MANAGED_WORKSPACE_ROOT?.trim();
  const workspaceRoot = configuredRoot || join(homedir(), "Briar", "projects");
  if (!isAbsolute(workspaceRoot)) {
    throw new Error("Managed workspace root must be absolute");
  }
  const repositoryName = repository.split("/")[1]!;
  const projectRoot = join(
    workspaceRoot,
    credential.project.organizationId,
    credential.project.id,
  );
  const repositoryPath = join(projectRoot, repositoryName);
  await mkdir(projectRoot, { recursive: true, mode: 0o700 });
  if (await pathExists(repositoryPath)) {
    const root = gitValueAt(repositoryPath, ["rev-parse", "--show-toplevel"]);
    const remote = gitValueAt(repositoryPath, ["remote", "get-url", "origin"]);
    if (
      !root || resolve(root) !== resolve(repositoryPath) || !remote ||
      githubRepositoryFromRemote(remote) !== repository.toLowerCase()
    ) {
      throw new Error("Managed project directory contains a different repository");
    }
    const marker = gitValueAt(repositoryPath, [
      "config",
      "--local",
      "--get",
      "briar.githubRepositoryId",
    ]);
    if (marker && marker !== String(credential.repository.id)) {
      throw new Error("Managed clone has a different GitHub repository ID");
    }
  }
  const credentialDirectory = await mkdtemp(join(tmpdir(), "briar-git-"));
  const askpass = join(credentialDirectory, "askpass.sh");
  let cloneStagingDirectory: string | null = null;
  try {
    await writeFile(
      askpass,
      "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' \"$BRIAR_GIT_USERNAME\" ;;\n  *) printf '%s\\n' \"$BRIAR_GIT_PASSWORD\" ;;\nesac\n",
      { mode: 0o700 },
    );
    await chmod(askpass, 0o700);
    const env = {
      ...process.env,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      BRIAR_GIT_USERNAME: credential.username,
      BRIAR_GIT_PASSWORD: credential.password,
    };
    if (await pathExists(repositoryPath)) {
      await runSimpleCommand(
        "git",
        ["-c", "credential.helper=", "ls-remote", "--exit-code", credential.repository.cloneUrl, "HEAD"],
        signal,
        { cwd: repositoryPath, env },
      );
    } else {
      cloneStagingDirectory = await mkdtemp(join(projectRoot, ".briar-clone-"));
      const checkout = join(cloneStagingDirectory, "repository");
      await runSimpleCommand(
        "git",
        ["-c", "credential.helper=", "clone", "--origin", "origin", "--", credential.repository.cloneUrl, checkout],
        signal,
        { env },
      );
      await rename(checkout, repositoryPath);
    }
  } finally {
    await rm(credentialDirectory, { recursive: true, force: true });
    if (cloneStagingDirectory) {
      await rm(cloneStagingDirectory, { recursive: true, force: true });
    }
  }
  await runSimpleCommand(
    "git",
    ["config", "--local", "briar.githubRepositoryId", String(credential.repository.id)],
    signal,
    { cwd: repositoryPath },
  );
  await runSimpleCommand(
    "git",
    ["config", "--local", "credential.useHttpPath", "true"],
    signal,
    { cwd: repositoryPath },
  );
  await runSimpleCommand(
    "git",
    ["config", "--local", "credential.https://github.com.helper", "!\"${BRIAR_CLI:-briar}\" github credential"],
    signal,
    { cwd: repositoryPath },
  );
  return repositoryPath;
}

type GuidedSetupDependencies = {
  commandRunner: ManagedComputerSetupCommandRunner;
  emit: (message: ManagedComputerSetupAgentMessage) => void;
  input: (challengeId: string, signal: AbortSignal) => Promise<string>;
};

async function runAuthentication(
  input: {
    service: "github" | "provider";
    provider?: ManagedComputerSetupProvider;
    command: CommandSpec;
    challengeId: string;
    signal: AbortSignal;
  },
  dependencies: GuidedSetupDependencies,
) {
  let output = "";
  let challengeSent = false;
  let challengeResolve!: (challenge: SetupChallenge) => void;
  const challengeReady = new Promise<SetupChallenge>((resolveChallenge) => {
    challengeResolve = resolveChallenge;
  });
  const processHandle = dependencies.commandRunner(input.command, (chunk) => {
    output = `${output}${chunk}`.slice(-64 * 1024);
    const challenge = input.service === "github"
      ? githubSetupChallenge(output)
      : providerSetupChallenge(input.provider!, output);
    if (challenge && !challengeSent) {
      challengeSent = true;
      challengeResolve(challenge);
    }
  });
  if (input.service === "github") {
    setTimeout(() => processHandle.write("\n"), 250).unref?.();
  }
  if (input.provider === "opencode") {
    challengeResolve(providerSetupChallenge("opencode", "")!);
    challengeSent = true;
  }
  try {
    const first = await Promise.race([
      challengeReady.then((challenge) => ({ type: "challenge" as const, challenge })),
      processHandle.exited.then((code) => ({ type: "exit" as const, code })),
      waitForAbort(input.signal),
    ]);
    if (first.type === "exit") {
      if (first.code !== 0) {
        throw new Error(authenticationFailureMessage(output));
      }
      return;
    }
    dependencies.emit({
      type: "challenge",
      challengeId: input.challengeId,
      service: input.service,
      ...first.challenge,
      ...(input.provider ? { provider: input.provider } : {}),
    });
    if (
      first.challenge.kind === "authorization_code" ||
      first.challenge.kind === "api_key"
    ) {
      const next = await Promise.race([
        dependencies.input(input.challengeId, input.signal).then((value) => ({
          type: "input" as const,
          value,
        })),
        processHandle.exited.then((code) => ({ type: "exit" as const, code })),
        waitForAbort(input.signal),
      ]);
      if (next.type === "input") processHandle.write(`${next.value}\n`);
      else if (next.code !== 0) {
        throw new Error(authenticationFailureMessage(output));
      }
      else return;
    }
    const code = await Promise.race([
      processHandle.exited,
      waitForAbort(input.signal),
    ]);
    if (code !== 0) throw new Error(authenticationFailureMessage(output));
  } finally {
    processHandle.kill();
  }
}

function onlyProviderEnabled(provider: ManagedComputerSetupProvider) {
  return Object.fromEntries(
    agentProviders.map((candidate) => [candidate, candidate === provider]),
  ) as Record<AgentProvider, boolean>;
}

export async function runManagedComputerGuidedSetup(
  config: ManagedComputerRemoteAgentConfig,
  input: {
    setupToken: string;
    provider: ManagedComputerSetupProvider;
    signal: AbortSignal;
  },
  dependencies: GuidedSetupDependencies,
) {
  const context = decodeContext(await request<unknown>(
    config.apiOrigin,
    `/managed-computers/${config.managedComputerId}/setup/context`,
    config.credential,
    {
      method: "POST",
      body: JSON.stringify({ setupToken: input.setupToken }),
    },
  ));
  const settings = context.settings;
  if (!settings.githubRepository) {
    throw new Error("Connect a GitHub repository to this project before setup");
  }
  if (!context.repositoryCredential) {
    throw new Error("GitHub App repository access is not ready for this project");
  }

  dependencies.emit({ type: "state", phase: "github", status: "working" });
  if (
    context.repositoryCredential.repository.id !== settings.githubRepositoryId ||
    context.repositoryCredential.repository.fullName.toLowerCase() !==
      settings.githubRepository.toLowerCase()
  ) {
    throw new Error("Managed repository credential does not match project settings");
  }
  dependencies.emit({ type: "state", phase: "github", status: "complete" });

  dependencies.emit({
    type: "state",
    phase: "provider",
    status: "working",
    provider: input.provider,
  });
  if (!(await providerAuthenticated(input.provider))) {
    await runAuthentication({
      service: "provider",
      provider: input.provider,
      command: managedComputerProviderAuthCommand(input.provider),
      challengeId: `${input.provider}-auth`,
      signal: input.signal,
    }, dependencies);
    if (!(await providerAuthenticated(input.provider))) {
      throw new Error(`${input.provider} authentication did not complete`);
    }
  }
  dependencies.emit({
    type: "state",
    phase: "provider",
    status: "complete",
    provider: input.provider,
  });

  dependencies.emit({ type: "state", phase: "repository", status: "working" });
  const repositoryPath = await ensureRepository(
    context.repositoryCredential,
    input.signal,
  );
  dependencies.emit({ type: "state", phase: "repository", status: "complete" });

  dependencies.emit({ type: "state", phase: "worker", status: "working" });
  const enabled = onlyProviderEnabled(input.provider);
  const [providerHealth, providerCapabilities] = await Promise.all([
    inspectWorkerProviderHealth(enabled),
    discoverWorkerProviderCapabilities(enabled, { refresh: true }),
  ]);
  if (!providerHealth[input.provider].healthy) {
    throw new Error(`${input.provider} is authenticated but not ready`);
  }
  const binding = decodeBinding(await request<unknown>(
    config.apiOrigin,
    `/managed-computers/${config.managedComputerId}/setup/bind`,
    config.credential,
    {
      method: "POST",
      body: JSON.stringify({
        setupToken: input.setupToken,
        worker: {
          agentProvider: input.provider,
          providers: healthyWorkerProviders(providerHealth),
          providerHealth,
          providerCapabilities,
          versions: { briar: cliVersion },
        },
      }),
    },
  ));
  if (
    binding.managedComputerId !== config.managedComputerId ||
    binding.organizationId !== config.organizationId ||
    binding.projectId !== context.project.id ||
    binding.deviceId !== config.deviceId
  ) {
    throw new Error("Managed setup response did not match this computer");
  }

  const stored = await loadConfig();
  const existingProject = stored.projects.find((project) =>
    project.id === context.project.id
  );
  const repositoryRemote = gitValueAt(
    repositoryPath,
    ["remote", "get-url", "origin"],
  ) ?? undefined;
  const project = projectWithRemoteSettings({
    ...existingProject,
    id: context.project.id,
    repositoryPath,
    repositoryRemote,
    apiUrl: config.apiOrigin,
    llm: { provider: input.provider },
    executionWorker: {
      deviceId: config.deviceId,
      workerId: binding.worker.id,
      organizationId: config.organizationId,
      label: binding.worker.label,
      maxConcurrentSessions: binding.worker.maxConcurrentSessions,
    },
  }, settings);
  await saveConfig({
    ...stored,
    apiUrl: config.apiOrigin,
    userToken: undefined,
    managedComputer: {
      managedComputerId: config.managedComputerId,
      deviceId: config.deviceId,
      organizationId: config.organizationId,
      credentialFile:
        process.env.BRIAR_MANAGED_CREDENTIAL_FILE?.trim() ||
        "/var/lib/briar/worker-credential.json",
    },
    projects: [
      ...stored.projects.filter((candidate) => candidate.id !== project.id),
      project,
    ],
  });
  dependencies.emit({ type: "state", phase: "worker", status: "complete" });
  dependencies.emit({
    type: "complete",
    projectId: context.project.id,
    provider: input.provider,
    workerId: binding.worker.id,
  });
}

function setupAgentSocketUrl(config: ManagedComputerRemoteAgentConfig) {
  const url = new URL(
    `/managed-computers/${config.managedComputerId}/setup-agent`,
    config.apiOrigin,
  );
  url.protocol = "wss:";
  return url.toString();
}

function setupEvent(name: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event: name, ...detail }));
}

export class ManagedComputerSetupAgent {
  private websocket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelayMs = 1_000;
  private lastHeartbeatResponseAt = 0;
  private stopped = false;
  private activeSessionId: string | null = null;
  private activeRun: AbortController | null = null;
  private readonly pendingInputs = new Map<
    string,
    (value: string) => void
  >();

  constructor(
    private readonly config: ManagedComputerRemoteAgentConfig,
    private readonly commandRunner = runManagedComputerSetupCommand,
  ) {}

  start() {
    if (this.stopped || this.websocket) return;
    this.connectRelay();
  }

  stop() {
    this.stopped = true;
    this.activeRun?.abort();
    this.activeRun = null;
    this.pendingInputs.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.websocket?.close(1000, "Managed setup agent stopped");
    this.websocket = null;
  }

  private connectRelay() {
    const socket = new WebSocket(
      setupAgentSocketUrl(this.config),
      `briar-setup-agent-v1.${this.config.credential}`,
    );
    this.websocket = socket;
    socket.addEventListener("open", () => {
      if (this.websocket !== socket) return;
      this.reconnectDelayMs = 1_000;
      this.startHeartbeat(socket);
      setupEvent("managed_setup_relay_connected", {
        managedComputerId: this.config.managedComputerId,
      });
    });
    socket.addEventListener("message", (event) => {
      if (this.websocket === socket && typeof event.data === "string") {
        void this.handleMessage(event.data);
      }
    });
    socket.addEventListener("close", (event) => {
      if (this.websocket !== socket) return;
      this.websocket = null;
      this.stopHeartbeat();
      this.cancelRun();
      setupEvent("managed_setup_relay_disconnected", { code: event.code });
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      socket.close(1011, "Managed setup relay connection failed");
    });
  }

  private async handleMessage(value: string) {
    if (value === managedComputerRemoteHeartbeatResponse) {
      this.lastHeartbeatResponseAt = Date.now();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return;
    }
    const control = decodeRelayControl(parsed);
    if (Option.isSome(control)) {
      if (control.value.type === "setup_controller_ready") {
        this.activeSessionId = control.value.sessionId;
      } else if (this.activeSessionId === control.value.sessionId) {
        this.cancelRun();
        this.activeSessionId = null;
      }
      return;
    }
    const message = decodeManagedComputerSetupClientMessage(value);
    if (!message) return;
    if (message.type === "cancel") {
      this.cancelRun();
      return;
    }
    if (message.type === "submit") {
      const resolveInput = this.pendingInputs.get(message.challengeId);
      if (resolveInput) {
        this.pendingInputs.delete(message.challengeId);
        resolveInput(message.value);
      }
      return;
    }
    if (this.activeRun) {
      this.send({
        type: "error",
        code: "MANAGED_COMPUTER_SETUP_BUSY",
        message: "Managed computer setup is already running",
        retryable: false,
      });
      return;
    }
    const run = new AbortController();
    this.activeRun = run;
    try {
      await runManagedComputerGuidedSetup(this.config, {
        setupToken: message.setupToken,
        provider: message.provider,
        signal: run.signal,
      }, {
        commandRunner: this.commandRunner,
        emit: (event) => this.send(event),
        input: (challengeId, signal) => this.waitForInput(challengeId, signal),
      });
    } catch (error) {
      if (!run.signal.aborted) {
        this.send({
          type: "error",
          code: "MANAGED_COMPUTER_SETUP_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
      }
    } finally {
      if (this.activeRun === run) this.activeRun = null;
      this.pendingInputs.clear();
    }
  }

  private waitForInput(challengeId: string, signal: AbortSignal) {
    return new Promise<string>((resolveInput, rejectInput) => {
      const abort = () => {
        this.pendingInputs.delete(challengeId);
        rejectInput(abortError());
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pendingInputs.set(challengeId, (value) => {
        signal.removeEventListener("abort", abort);
        resolveInput(value);
      });
    });
  }

  private cancelRun() {
    this.activeRun?.abort();
    this.activeRun = null;
    this.pendingInputs.clear();
  }

  private send(message: ManagedComputerSetupAgentMessage) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(message));
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connectRelay();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(socket: WebSocket) {
    this.stopHeartbeat();
    this.lastHeartbeatResponseAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.websocket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (
        Date.now() - this.lastHeartbeatResponseAt >=
          managedComputerRemoteHeartbeatTimeoutMs
      ) {
        this.websocket = null;
        this.stopHeartbeat();
        this.cancelRun();
        socket.close(4008, "Managed setup relay heartbeat timed out");
        this.scheduleReconnect();
        return;
      }
      socket.send(managedComputerRemoteHeartbeatRequest);
    }, managedComputerRemoteHeartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.lastHeartbeatResponseAt = 0;
  }
}
