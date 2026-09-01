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
});
