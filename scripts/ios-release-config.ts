import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export type IOSReleaseChannel = "internal" | "production";

const IOSReleaseConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  implementation: Schema.Literal("native"),
  bundleIdentifier: Schema.Literal("app.briar.companion"),
});

export type IOSReleaseConfig = typeof IOSReleaseConfigSchema.Type;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveRepositoryPath(path: string) {
  return isAbsolute(path) ? path : resolve(repositoryRoot, path);
}

const fail = (message: string): never => {
  throw new Error(`[ios-release-config] ${message}`);
};

export function parseIOSReleaseConfig(value: unknown): IOSReleaseConfig {
  try {
    return Schema.decodeUnknownSync(IOSReleaseConfigSchema, {
      onExcessProperty: "error",
    })(value);
  } catch (error) {
    return fail(
      `Configuration must declare only the native app with schemaVersion 2 and preserve app.briar.companion: ${String(error)}`,
    );
  }
}

export function resolveIOSRelease(
  config: IOSReleaseConfig,
  channel: IOSReleaseChannel,
) {
  return {
    channel,
    implementation: config.implementation,
    bundleIdentifier: config.bundleIdentifier,
  };
}

function readConfig(path: string) {
  if (!existsSync(path)) return fail(`Missing configuration: ${path}`);
  return parseIOSReleaseConfig(JSON.parse(readFileSync(path, "utf8")));
}

function argumentValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return fail(`${name} requires a value.`);
  return value;
}

function rejectUnknownArguments(args: string[], allowed: ReadonlyArray<string>) {
  const allowedArguments = new Set(allowed);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    if (!name || !allowedArguments.has(name)) {
      return fail(`Unknown argument: ${name ?? "<missing>"}.`);
    }
    argumentValue(args, name);
  }
}

export function main(args = process.argv.slice(2)) {
  const command = args[0];
  const configPath = resolveRepositoryPath(
    argumentValue(args, "--config") ?? process.env.BRIAR_IOS_RELEASE_CONFIG ?? "config/ios-release.json",
  );
  const config = readConfig(configPath);

  if (command === "verify") {
    rejectUnknownArguments(args, ["--config"]);
    if (
      !existsSync(
        resolveRepositoryPath("apps/briar/ios/BriarCompanion/App/SessionStore.swift"),
      )
    ) {
      return fail("Native session migration source is missing.");
    }
    for (const obsoletePath of [
      "apps/briar/src-tauri/gen/apple",
      "apps/briar/src-tauri/icons/ios",
      "apps/briar/src-tauri/tauri.ios.conf.json",
      "apps/briar/src-tauri/Info.ios.plist",
      "apps/briar/src-tauri/capabilities/mobile.json",
    ]) {
      if (existsSync(resolveRepositoryPath(obsoletePath))) {
        return fail(`Obsolete Tauri iOS source remains: ${obsoletePath}`);
      }
    }
    process.stdout.write(`${JSON.stringify(config)}\n`);
    return;
  }
  if (command === "resolve") {
    rejectUnknownArguments(args, ["--channel", "--config"]);
    const channel = argumentValue(args, "--channel");
    if (channel !== "internal" && channel !== "production") {
      return fail("--channel must be internal or production.");
    }
    process.stdout.write(`${JSON.stringify(resolveIOSRelease(config, channel))}\n`);
    return;
  }
  return fail("Usage: ios-release-config.ts verify|resolve [--channel internal|production]");
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(Predicate.isError(error) ? error.message : error);
    process.exit(1);
  }
}
