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
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  ManagedComputerSetupSessionStatus,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import type {
  ProjectGitHubCredential,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import {
  ManagedComputerSetupChallengeKind,
  ManagedComputerSetupChallengeSchema,
  ManagedComputerSetupChallengeService,
  ManagedComputerSetupCompleteSchema,
  ManagedComputerSetupErrorSchema,
  ManagedComputerSetupPhase,
  ManagedComputerSetupStateSchema,
  ManagedComputerSetupStateStatus,
  ManagedComputerSetupService,
  ManagedComputerSetupToAgentSchema,
  type ManagedComputerSetupToController,
  ManagedComputerSetupToControllerSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import {
  agentProviders,
  type AgentProvider,
  type ManagedComputerSetupProvider,
} from "../src/lib/agent-provider";
import {
  isManagedComputerSetupToAgent,
  isManagedComputerSetupToController,
  managedComputerSetupProviderFromProto,
  managedComputerSetupProviderToProto,
} from "../src/lib/managed-computer-setup-codec";
import {
  managedComputerRemoteHeartbeatIntervalMs,
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
  managedComputerRemoteHeartbeatTimeoutMs,
} from "../src/lib/managed-computer-remote-protocol";
import { dashboardWorkerFromProto } from "../src/lib/app-rpc/fleet-mappers";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import { teamSettingsFromProto } from "../src/lib/app-rpc/team-configuration-mappers";
import { cliVersion, gitValueAt, loadConfig, saveConfig } from "./command-support";
import { createAuthenticatedConnectClient } from "./connect-client";
import type { ManagedComputerRemoteAgentConfig } from "./managed-computer-remote-session-agent";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  claudeAuthenticated,
  grokAuthenticated,
  inspectWorkerProviderHealth,
  opencodeAuthenticated,
} from "./provider-health";
import { projectWithRemoteSettings } from "./team-settings-sync";
import { workerRuntimeToProto } from "./worker-control-client";

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

type SetupChallenge = {
  kind: "device_code" | "authorization_code" | "api_key";
  verificationUri: string;
  userCode?: string;
};

const setupPhaseByName = {
  github: ManagedComputerSetupPhase.GITHUB,
  provider: ManagedComputerSetupPhase.PROVIDER,
  repository: ManagedComputerSetupPhase.REPOSITORY,
  worker: ManagedComputerSetupPhase.WORKER,
} as const;

const setupStatusByName = {
  working: ManagedComputerSetupStateStatus.WORKING,
  complete: ManagedComputerSetupStateStatus.COMPLETE,
} as const;

function setupStateMessage(
  phase: keyof typeof setupPhaseByName,
  status: keyof typeof setupStatusByName,
  provider?: ManagedComputerSetupProvider,
): ManagedComputerSetupToController {
  return create(ManagedComputerSetupToControllerSchema, {
    payload: {
      case: "state",
      value: create(ManagedComputerSetupStateSchema, {
        phase: setupPhaseByName[phase],
        status: setupStatusByName[status],
        ...(provider
          ? { provider: managedComputerSetupProviderToProto(provider) }
          : {}),
      }),
    },
  });
}

function setupChallengeMessage(input: {
  challengeId: string;
  service: "github" | "provider";
  challenge: SetupChallenge;
  provider?: ManagedComputerSetupProvider;
}): ManagedComputerSetupToController {
  const kind = input.challenge.kind === "device_code"
    ? ManagedComputerSetupChallengeKind.DEVICE_CODE
    : input.challenge.kind === "authorization_code"
      ? ManagedComputerSetupChallengeKind.AUTHORIZATION_CODE
      : ManagedComputerSetupChallengeKind.API_KEY;
  return create(ManagedComputerSetupToControllerSchema, {
    payload: {
      case: "challenge",
      value: create(ManagedComputerSetupChallengeSchema, {
        challengeId: input.challengeId,
        service: input.service === "github"
          ? ManagedComputerSetupChallengeService.GITHUB
          : ManagedComputerSetupChallengeService.PROVIDER,
        kind,
        verificationUri: input.challenge.verificationUri,
        ...(input.challenge.userCode
          ? { userCode: input.challenge.userCode }
          : {}),
        ...(input.provider
          ? { provider: managedComputerSetupProviderToProto(input.provider) }
          : {}),
      }),
    },
  });
}

function setupCompleteMessage(input: {
  teamId: string;
  provider: ManagedComputerSetupProvider;
  workerId: string;
}): ManagedComputerSetupToController {
  return create(ManagedComputerSetupToControllerSchema, {
    payload: {
      case: "complete",
      value: create(ManagedComputerSetupCompleteSchema, {
        ...input,
        provider: managedComputerSetupProviderToProto(input.provider),
      }),
    },
  });
}

function setupErrorMessage(input: {
  code: string;
  message: string;
  retryable: boolean;
}): ManagedComputerSetupToController {
  return create(ManagedComputerSetupToControllerSchema, {
    payload: {
      case: "error",
      value: create(ManagedComputerSetupErrorSchema, {
        ...input,
        message: input.message.slice(0, 1_000) ||
          "Managed computer setup failed",
      }),
    },
  });
}

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

export const OPENCODE_SKIP_SENTINEL = "SKIP";

class ProviderSkippedError extends Error {
  constructor() {
    super("Provider authentication was skipped");
    this.name = "ProviderSkippedError";
  }
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
  credential: ProjectGitHubCredential,
  signal: AbortSignal,
) {
  const repository = credential.repository;
  if (
    credential.projectId.length === 0 ||
    credential.organizationId.length === 0 ||
    credential.repositoryId <= 0n ||
    credential.cloneUrl !== `https://github.com/${repository}.git`
  ) {
    throw new Error("Managed repository credential identity is invalid");
  }
  const expiresAt = credential.expiresAt
    ? timestampDate(credential.expiresAt)
    : null;
  if (!expiresAt || expiresAt.getTime() <= Date.now() + 30_000) {
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
    credential.organizationId,
    credential.projectId,
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
    if (marker && marker !== String(credential.repositoryId)) {
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
        ["-c", "credential.helper=", "ls-remote", "--exit-code", credential.cloneUrl, "HEAD"],
        signal,
        { cwd: repositoryPath, env },
      );
    } else {
      cloneStagingDirectory = await mkdtemp(join(projectRoot, ".briar-clone-"));
      const checkout = join(cloneStagingDirectory, "repository");
      await runSimpleCommand(
        "git",
        ["-c", "credential.helper=", "clone", "--origin", "origin", "--", credential.cloneUrl, checkout],
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
    ["config", "--local", "briar.githubRepositoryId", String(credential.repositoryId)],
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
  emit: (message: ManagedComputerSetupToController) => void;
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
    dependencies.emit(setupChallengeMessage({
      challengeId: input.challengeId,
      service: input.service,
      challenge: first.challenge,
      ...(input.provider ? { provider: input.provider } : {}),
    }));
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
      if (next.type === "input") {
        if (next.value === OPENCODE_SKIP_SENTINEL && input.provider === "opencode") {
          throw new ProviderSkippedError();
        }
        processHandle.write(`${next.value}\n`);
      }
      else if (next.code !== 0) {
        throw new Error(authenticationFailureMessage(output));
      }
      else return;
    }
    const exitRace: Promise<number>[] = [processHandle.exited];
    if (input.provider === "opencode") {
      exitRace.push(new Promise<number>((resolve) => {
        const timer = setTimeout(() => resolve(-1), 30_000);
        timer.unref?.();
      }));
    }
    const code = await Promise.race([
      Promise.race(exitRace),
      waitForAbort(input.signal),
    ]);
    if (code === -1) return;
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
  const setupRpc = createAuthenticatedConnectClient(
    ManagedComputerSetupService,
    config.apiOrigin,
    config.credential,
    { binary: true },
  );
  const context = await setupRpc.getManagedComputerSetupContext({
    managedComputerId: config.managedComputerId,
    setupToken: input.setupToken,
  });
  const session = requiredMessage(
    context.session,
    "managedComputerSetupContext.session",
  );
  const setupProject = requiredMessage(
    context.team,
    "managedComputerSetupContext.team",
  );
  const settings = teamSettingsFromProto(requiredMessage(
    context.settings,
    "managedComputerSetupContext.settings",
  ));
  if (
    session.managedComputerId !== config.managedComputerId ||
    session.organizationId !== config.organizationId ||
    session.projectId !== setupProject.id ||
    session.status !== ManagedComputerSetupSessionStatus.PENDING
  ) {
    throw new Error("Managed setup context did not match this computer");
  }
  if (!settings.githubRepository) {
    throw new Error("Connect a GitHub repository to this project before setup");
  }
  if (!context.repositoryCredential) {
    throw new Error("GitHub App repository access is not ready for this project");
  }

  dependencies.emit(setupStateMessage("github", "working"));
  if (
    settings.githubRepositoryId === null ||
    context.repositoryCredential.repositoryId !==
      BigInt(settings.githubRepositoryId) ||
    context.repositoryCredential.repository.toLowerCase() !==
      settings.githubRepository.toLowerCase()
  ) {
    throw new Error("Managed repository credential does not match project settings");
  }
  dependencies.emit(setupStateMessage("github", "complete"));

  dependencies.emit(setupStateMessage("provider", "working", input.provider));
  let providerSkipped = false;
  if (!(await providerAuthenticated(input.provider))) {
    try {
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
    } catch (error) {
      if (error instanceof ProviderSkippedError) {
        providerSkipped = true;
      } else {
        throw error;
      }
    }
  }
  dependencies.emit(setupStateMessage("provider", "complete", input.provider));

  dependencies.emit(setupStateMessage("repository", "working"));
  const repositoryPath = await ensureRepository(
    context.repositoryCredential,
    input.signal,
  );
  dependencies.emit(setupStateMessage("repository", "complete"));

  dependencies.emit(setupStateMessage("worker", "working"));
  const enabled = onlyProviderEnabled(input.provider);
  const [providerHealth, providerCapabilities] = await Promise.all([
    inspectWorkerProviderHealth(enabled, providerSkipped ? {
      authenticated: async (provider) => provider === input.provider,
    } : undefined),
    discoverWorkerProviderCapabilities(enabled, { refresh: true }),
  ]);
  if (!providerHealth[input.provider].healthy &&
      !(providerSkipped && providerHealth[input.provider].reason === "not_authenticated")) {
    throw new Error(`${input.provider} is authenticated but not ready`);
  }
  const response = await setupRpc.bindManagedComputerSetup({
    managedComputerId: config.managedComputerId,
    setupToken: input.setupToken,
    runtime: workerRuntimeToProto({
      agentProvider: input.provider,
      providerHealth,
      providerCapabilities,
      versions: { briar: cliVersion },
      worktrees: true,
    }),
  });
  const binding = {
    ...response,
    worker: dashboardWorkerFromProto(requiredMessage(
      response.worker,
      "managedComputerSetup.worker",
    )),
  };
  if (
    binding.managedComputerId !== config.managedComputerId ||
    binding.organizationId !== config.organizationId ||
    binding.teamId !== setupProject.id ||
    binding.deviceId !== config.deviceId
  ) {
    throw new Error("Managed setup response did not match this computer");
  }

  const stored = await loadConfig();
  const existingProject = stored.projects.find((project) =>
    project.id === setupProject.id
  );
  const repositoryRemote = gitValueAt(
    repositoryPath,
    ["remote", "get-url", "origin"],
  ) ?? undefined;
  const project = projectWithRemoteSettings({
    ...existingProject,
    id: setupProject.id,
    repositoryPath,
    repositoryRemote,
    apiUrl: config.apiOrigin,
    llm: { provider: input.provider, approvalPolicy: "never" },
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
  dependencies.emit(setupStateMessage("worker", "complete"));
  dependencies.emit(setupCompleteMessage({
    teamId: setupProject.id,
    provider: input.provider,
    workerId: binding.worker.id,
  }));
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
    socket.binaryType = "arraybuffer";
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
      if (this.websocket !== socket) return;
      if (typeof event.data === "string") {
        void this.handleMessage(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        void this.handleMessage(event.data);
        return;
      }
      socket.close(1008, "Managed setup frame type is invalid");
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

  private async handleMessage(value: string | ArrayBuffer) {
    if (typeof value === "string") {
      if (value === managedComputerRemoteHeartbeatResponse) {
        this.lastHeartbeatResponseAt = Date.now();
        return;
      }
      this.websocket?.close(1008, "Managed setup control frames must be binary");
      return;
    }
    let message;
    try {
      message = fromBinary(
        ManagedComputerSetupToAgentSchema,
        new Uint8Array(value),
      );
    } catch {
      this.websocket?.close(1008, "Managed setup frame is malformed");
      return;
    }
    if (!isManagedComputerSetupToAgent(message)) {
      this.websocket?.close(1008, "Managed setup frame is invalid");
      return;
    }
    if (message.payload.case === "controllerReady") {
      this.activeSessionId = message.payload.value.sessionId;
      return;
    }
    if (message.payload.case === "controllerEnded") {
      if (this.activeSessionId === message.payload.value.sessionId) {
        this.cancelRun();
        this.activeSessionId = null;
      }
      return;
    }
    if (message.payload.case === "cancel") {
      this.cancelRun();
      return;
    }
    if (message.payload.case === "submit") {
      const resolveInput = this.pendingInputs.get(
        message.payload.value.challengeId,
      );
      if (resolveInput) {
        this.pendingInputs.delete(message.payload.value.challengeId);
        resolveInput(message.payload.value.value);
      }
      return;
    }
    if (message.payload.case !== "start") {
      this.websocket?.close(1008, "Managed setup frame is invalid");
      return;
    }
    const provider = managedComputerSetupProviderFromProto(
      message.payload.value.provider,
    );
    if (!provider) {
      this.websocket?.close(1008, "Managed setup provider is invalid");
      return;
    }
    if (this.activeRun) {
      this.send(setupErrorMessage({
        code: "MANAGED_COMPUTER_SETUP_BUSY",
        message: "Managed computer setup is already running",
        retryable: false,
      }));
      return;
    }
    const run = new AbortController();
    this.activeRun = run;
    try {
      await runManagedComputerGuidedSetup(this.config, {
        setupToken: message.payload.value.setupToken,
        provider,
        signal: run.signal,
      }, {
        commandRunner: this.commandRunner,
        emit: (event) => this.send(event),
        input: (challengeId, signal) => this.waitForInput(challengeId, signal),
      });
    } catch (error) {
      if (!run.signal.aborted) {
        this.send(setupErrorMessage({
          code: "MANAGED_COMPUTER_SETUP_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        }));
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

  private send(message: ManagedComputerSetupToController) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      if (!isManagedComputerSetupToController(message)) {
        this.websocket.close(1011, "Managed setup agent produced an invalid frame");
        return;
      }
      this.websocket.send(toBinary(ManagedComputerSetupToControllerSchema, message));
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
