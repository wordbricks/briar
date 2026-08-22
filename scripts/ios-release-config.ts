import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type IOSImplementation = "tauri" | "native";
export type IOSReleaseChannel = "internal" | "production";

export type IOSReleaseConfig = {
  schemaVersion: 1;
  defaultImplementation: IOSImplementation;
  bundleIdentifier: string;
  rollback: {
    implementation: "tauri";
    preserveSourceThroughVersion: string;
  };
  nativeStabilization: null | {
    status: "passed";
    buildId: string;
    approvedAt: string;
  };
};

const implementations = new Set<IOSImplementation>(["tauri", "native"]);
const semanticVersion = /^\d+\.\d+\.\d+$/;
const repositoryRoot = resolve(import.meta.dir, "..");

function resolveRepositoryPath(path: string) {
  return isAbsolute(path) ? path : resolve(repositoryRoot, path);
}

const fail = (message: string): never => {
  throw new Error(`[ios-release-config] ${message}`);
};

export function parseIOSReleaseConfig(value: unknown): IOSReleaseConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Configuration must be a JSON object.");
  }
  const config = value as Record<string, unknown>;
  if (config.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (!implementations.has(config.defaultImplementation as IOSImplementation)) {
    fail("defaultImplementation must be tauri or native.");
  }
  if (config.bundleIdentifier !== "app.briar.companion") {
    fail("bundleIdentifier must preserve the existing app.briar.companion App Store identity.");
  }

  const rollback = config.rollback as Record<string, unknown> | undefined;
  if (!rollback || rollback.implementation !== "tauri") {
    fail("rollback.implementation must remain tauri for the first native release.");
  }
  if (
    typeof rollback.preserveSourceThroughVersion !== "string" ||
    !semanticVersion.test(rollback.preserveSourceThroughVersion)
  ) {
    fail("rollback.preserveSourceThroughVersion must be a semantic version.");
  }

  let nativeStabilization: IOSReleaseConfig["nativeStabilization"] = null;
  if (config.nativeStabilization !== null) {
    const stabilization = config.nativeStabilization as Record<string, unknown> | undefined;
    if (
      !stabilization ||
      stabilization.status !== "passed" ||
      typeof stabilization.buildId !== "string" ||
      stabilization.buildId.trim() === "" ||
      typeof stabilization.approvedAt !== "string" ||
      !Number.isFinite(Date.parse(stabilization.approvedAt))
    ) {
      fail("nativeStabilization must record a passed App Store build ID and valid approval time.");
    }
    nativeStabilization = {
      status: "passed",
      buildId: stabilization.buildId,
      approvedAt: stabilization.approvedAt,
    };
  }

  if (config.defaultImplementation === "native" && !nativeStabilization) {
    fail("The default cannot switch to native before Internal TestFlight stabilization passes.");
  }

  return {
    schemaVersion: 1,
    defaultImplementation: config.defaultImplementation as IOSImplementation,
    bundleIdentifier: config.bundleIdentifier,
    rollback: {
      implementation: "tauri",
      preserveSourceThroughVersion: rollback.preserveSourceThroughVersion as string,
    },
    nativeStabilization,
  };
}

export function resolveIOSRelease(
  config: IOSReleaseConfig,
  channel: IOSReleaseChannel,
  override?: IOSImplementation,
) {
  const implementation = override ?? config.defaultImplementation;
  if (!implementations.has(implementation)) fail("Implementation must be tauri or native.");
  if (channel === "production" && implementation === "native" && !config.nativeStabilization) {
    fail("Native Production is locked until the Internal TestFlight build is recorded as stabilized.");
  }
  return {
    channel,
    implementation,
    bundleIdentifier: config.bundleIdentifier,
    stabilizationBuildId: config.nativeStabilization?.buildId ?? null,
    rollbackImplementation: config.rollback.implementation,
    preserveTauriSourceThroughVersion: config.rollback.preserveSourceThroughVersion,
  };
}

function readConfig(path: string) {
  if (!existsSync(path)) fail(`Missing configuration: ${path}`);
  return parseIOSReleaseConfig(JSON.parse(readFileSync(path, "utf8")));
}

function argumentValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value.`);
  return value;
}

export function main(args = process.argv.slice(2)) {
  const command = args[0];
  const configPath = resolveRepositoryPath(
    argumentValue(args, "--config") ?? process.env.BRIAR_IOS_RELEASE_CONFIG ?? "config/ios-release.json",
  );
  const config = readConfig(configPath);

  if (command === "verify") {
    if (
      !existsSync(
        resolveRepositoryPath("apps/briar/ios/BriarCompanion/App/SessionStore.swift"),
      )
    ) {
      fail("Native session migration source is missing.");
    }
    if (
      !existsSync(
        resolveRepositoryPath("apps/briar/src-tauri/gen/apple/project.yml"),
      )
    ) {
      fail("Tauri iOS rollback source is missing.");
    }
    process.stdout.write(`${JSON.stringify(config)}\n`);
    return;
  }
  if (command === "resolve") {
    const channel = argumentValue(args, "--channel") as IOSReleaseChannel | undefined;
    const override = argumentValue(args, "--implementation") as IOSImplementation | undefined;
    if (channel !== "internal" && channel !== "production") {
      fail("--channel must be internal or production.");
    }
    if (override && !implementations.has(override)) fail("--implementation must be tauri or native.");
    process.stdout.write(`${JSON.stringify(resolveIOSRelease(config, channel, override))}\n`);
    return;
  }
  fail("Usage: ios-release-config.ts verify|resolve [--channel internal|production] [--implementation tauri|native]");
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
