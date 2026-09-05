import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ManagedComputerSetupProvider,
  managedComputerSetupProviders,
} from "../src/lib/agent-provider";
import { gitValueAt, has, loadConfig, openBrowser, value, values } from "./command-support";
import {
  managedComputerProviderAuthCommand,
} from "./managed-computer-setup-agent";
import { ComputerUseBoxService } from "./computer-use-box-service";
import {
  computerUseServiceHealthy,
  decodeSandboxBootstrapPayload,
  readStdin,
  runSandboxBootstrap,
  runSandboxSupervisor,
  runSandboxUnregister,
  sandboxReport,
  type SandboxBootstrapPayload,
} from "./sandbox-bootstrap";
import {
  createDockerRunner,
  DEFAULT_SANDBOX_VIEW_PORT,
  type DockerRunner,
  ensureDockerContext,
  ensureSandbox,
  getSandboxStatus,
  removeSandbox,
  restartSandbox,
  sandboxContainerName,
  sandboxName,
  stopSandbox,
} from "./sandbox-docker";
import {
  DEFAULT_DEBIAN_MIRROR,
  SANDBOX_CLI_PATH,
  SANDBOX_SCHEMA_VERSION,
  debianMirror,
  resolveSandboxRuntimeSources,
  sandboxImageTag,
  stageSandboxBuildContext,
} from "./sandbox-image";
import { probeComputerUseDisplay } from "./worker-commands";
import {
  loadSandboxHostConfig,
  removeSandboxHostEntry,
  type SandboxHostEntry,
  upsertSandboxHostEntry,
} from "./sandbox-host-config";

/**
 * `briar sandbox` command handlers.
 *
 * Host-side commands (`up`, `status`, `stop`, `recreate`, `rm`, `logs`,
 * `shell`, `login`) drive Docker from the machine that owns the Briar session,
 * optionally through a Docker context that reaches another computer such as
 * a GX10. Container-side commands (`bootstrap`, `report`, `supervise`) are
 * what those host commands invoke inside the container; they are unlisted.
 */

const requestedName = () => sandboxName(value("--name"));

async function resolveDocker(name: string, entry?: SandboxHostEntry) {
  const explicitContext = value("--context");
  const explicitHost = value("--host");
  if (explicitContext && explicitHost) {
    throw new Error("Use only one of --context or --host");
  }
  // A removed sandbox keeps its host in the registry while `rm --purge`
  // deletes the Docker context Briar created, so re-ensure the context from
  // the host whenever no explicit routing flag is given.
  const host = explicitHost ?? (explicitContext ? undefined : entry?.host);
  if (host) {
    const contextName = await ensureDockerContext(createDockerRunner(undefined), {
      name,
      host,
    });
    return { docker: createDockerRunner(contextName), dockerContext: contextName, host };
  }
  const dockerContext = explicitContext ?? entry?.dockerContext;
  return { docker: createDockerRunner(dockerContext), dockerContext, host: entry?.host };
}

async function registryEntry(name: string) {
  const registry = await loadSandboxHostConfig();
  return registry.sandboxes[name];
}

async function optionalFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
}

async function bootstrapPayload(input: {
  readonly name: string;
  readonly teamIds: readonly string[];
}): Promise<SandboxBootstrapPayload> {
  const config = await loadConfig();
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  if (!userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  if (!config.apiUrl.startsWith("https://")) {
    throw new Error("Sandboxes can only reach an HTTPS Briar API");
  }
  const candidates = input.teamIds.length > 0
    ? input.teamIds
    : config.teams.map((project) => project.id);
  if (candidates.length === 0) {
    throw new Error("이 컴퓨터에 연결된 팀이 없습니다. --team 으로 지정하세요.");
  }
  const teams = candidates.map((projectId) => {
    const project = config.teams.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error(`팀 ${projectId} 은 이 컴퓨터에 연결되어 있지 않습니다.`);
    }
    if (!project.agentToken) {
      throw new Error(
        `팀 ${projectId} 에 agent token이 없어 sandbox로 넘길 수 없습니다.`,
      );
    }
    return { id: project.id, agentToken: project.agentToken };
  });
  const codexAuth = has("--no-provider-auth")
    ? undefined
    : await optionalFile(join(homedir(), ".codex", "auth.json"));
  const gitName = gitValueAt(homedir(), ["config", "--global", "--get", "user.name"]);
  const gitEmail = gitValueAt(homedir(), ["config", "--global", "--get", "user.email"]);
  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    apiUrl: config.apiUrl,
    userToken,
    label: value("--label") ?? `sandbox-${input.name}`,
    teams,
    ...(codexAuth === undefined ? {} : { codexAuth }),
    ...(gitName && gitEmail ? { gitIdentity: { name: gitName, email: gitEmail } } : {}),
  };
}

