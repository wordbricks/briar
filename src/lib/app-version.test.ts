import { describe, expect, it } from "vitest";
import { APP_VERSION, formatAppVersionLabel } from "./app-version";

describe("app-version", () => {
  it("exposes a semver package version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prefixes versions with v", () => {
    expect(formatAppVersionLabel("1.2.3")).toBe("v1.2.3");
    expect(formatAppVersionLabel("v1.2.3")).toBe("v1.2.3");
  });
});
