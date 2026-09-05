import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ManagedComputerSetupProvider,
  managedComputerSetupProviders,
} from "../src/lib/agent-provider";
import { gitValueAt, has, loadConfig, value, values } from "./command-support";
import {
  managedComputerProviderAuthCommand,
} from "./managed-computer-setup-agent";
import {
  decodeSandboxBootstrapPayload,
  readStdin,
  runSandboxBootstrap,
  runSandboxSupervisor,
  sandboxReport,
  type SandboxBootstrapPayload,
} from "./sandbox-bootstrap";
import {
  createDockerRunner,
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
  SANDBOX_CLI_PATH,
  SANDBOX_SCHEMA_VERSION,
  resolveSandboxRuntimeSources,
  stageSandboxBuildContext,
} from "./sandbox-image";
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
  const host = value("--host");
  if (explicitContext && host) {
    throw new Error("Use only one of --context or --host");
  }
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
  readonly projectIds: readonly string[];
}): Promise<SandboxBootstrapPayload> {
  const config = await loadConfig();
  const userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  if (!userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  if (!config.apiUrl.startsWith("https://")) {
    throw new Error("Sandboxes can only reach an HTTPS Briar API");
  }
  const candidates = input.projectIds.length > 0
    ? input.projectIds
    : config.projects.map((project) => project.id);
  if (candidates.length === 0) {
    throw new Error("이 컴퓨터에 연결된 프로젝트가 없습니다. --project 로 지정하세요.");
  }
  const projects = candidates.map((projectId) => {
    const project = config.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error(`프로젝트 ${projectId} 는 이 컴퓨터에 연결되어 있지 않습니다.`);
    }
    if (!project.agentToken) {
      throw new Error(
        `프로젝트 ${projectId} 에 agent token이 없어 sandbox로 넘길 수 없습니다.`,
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
    projects,
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
  const projectIds = values("--project");
  const gpus = has("--gpus") || (entry?.gpus === true && !has("--no-gpus"));
  const payload = await bootstrapPayload({ name, projectIds });
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
      bootstrap: () => pushBootstrap(docker, name, payload),
      log: (message) => console.error(message),
    });
    await upsertSandboxHostEntry(name, {
      ...(dockerContext ? { dockerContext } : {}),
      ...(host ? { host } : {}),
      projectIds: payload.projects.map((project) => project.id),
      gpus,
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
  const { docker } = await resolveDocker(name, entry);
  const purge = has("--purge");
  const removed = await removeSandbox(docker, name, { purge });
  await removeSandboxHostEntry(name);
  console.log(JSON.stringify({ name, removed, purged: purge }));
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