function printStatus(status: Awaited<ReturnType<typeof getSandboxStatus>>) {
  console.log(JSON.stringify(status, null, 2));
}

async function pushBootstrap(
  docker: DockerRunner,
  name: string,
  payload: SandboxBootstrapPayload,
) {
  const result = await docker([
    "exec",
    "--interactive",
    sandboxContainerName(name),
    SANDBOX_CLI_PATH,
    "sandbox",
    "bootstrap",
  ], { stdin: `${JSON.stringify(payload)}\n` });
  if (!result.ok) {
    throw new Error(`Sandbox bootstrap failed:\n${result.output}`);
  }
  if (result.output.length > 0) console.error(result.output);
}

export async function sandboxUpCommand() {
  const name = requestedName();
  const entry = await registryEntry(name);
  const { docker, dockerContext, host } = await resolveDocker(name, entry);
  const teamIds = values("--team");
  const gpus = has("--gpus") || (entry?.gpus === true && !has("--no-gpus"));
  const mirror = debianMirror(value("--debian-mirror") ?? entry?.debianMirror);
  const viewPort = sandboxViewPort(value("--view-port") ?? entry?.viewPort);
  const payload = await bootstrapPayload({ name, teamIds });
  const sources = await resolveSandboxRuntimeSources();
  const stagingDirectory = await mkdtemp(join(tmpdir(), "briar-sandbox-"));
  try {
    const context = await stageSandboxBuildContext({
      directory: stagingDirectory,
      cliBundlePath: sources.cliBundlePath,
      agentDirectory: sources.agentDirectory,
    });
    console.error(
      `Sandbox ${name}: runtime ${context.runtimeSha256.slice(0, 12)}${
        dockerContext ? ` via ${dockerContext}` : ""
      }`,
    );
    const status = await ensureSandbox(docker, {
      name,
      runtimeSha256: context.runtimeSha256,
      buildContextDirectory: stagingDirectory,
      gpus,
      debianMirror: mirror,
      viewPort,
      bootstrap: () => pushBootstrap(docker, name, payload),
      log: (message) => console.error(message),
    });
    await upsertSandboxHostEntry(name, {
      ...(dockerContext ? { dockerContext } : {}),
      ...(host ? { host } : {}),
      teamIds: payload.teams.map((project) => project.id),
      gpus,
      ...(mirror === DEFAULT_DEBIAN_MIRROR ? {} : { debianMirror: mirror }),
      ...(viewPort === DEFAULT_SANDBOX_VIEW_PORT ? {} : { viewPort }),
      runtimeSha256: context.runtimeSha256,
      updatedAt: new Date().toISOString(),
    });
    printStatus(status);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function sandboxStatusCommand() {
  const name = requestedName();
  const entry = await registryEntry(name);
  const { docker } = await resolveDocker(name, entry);
  printStatus(await getSandboxStatus(docker, name));
}

export async function sandboxStopCommand() {
  const name = requestedName();
  const { docker } = await resolveDocker(name, await registryEntry(name));
  const stopped = await stopSandbox(docker, name);
  console.log(JSON.stringify({ name, stopped }));
}

export async function sandboxRecreateCommand() {
  const name = requestedName();
  const entry = await registryEntry(name);
  const { docker } = await resolveDocker(name, entry);
  await restartSandbox(docker, name);
  printStatus(await getSandboxStatus(docker, name));
}

export async function sandboxRemoveCommand() {
  const name = requestedName();
  const entry = await registryEntry(name);
  const { docker, dockerContext, host } = await resolveDocker(name, entry);
  const purge = has("--purge");
  const result = await removeSandbox(docker, name, {
    purge,
    unregisterWorkers: !has("--keep-workers"),
    ...(entry?.runtimeSha256 ? { imageTag: sandboxImageTag(entry.runtimeSha256) } : {}),
    // Only a context Briar created from --host is ours to delete.
    ...(host && dockerContext
      ? { dockerContext, contextRunner: createDockerRunner(undefined) }
      : {}),
  });
  await removeSandboxHostEntry(name);
  if (result.unregisterDetail) console.error(result.unregisterDetail);
  for (const team of result.unregistered?.teams ?? []) {
    if (team.state === "failed") {
      console.error(`Team ${team.id}: worker ${team.workerId ?? "?"} was not unregistered (${team.detail ?? "unknown error"})`);
    }
  }
  console.log(JSON.stringify({
    name,
    removed: result.existed,
    purged: purge,
    workers: result.unregistered?.teams ?? [],
    volumeRemoved: result.volumeRemoved,
    imageRemoved: result.imageRemoved,
    contextRemoved: result.contextRemoved,
  }, null, 2));
}

export async function sandboxUnregisterCommand() {
  console.log(JSON.stringify(await runSandboxUnregister()));
}

export async function sandboxLogsCommand() {
  const name = requestedName();
  const { dockerContext } = await resolveDocker(name, await registryEntry(name));
  const tail = value("--tail") ?? "200";
  if (!/^[0-9]{1,6}$/u.test(tail)) throw new Error("--tail must be a number");
  await runInteractiveDocker(dockerContext, [
    "logs",
    "--tail",
    tail,
    ...(has("--follow") ? ["--follow"] : []),
    sandboxContainerName(name),
  ]);
}

export async function sandboxShellCommand() {
  const name = requestedName();
  const { dockerContext } = await resolveDocker(name, await registryEntry(name));
  await runInteractiveDocker(dockerContext, [
    "exec",
    ...ttyFlags(),
    sandboxContainerName(name),
    "/bin/bash",
    "-l",
  ]);
}

export async function sandboxLoginCommand() {
  const name = requestedName();
  const rawProvider = value("--provider");
  const provider = managedComputerSetupProviders.find(
    (candidate): candidate is ManagedComputerSetupProvider => candidate === rawProvider,
  );
  if (!provider) {
    throw new Error(
      `--provider must be one of ${managedComputerSetupProviders.join(", ")}`,
    );
  }
  const { dockerContext } = await resolveDocker(name, await registryEntry(name));
  const command = managedComputerProviderAuthCommand(provider);
  await runInteractiveDocker(dockerContext, [
    "exec",
    ...ttyFlags(),
    sandboxContainerName(name),
    command.binary,
    ...command.args,
  ]);
}

function ttyFlags() {
  return process.stdin.isTTY ? ["--interactive", "--tty"] : ["--interactive"];
}

function runInteractiveDocker(context: string | undefined, args: string[]) {
  return new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(
      "docker",
      [...(context ? ["--context", context] : []), ...args],
      { stdio: "inherit" },
    );
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`docker exited with status ${code ?? "signal"}`));
    });
  });
}

