import { spawn } from "node:child_process";
import * as Schema from "effect/Schema";
import {
  SANDBOX_CLI_PATH,
  SANDBOX_HOME,
  SANDBOX_SCHEMA_VERSION,
  sandboxImageTag,
} from "./sandbox-image";

/**
 * Host-side Docker connector for Briar sandboxes.
 *
 * This is the Briar port of Grok Bot's local Docker VM connector: a fixed,
 * owner-labelled container that the CLI creates, validates, and replaces
 * whenever the embedded runtime changes. Unlike Grok Bot, the sandbox needs no
 * published ports because every Briar worker connection is outbound, and the
 * Docker daemon may live on another machine (for example an ARM64 GX10) that
 * is reached through a Docker context.
 */

export const SANDBOX_OWNER_LABEL = "com.briar.sandbox";
export const SANDBOX_NAME_LABEL = "com.briar.sandbox.name";
export const SANDBOX_RUNTIME_LABEL = "com.briar.sandbox.runtime-sha256";
export const SANDBOX_SCHEMA_LABEL = "com.briar.sandbox.schema-version";
export const SANDBOX_GPU_LABEL = "com.briar.sandbox.gpus";
export const DEFAULT_SANDBOX_NAME = "default";
export const SANDBOX_READY_TIMEOUT_MS = 180_000;

const SandboxName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/u),
);
const decodeSandboxName = Schema.decodeUnknownSync(SandboxName);

export function sandboxName(raw: string | undefined): string {
  try {
    return decodeSandboxName(raw ?? DEFAULT_SANDBOX_NAME);
  } catch {
    throw new Error(
      "Sandbox name must be 1-40 lowercase letters, digits, or hyphens",
    );
  }
}

export const sandboxContainerName = (name: string) => `briar-sandbox-${name}`;
export const sandboxHomeVolume = (name: string) =>
  `briar-sandbox-${name}-home`;

export interface DockerCommandResult {
  readonly ok: boolean;
  readonly output: string;
}

export type DockerRunner = (
  args: readonly string[],
  options?: { readonly stdin?: string },
) => Promise<DockerCommandResult>;

/**
 * Run the Docker CLI against `context` (or the default daemon). Output is
 * capped so a runaway log cannot exhaust memory, mirroring Grok Bot.
 */
export function createDockerRunner(
  context: string | undefined,
  binary = "docker",
): DockerRunner {
  return (args, options) =>
    new Promise((resolveResult) => {
      const child = spawn(
        binary,
        [...(context ? ["--context", context] : []), ...args],
        { stdio: [options?.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] },
      );
      let output = "";
      const append = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > 200_000) output = output.slice(-200_000);
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", (error) =>
        resolveResult({ ok: false, output: `${output}\n${error.message}`.trim() }));
      child.once("close", (code) =>
        resolveResult({ ok: code === 0, output: output.trim() }));
      if (options?.stdin !== undefined && child.stdin) {
        child.stdin.end(options.stdin);
      }
    });
}

export interface SandboxInspection {
  readonly exists: boolean;
  readonly running: boolean;
  readonly owned: boolean;
  readonly image: string;
  readonly runtimeSha256: string;
  readonly schemaVersion: string;
  readonly gpus: boolean;
}

const missingContainer: SandboxInspection = {
  exists: false,
  running: false,
  owned: false,
  image: "",
  runtimeSha256: "",
  schemaVersion: "",
  gpus: false,
};

const InspectedContainer = Schema.Struct({
  State: Schema.optional(Schema.Struct({ Running: Schema.optional(Schema.Boolean) })),
  Config: Schema.optional(Schema.Struct({
    Image: Schema.optional(Schema.String),
    Labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  })),
});
const decodeInspectedContainer = Schema.decodeUnknownSync(InspectedContainer);

