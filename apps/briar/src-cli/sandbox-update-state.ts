import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { configDirectory } from "./command-support";
import { SANDBOX_CLI_PATH } from "./sandbox-image";

const Id = Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u));
export const SandboxUpdateProvider = Schema.Literals(["codex", "claude", "opencode", "grok"]);
export type SandboxUpdateProvider = typeof SandboxUpdateProvider.Type;
export const SandboxUpdateRequest = Schema.Struct({
  id: Id,
  provider: Schema.optional(SandboxUpdateProvider),
  targetVersion: Schema.optional(Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u))),
  rollback: Schema.Boolean,
});
export type SandboxUpdateRequest = typeof SandboxUpdateRequest.Type;
export const SandboxRuntime = Schema.Struct({
  id: Schema.String,
  cli: Schema.String,
  paths: Schema.Array(Schema.String),
  versions: Schema.Record(Schema.String, Schema.String),
  integrity: Schema.Record(Schema.String, Schema.String),
});
export type SandboxRuntime = typeof SandboxRuntime.Type;
const Activation = Schema.Struct({
  runtime: SandboxRuntime,
  previous: Schema.NullOr(SandboxRuntime),
  updateRequestId: Schema.optional(Id),
});
export type SandboxActivation = typeof Activation.Type;
export const SandboxUpdateJournal = Schema.Struct({
  request: SandboxUpdateRequest,
  phase: Schema.Literals([
    "preparing", "draining", "activating", "verifying", "rolling_back",
    "completed", "rolled_back", "failed",
  ]),
  startedAt: Schema.Finite,
  phaseStartedAt: Schema.Finite,
  before: Activation,
  staged: Schema.optional(SandboxRuntime),
  serverRequestId: Schema.optional(Id),
  expectedProviders: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
});
export type SandboxUpdateJournal = typeof SandboxUpdateJournal.Type;
export const sandboxUpdateRoot = () => join(configDirectory, "sandbox-runtime");

export async function readSandboxJson<S extends Schema.ConstraintDecoder<unknown, never>>(path: string, schema: S): Promise<S["Type"] | null> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return Schema.decodeUnknownSync(schema)(JSON.parse(raw));
}

export async function writeSandboxJson(path: string, data: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(data, null, 2)}\n`);
    await file.sync();
  } finally { await file.close(); }
  await rename(temporary, path);
}

export async function sandboxActivation(root = sandboxUpdateRoot()): Promise<SandboxActivation> {
  return await readSandboxJson(join(root, "current.json"), Activation) ?? {
    runtime: { id: "image", cli: SANDBOX_CLI_PATH, paths: [], versions: {}, integrity: {} },
    previous: null,
  };
}

export const sandboxRuntimeEnvironment = (activation: SandboxActivation): NodeJS.ProcessEnv => ({
  BRIAR_CLI: activation.runtime.cli,
  PATH: [...activation.runtime.paths, process.env.PATH ?? ""].join(":"),
  BRIAR_SANDBOX_UPDATER: "1",
  BRIAR_SANDBOX_UPDATE_REQUEST_ID: activation.updateRequestId ?? "",
  BRIAR_SANDBOX_RUNTIME_VERSIONS: JSON.stringify(activation.runtime.versions),
  DISABLE_AUTOUPDATER: "1",
});

export function sandboxWorkerRuntimeMetadata(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.BRIAR_SANDBOX_UPDATER !== "1") return {};
  const versions = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
    JSON.parse(environment.BRIAR_SANDBOX_RUNTIME_VERSIONS ?? "{}"),
  );
  const updateRequestId = environment.BRIAR_SANDBOX_UPDATE_REQUEST_ID
    ? Schema.decodeSync(Id)(environment.BRIAR_SANDBOX_UPDATE_REQUEST_ID) : undefined;
  return { versions, updateRequestId };
}

export async function submitSandboxUpdate(request: SandboxUpdateRequest, root = sandboxUpdateRoot()) {
  const decoded = Schema.decodeSync(SandboxUpdateRequest)(request);
  if (decoded.rollback && decoded.provider) throw new Error("--rollback cannot be combined with --provider");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "pending.json");
  const temporary = `${path}.${randomUUID()}.request`;
  await writeSandboxJson(temporary, decoded);
  try {
    // Publish a complete request exclusively: readers never observe a partial write.
    await link(temporary, path);
    return decoded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pending = await readSandboxJson(path, SandboxUpdateRequest);
    if (pending && (pending.id === request.id ||
      (pending.provider === request.provider && pending.rollback === request.rollback &&
        pending.targetVersion === request.targetVersion))) return pending;
    throw new Error("A different sandbox update is already running; inspect `briar sandbox update --status`");
  } finally { await unlink(temporary); }
}

export async function clearSandboxUpdate(requestId: string, root = sandboxUpdateRoot()) {
  const path = join(root, "pending.json");
  const pending = await readSandboxJson(path, SandboxUpdateRequest);
  if (pending?.id === requestId) await unlink(path);
}

export const sandboxUpdateFinished = (phase: SandboxUpdateJournal["phase"]) =>
  phase === "completed" || phase === "rolled_back" || phase === "failed";
