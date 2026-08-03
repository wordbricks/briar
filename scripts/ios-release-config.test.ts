import { describe, expect, test } from "vitest";
import { parseIOSReleaseConfig, resolveIOSRelease } from "./ios-release-config";

const baseConfig = {
  schemaVersion: 1,
  defaultImplementation: "tauri",
  bundleIdentifier: "app.briar.companion",
  rollback: {
    implementation: "tauri",
    preserveSourceThroughVersion: "1.3.0",
  },
  nativeStabilization: null,
} as const;

describe("iOS release selection", () => {
  test("keeps Tauri as the default before native stabilization", () => {
    const resolved = resolveIOSRelease(parseIOSReleaseConfig(baseConfig), "production");
    expect(resolved.implementation).toBe("tauri");
    expect(resolved.rollbackImplementation).toBe("tauri");
  });

  test("allows an explicit native Internal TestFlight candidate", () => {
    const resolved = resolveIOSRelease(
      parseIOSReleaseConfig(baseConfig),
      "internal",
      "native",
    );
    expect(resolved.implementation).toBe("native");
    expect(resolved.stabilizationBuildId).toBeNull();
  });

  test("rejects native Production before stabilization", () => {
    expect(() =>
      resolveIOSRelease(parseIOSReleaseConfig(baseConfig), "production", "native"),
    ).toThrow(/locked until the Internal TestFlight build/);
  });

  test("allows native Production after a build is approved", () => {
    const config = parseIOSReleaseConfig({
      ...baseConfig,
      defaultImplementation: "native",
      nativeStabilization: {
        status: "passed",
        buildId: "asc-build-id",
        approvedAt: "2026-08-10T09:00:00+09:00",
      },
    });
    expect(resolveIOSRelease(config, "production").implementation).toBe("native");
  });

  test("rejects a bundle ID change and removal of the Tauri rollback", () => {
    expect(() =>
      parseIOSReleaseConfig({ ...baseConfig, bundleIdentifier: "app.briar.new" }),
    ).toThrow(/existing app\.briar\.companion/);
    expect(() =>
      parseIOSReleaseConfig({
        ...baseConfig,
        rollback: { implementation: "native", preserveSourceThroughVersion: "1.3.0" },
      }),
    ).toThrow(/must remain tauri/);
  });
});