export async function inspectSandboxContainer(
  docker: DockerRunner,
  name: string,
): Promise<SandboxInspection> {
  const result = await docker([
    "inspect",
    "--format",
    "{{json .}}",
    sandboxContainerName(name),
  ]);
  if (!result.ok) return missingContainer;
  let value: typeof InspectedContainer.Type;
  try {
    value = decodeInspectedContainer(JSON.parse(result.output));
  } catch {
    throw new Error("Docker returned malformed container inspection data.");
  }
  const labels = value.Config?.Labels ?? {};
  return {
    exists: true,
    running: value.State?.Running === true,
    owned: labels[SANDBOX_OWNER_LABEL] === "1" &&
      labels[SANDBOX_NAME_LABEL] === name,
    image: value.Config?.Image ?? "",
    runtimeSha256: labels[SANDBOX_RUNTIME_LABEL] ?? "",
    schemaVersion: labels[SANDBOX_SCHEMA_LABEL] ?? "",
    gpus: labels[SANDBOX_GPU_LABEL] === "1",
  };
}

const SandboxReportTeam = Schema.Struct({
  id: Schema.String,
  registered: Schema.Boolean,
  workerId: Schema.NullOr(Schema.String),
  repositoryPath: Schema.NullOr(Schema.String),
  repositoryPresent: Schema.Boolean,
});
export const SandboxReport = Schema.Struct({
  schemaVersion: Schema.String,
  ready: Schema.Boolean,
  supervisorRunning: Schema.Boolean,
  detail: Schema.String,
  teams: Schema.Array(SandboxReportTeam),
  providers: Schema.Record(Schema.String, Schema.Boolean),
});
export type SandboxReport = typeof SandboxReport.Type;
export const decodeSandboxReport = Schema.decodeUnknownSync(SandboxReport);

/** Ask the container's CLI how far its bootstrap got. */
export async function readSandboxReport(
  docker: DockerRunner,
  name: string,
): Promise<SandboxReport | null> {
  const result = await docker([
    "exec",
    sandboxContainerName(name),
    SANDBOX_CLI_PATH,
    "sandbox",
    "report",
  ]);
  if (!result.ok) return null;
  try {
    return decodeSandboxReport(JSON.parse(result.output));
  } catch {
    return null;
  }
}

export interface SandboxStatus {
  readonly available: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly containerName: string;
  readonly image: string;
  readonly runtimeSha256: string;
  readonly detail: string;
  readonly report: SandboxReport | null;
}

export async function dockerAvailable(docker: DockerRunner) {
  const daemon = await docker(["info", "--format", "{{.ServerVersion}}"]);
  return daemon.ok
    ? { available: true as const, version: daemon.output }
    : {
      available: false as const,
      detail: daemon.output || "Docker is not running.",
    };
}

export async function getSandboxStatus(
  docker: DockerRunner,
  name: string,
): Promise<SandboxStatus> {
  const containerName = sandboxContainerName(name);
  const daemon = await dockerAvailable(docker);
  if (!daemon.available) {
    return {
      available: false,
      running: false,
      ready: false,
      containerName,
      image: "",
      runtimeSha256: "",
      detail: daemon.detail,
      report: null,
    };
  }
  const inspected = await inspectSandboxContainer(docker, name);
  if (!inspected.exists) {
    return {
      available: true,
      running: false,
      ready: false,
      containerName,
      image: "",
      runtimeSha256: "",
      detail: "Ready to create the sandbox.",
      report: null,
    };
  }
  if (!inspected.owned) {
    return {
      available: true,
      running: inspected.running,
      ready: false,
      containerName,
      image: inspected.image,
      runtimeSha256: "",
      detail: `Container ${containerName} exists but is not owned by Briar.`,
      report: null,
    };
  }
  const report = inspected.running ? await readSandboxReport(docker, name) : null;
  const ready = report?.ready === true;
  return {
    available: true,
    running: inspected.running,
    ready,
    containerName,
    image: inspected.image,
    runtimeSha256: inspected.runtimeSha256,
    detail: ready
      ? "Sandbox is ready."
      : inspected.running
        ? report?.detail ?? "Container is starting."
        : "Sandbox is stopped.",
    report,
  };
}