// Container-side commands.

export async function sandboxBootstrapCommand() {
  const payload = decodeSandboxBootstrapPayload(await readStdin());
  await runSandboxBootstrap(payload);
  console.log(JSON.stringify(await sandboxReport()));
}

export async function sandboxReportCommand() {
  console.log(JSON.stringify(await sandboxReport()));
}

export function sandboxSuperviseCommand() {
  return runSandboxSupervisor();
}

/** Run the Computer Use box service in the foreground (container side). */
export async function sandboxBoxExecCommand() {
  const service = new ComputerUseBoxService();
  await service.start();
  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await new Promise<never>(() => undefined);
}

/**
 * Drive a real display end to end: assign a Computer Use window, take a
 * screenshot, and release it. Container side; `briar sandbox verify` runs it
 * over `docker exec`.
 */
export async function sandboxComputerUseCheckCommand() {
  const serviceHealthy = await computerUseServiceHealthy();
  const displayReady = serviceHealthy ? await probeComputerUseDisplay() : false;
  console.log(JSON.stringify({ serviceHealthy, displayReady }));
  if (!displayReady) process.exitCode = 1;
}

/** Host side: prove the sandbox can render and capture a desktop. */
export async function sandboxVerifyCommand() {
  const name = requestedName();
  const { docker } = await resolveDocker(name, await registryEntry(name));
  const result = await docker([
    "exec",
    sandboxContainerName(name),
    SANDBOX_CLI_PATH,
    "sandbox",
    "computer-use-check",
  ]);
  console.log(result.output);
  if (!result.ok) throw new Error("Sandbox Computer Use verification failed");
}

