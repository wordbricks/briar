import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { configDirectory } from "./command-support";

/**
 * Host-side registry of sandboxes this machine manages. It lives beside
 * `config.json` but stays a separate file so the desktop app's LocalConfig
 * contract is untouched. Only routing data is stored here: which Docker
 * context reaches the sandbox and which projects it serves. Credentials never
 * enter this file.
 */

const strictParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const SandboxHostEntry = Schema.Struct({
  dockerContext: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  host: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  teamIds: Schema.Array(Schema.String.check(Schema.isUUID())),
  gpus: Schema.Boolean,
  debianMirror: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  viewPort: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 }))),
  runtimeSha256: Schema.String,
  updatedAt: Schema.String,
});
export type SandboxHostEntry = typeof SandboxHostEntry.Type;

const SandboxHostConfig = Schema.Struct({
  version: Schema.Literal(1),
  sandboxes: Schema.Record(Schema.String, SandboxHostEntry),
}).annotate({ parseOptions: strictParseOptions });
export type SandboxHostConfig = typeof SandboxHostConfig.Type;

const decodeSandboxHostConfig = Schema.decodeUnknownSync(
  Schema.fromJsonString(SandboxHostConfig),
  strictParseOptions,
);

/**
 * Registries written before the project-to-team rename keyed the served
 * teams as `projectIds`. Rewrite that key in place so an existing sandbox
 * keeps working; the next save persists the current name.
 */
export function migrateLegacySandboxHostConfig(raw: string): string {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("sandboxes" in parsed)) return raw;
  const sandboxes = (parsed as { sandboxes: unknown }).sandboxes;
  if (!sandboxes || typeof sandboxes !== "object") return raw;
  let changed = false;
  for (const entry of Object.values(sandboxes as Record<string, unknown>)) {
    if (
      entry && typeof entry === "object" && "projectIds" in entry &&
      !("teamIds" in entry)
    ) {
      const legacy = entry as { projectIds?: unknown; teamIds?: unknown };
      legacy.teamIds = legacy.projectIds;
      delete legacy.projectIds;
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : raw;
}

export const sandboxHostConfigPath = (directory = configDirectory) =>
  join(directory, "sandboxes.json");

const emptyConfig: SandboxHostConfig = { version: 1, sandboxes: {} };

export async function loadSandboxHostConfig(
  directory = configDirectory,
): Promise<SandboxHostConfig> {
  let contents: string;
  try {
    contents = await readFile(sandboxHostConfigPath(directory), "utf8");
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return emptyConfig;
    throw error;
  }
  try {
    return decodeSandboxHostConfig(migrateLegacySandboxHostConfig(contents));
  } catch {
    throw new Error(
      `Sandbox registry ${sandboxHostConfigPath(directory)} is corrupted; fix or delete it`,
    );
  }
}

export async function saveSandboxHostConfig(
  config: SandboxHostConfig,
  directory = configDirectory,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    sandboxHostConfigPath(directory),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function upsertSandboxHostEntry(
  name: string,
  entry: SandboxHostEntry,
  directory = configDirectory,
) {
  const config = await loadSandboxHostConfig(directory);
  await saveSandboxHostConfig({
    version: 1,
    sandboxes: { ...config.sandboxes, [name]: entry },
  }, directory);
}

/**
 * Forget a removed sandbox's teams and runtime but keep how to reach its Docker
 * host, so a later `sandbox up --name <name>` without `--host` recreates it on
 * the same machine instead of silently targeting the local daemon.
 */
export async function removeSandboxHostEntry(
  name: string,
  directory = configDirectory,
) {
  const config = await loadSandboxHostConfig(directory);
  const { [name]: removed, ...rest } = config.sandboxes;
  if (removed === undefined) return;
  const retained: SandboxHostEntry = {
    ...(removed.dockerContext ? { dockerContext: removed.dockerContext } : {}),
    ...(removed.host ? { host: removed.host } : {}),
    ...(removed.debianMirror ? { debianMirror: removed.debianMirror } : {}),
    ...(removed.viewPort ? { viewPort: removed.viewPort } : {}),
    teamIds: [],
    gpus: removed.gpus,
    runtimeSha256: "",
    updatedAt: new Date().toISOString(),
  };
  await saveSandboxHostConfig(
    { version: 1, sandboxes: { ...rest, [name]: retained } },
    directory,
  );
}