export interface EnsureSandboxInput {
  readonly name: string;
  readonly runtimeSha256: string;
  readonly buildContextDirectory: string;
  readonly gpus: boolean;
  /** Push the bootstrap payload into the running container. */
  readonly bootstrap: () => Promise<void>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly readyTimeoutMs?: number;
  readonly log?: (message: string) => void;
}

async function ensureSandboxImage(
  docker: DockerRunner,
  input: EnsureSandboxInput,
) {
  const tag = sandboxImageTag(input.runtimeSha256);
  const existing = await docker(["image", "inspect", "--format", "{{.Id}}", tag]);
  if (existing.ok) return tag;
  input.log?.(`Building sandbox image ${tag}`);
  const built = await docker([
    "build",
    "--tag",
    tag,
    "--label",
    `${SANDBOX_RUNTIME_LABEL}=${input.runtimeSha256}`,
    input.buildContextDirectory,
  ]);
  if (!built.ok) {
    throw new Error(`Could not build the sandbox image: ${built.output}`);
  }
  return tag;
}

export function sandboxRunArguments(input: {
  readonly name: string;
  readonly runtimeSha256: string;
  readonly imageTag: string;
  readonly gpus: boolean;
}): string[] {
  return [
    "run",
    "--detach",
    "--name",
    sandboxContainerName(input.name),
    "--label",
    `${SANDBOX_OWNER_LABEL}=1`,
    "--label",
    `${SANDBOX_NAME_LABEL}=${input.name}`,
    "--label",
    `${SANDBOX_RUNTIME_LABEL}=${input.runtimeSha256}`,
    "--label",
    `${SANDBOX_SCHEMA_LABEL}=${SANDBOX_SCHEMA_VERSION}`,
    "--label",
    `${SANDBOX_GPU_LABEL}=${input.gpus ? "1" : "0"}`,
    "--restart",
    "unless-stopped",
    "--init",
    "--volume",
    `${sandboxHomeVolume(input.name)}:${SANDBOX_HOME}`,
    ...(input.gpus ? ["--gpus", "all"] : []),
    input.imageTag,
  ];
}

/**
 * Converge the sandbox container onto the current runtime: build the image if
 * needed, replace a stale or differently configured container, start it,
 * push the bootstrap payload, and wait until the in-container report says
 * every project is registered.
 */
export async function ensureSandbox(
  docker: DockerRunner,
  input: EnsureSandboxInput,
): Promise<SandboxStatus> {
  const sleep = input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const containerName = sandboxContainerName(input.name);
  const daemon = await dockerAvailable(docker);
  if (!daemon.available) {
    throw new Error(`Docker is unavailable: ${daemon.detail}`);
  }
  const inspected = await inspectSandboxContainer(docker, input.name);
  if (inspected.exists && !inspected.owned) {
    throw new Error(
      `Sandbox cannot use ${containerName}: an unowned container already has that name.`,
    );
  }
  const imageTag = await ensureSandboxImage(docker, input);
  const stale = inspected.exists && (
    inspected.schemaVersion !== SANDBOX_SCHEMA_VERSION ||
    inspected.runtimeSha256 !== input.runtimeSha256 ||
    inspected.gpus !== input.gpus
  );
  if (stale) {
    input.log?.(`Replacing ${containerName} with runtime ${input.runtimeSha256.slice(0, 12)}`);
    const removed = await docker(["rm", "--force", containerName]);
    if (!removed.ok) {
      throw new Error(
        `Could not replace the sandbox with the current runtime: ${removed.output}`,
      );
    }
  }
  const current = stale ? missingContainer : inspected;
  if (current.exists && !current.running) {
    const started = await docker(["start", containerName]);
    if (!started.ok) {
      throw new Error(`Could not start the sandbox: ${started.output}`);
    }
  } else if (!current.exists) {
    const created = await docker(sandboxRunArguments({
      name: input.name,
      runtimeSha256: input.runtimeSha256,
      imageTag,
      gpus: input.gpus,
    }));
    if (!created.ok) {
      throw new Error(`Could not create the sandbox: ${created.output}`);
    }
  }
  await input.bootstrap();
  const deadline = Date.now() + (input.readyTimeoutMs ?? SANDBOX_READY_TIMEOUT_MS);
  let lastDetail = "Container is starting.";
  while (Date.now() < deadline) {
    const status = await getSandboxStatus(docker, input.name);
    if (status.ready) return status;
    lastDetail = status.detail;
    if (!status.running) {
      const logs = await docker(["logs", "--tail", "80", containerName]);
      throw new Error(
        `Sandbox stopped before it became ready.\n${logs.output}`,
      );
    }
    await sleep(1_000);
  }
  throw new Error(
    `Sandbox did not become ready within ${Math.round((input.readyTimeoutMs ?? SANDBOX_READY_TIMEOUT_MS) / 60_000)} minutes: ${lastDetail}`,
  );
}