export function sandboxViewPort(raw: string | number | undefined): number {
  if (raw === undefined) return DEFAULT_SANDBOX_VIEW_PORT;
  const port = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--view-port must be a TCP port between 1024 and 65535");
  }
  return port;
}

/** Parse `user@host[:port]` out of an `ssh://` Docker endpoint for a tunnel. */
export function sshTunnelTarget(host: string | undefined) {
  if (!host?.startsWith("ssh://")) return null;
  const url = new URL(host);
  return {
    destination: `${url.username ? `${url.username}@` : ""}${url.hostname}`,
    port: url.port ? Number.parseInt(url.port, 10) : undefined,
  };
}

export function sandboxViewUrl(viewPort: number, displayIndex: number) {
  const path = encodeURIComponent(`websockify?token=display${displayIndex}`);
  return `http://127.0.0.1:${viewPort}/vnc.html?autoconnect=1&resize=scale&path=${path}`;
}

/**
 * Watch what an agent sees, Grok Bot style: noVNC is published on the Docker
 * host's loopback, so a remote host is reached through an SSH port forward
 * that lives as long as this command.
 */
export async function sandboxViewCommand() {
  const name = requestedName();
  const entry = await registryEntry(name);
  const { docker, host } = await resolveDocker(name, entry);
  const status = await getSandboxStatus(docker, name);
  if (!status.running) throw new Error(`Sandbox ${name} is not running`);
  const displays = status.report?.computerUse?.displays ?? [];
  const requested = value("--display");
  // Prefer the display an agent is working on; otherwise open the owner's
  // always-on desktop :1 so the sandbox can be seen even while idle.
  const displayIndex = requested !== undefined
    ? Number.parseInt(requested, 10)
    : displays[0]?.displayIndex ?? 1;
  if (requested === undefined && displays.length === 0) {
    console.error("No agent holds a Computer Use display; opening the owner desktop :1");
  }
  if (!Number.isInteger(displayIndex) || displayIndex < 1 || displayIndex > 100) {
    throw new Error("--display must be between 1 and 100");
  }
  const viewPort = sandboxViewPort(entry?.viewPort);
  const url = sandboxViewUrl(viewPort, displayIndex);
  const tunnel = sshTunnelTarget(host);
  if (tunnel) {
    console.error(`Forwarding 127.0.0.1:${viewPort} through ${tunnel.destination}; press Ctrl-C to stop`);
    const ssh = spawn("ssh", [
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      ...(tunnel.port ? ["-p", String(tunnel.port)] : []),
      "-L",
      `127.0.0.1:${viewPort}:127.0.0.1:${viewPort}`,
      tunnel.destination,
    ], { stdio: ["ignore", "inherit", "inherit"] });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (ssh.exitCode !== null) throw new Error("SSH port forward exited before the view opened");
    console.error(url);
    openBrowser(url);
    await new Promise<void>((resolve) => {
      ssh.once("exit", () => resolve());
      process.once("SIGINT", () => ssh.kill("SIGTERM"));
      process.once("SIGTERM", () => ssh.kill("SIGTERM"));
    });
    return;
  }
  console.log(url);
  openBrowser(url);
}
