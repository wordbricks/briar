import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  main,
  parseIOSReleaseConfig,
  resolveIOSRelease,
} from "./ios-release-config";

const nativeConfig = {
  schemaVersion: 2,
  implementation: "native",
  bundleIdentifier: "app.briar.companion",
} as const;
const releaseScript = readFileSync(
  new URL("./release-ios.sh", import.meta.url),
  "utf8",
);
const mobileCIScript = readFileSync(
  new URL("./ci-mobile.sh", import.meta.url),
  "utf8",
);

describe("native-only iOS release configuration", () => {
  it("preserves the existing App Store identity for both release channels", () => {
    const config = parseIOSReleaseConfig(nativeConfig);

    expect(resolveIOSRelease(config, "internal")).toEqual({
      channel: "internal",
      implementation: "native",
      bundleIdentifier: "app.briar.companion",
    });
    expect(resolveIOSRelease(config, "production")).toEqual({
      channel: "production",
      implementation: "native",
      bundleIdentifier: "app.briar.companion",
    });
  });

  it("rejects the former Tauri selector and rollback policy", () => {
    expect(() =>
      parseIOSReleaseConfig({
        schemaVersion: 1,
        defaultImplementation: "tauri",
        bundleIdentifier: "app.briar.companion",
        rollback: {
          implementation: "tauri",
          preserveSourceThroughVersion: "1.3.0",
        },
        nativeStabilization: null,
      }),
    ).toThrow("declare only the native app");
  });

  it("does not accept an implementation override", () => {
    expect(() =>
      main([
        "resolve",
        "--channel",
        "internal",
        "--implementation",
        "tauri",
      ]),
    ).toThrow("Unknown argument: --implementation");
  });

  it("archives SwiftUI only while retaining the Android Tauri regression build", () => {
    expect(releaseScript).not.toContain("--implementation");
    expect(releaseScript).not.toContain("src-tauri/gen/apple");
    expect(releaseScript).toContain(
      "apps/briar/ios/BriarCompanion/BriarCompanion.xcodeproj",
    );
    expect(mobileCIScript).not.toContain("tauri ios");
    expect(mobileCIScript).toContain("android:build:debug");
  });
});
