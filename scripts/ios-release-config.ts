import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import * as Predicate from "effect/Predicate";

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

const semanticVersion = /^\d+\.\d+\.\d+$/;
const repositoryRoot = resolve(import.meta.dir, "..");

function resolveRepositoryPath(path: string) {
  return isAbsolute(path) ? path : resolve(repositoryRoot, path);
}

const fail = (message: string): never => {
  throw new Error(`[ios-release-config] ${message}`);
};

export function parseIOSReleaseConfig(value: unknown): IOSReleaseConfig {
  if (!Predicate.isObject(value)) {
    return fail("Configuration must be a JSON object.");
  }
  const config = value;
  if (config.schemaVersion !== 1) return fail("schemaVersion must be 1.");
  if (
    config.defaultImplementation !== "tauri" &&
    config.defaultImplementation !== "native"
  ) {
    return fail("defaultImplementation must be tauri or native.");
  }
  if (config.bundleIdentifier !== "app.briar.companion") {
    return fail("bundleIdentifier must preserve the existing app.briar.companion App Store identity.");
  }

  const rollback = config.rollback;
  if (!Predicate.isObject(rollback) || rollback.implementation !== "tauri") {
    return fail("rollback.implementation must remain tauri for the first native release.");
  }
  if (
    !Predicate.isString(rollback.preserveSourceThroughVersion) ||
    !semanticVersion.test(rollback.preserveSourceThroughVersion)
  ) {
    return fail("rollback.preserveSourceThroughVersion must be a semantic version.");
  }

  let nativeStabilization: IOSReleaseConfig["nativeStabilization"] = null;
  if (config.nativeStabilization !== null) {
    const stabilization = config.nativeStabilization;
    if (
      !Predicate.isObject(stabilization) ||
      stabilization.status !== "passed" ||
      !Predicate.isString(stabilization.buildId) ||
      stabilization.buildId.trim() === "" ||
      !Predicate.isString(stabilization.approvedAt) ||
      !Number.isFinite(Date.parse(stabilization.approvedAt))
    ) {
      return fail("nativeStabilization must record a passed App Store build ID and valid approval time.");
    }
    nativeStabilization = {
      status: "passed",
      buildId: stabilization.buildId,
      approvedAt: stabilization.approvedAt,
    };
  }

  if (config.defaultImplementation === "native" && !nativeStabilization) {
    return fail("The default cannot switch to native before Internal TestFlight stabilization passes.");
  }

  return {
    schemaVersion: 1,
    defaultImplementation: config.defaultImplementation,
    bundleIdentifier: config.bundleIdentifier,
    rollback: {
      implementation: "tauri",
      preserveSourceThroughVersion: rollback.preserveSourceThroughVersion,
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
  if (implementation !== "tauri" && implementation !== "native") {
    return fail("Implementation must be tauri or native.");
  }
  if (channel === "production" && implementation === "native" && !config.nativeStabilization) {
    return fail("Native Production is locked until the Internal TestFlight build is recorded as stabilized.");
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
      return fail("Native session migration source is missing.");
    }
    if (
      !existsSync(
        resolveRepositoryPath("apps/briar/src-tauri/gen/apple/project.yml"),
      )
    ) {
      return fail("Tauri iOS rollback source is missing.");
    }
    process.stdout.write(`${JSON.stringify(config)}\n`);
    return;
  }
  if (command === "resolve") {
    const channel = argumentValue(args, "--channel");
    const override = argumentValue(args, "--implementation");
    if (channel !== "internal" && channel !== "production") {
      return fail("--channel must be internal or production.");
    }
    if (
      override !== undefined &&
      override !== "tauri" &&
      override !== "native"
    ) {
      return fail("--implementation must be tauri or native.");
    }
    process.stdout.write(`${JSON.stringify(resolveIOSRelease(config, channel, override))}\n`);
    return;
  }
  return fail("Usage: ios-release-config.ts verify|resolve [--channel internal|production] [--implementation tauri|native]");
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(Predicate.isError(error) ? error.message : error);
    process.exit(1);
  }
}