async function requireOwned(docker: DockerRunner, name: string) {
  const inspected = await inspectSandboxContainer(docker, name);
  if (inspected.exists && !inspected.owned) {
    throw new Error(
      `Refusing to touch unowned container ${sandboxContainerName(name)}.`,
    );
  }
  return inspected;
}

export async function stopSandbox(docker: DockerRunner, name: string) {
  const inspected = await requireOwned(docker, name);
  if (!inspected.exists || !inspected.running) return false;
  const stopped = await docker(["stop", sandboxContainerName(name)]);
  if (!stopped.ok) throw new Error(`Could not stop the sandbox: ${stopped.output}`);
  return true;
}

export async function restartSandbox(docker: DockerRunner, name: string) {
  const inspected = await requireOwned(docker, name);
  if (!inspected.exists) throw new Error("Sandbox does not exist; run `briar sandbox up` first.");
  const restarted = await docker(["restart", sandboxContainerName(name)]);
  if (!restarted.ok) {
    throw new Error(`Could not restart the sandbox: ${restarted.output}`);
  }
}

export async function removeSandbox(
  docker: DockerRunner,
  name: string,
  options: { readonly purge: boolean },
) {
  const inspected = await requireOwned(docker, name);
  if (inspected.exists) {
    const removed = await docker(["rm", "--force", sandboxContainerName(name)]);
    if (!removed.ok && !/no such container/iu.test(removed.output)) {
      throw new Error(`Could not remove the sandbox: ${removed.output}`);
    }
  }
  if (options.purge) {
    const volume = await docker(["volume", "rm", sandboxHomeVolume(name)]);
    if (!volume.ok && !/no such volume/iu.test(volume.output)) {
      throw new Error(`Could not remove the sandbox volume: ${volume.output}`);
    }
  }
  return inspected.exists;
}

/** Ensure a Docker context exists for an SSH host and return its name. */
export async function ensureDockerContext(
  docker: DockerRunner,
  input: { readonly name: string; readonly host: string },
) {
  if (!/^(ssh|tcp|unix):\/\//u.test(input.host)) {
    throw new Error("Sandbox host must be an ssh://, tcp://, or unix:// URL");
  }
  const contextName = `briar-sandbox-${input.name}`;
  const existing = await docker([
    "context",
    "inspect",
    "--format",
    "{{.Endpoints.docker.Host}}",
    contextName,
  ]);
  if (existing.ok) {
    if (existing.output !== input.host) {
      const updated = await docker([
        "context",
        "update",
        contextName,
        "--docker",
        `host=${input.host}`,
      ]);
      if (!updated.ok) {
        throw new Error(`Could not update Docker context ${contextName}: ${updated.output}`);
      }
    }
    return contextName;
  }
  const created = await docker([
    "context",
    "create",
    contextName,
    "--docker",
    `host=${input.host}`,
  ]);
  if (!created.ok) {
    throw new Error(`Could not create Docker context ${contextName}: ${created.output}`);
  }
  return contextName;
}
