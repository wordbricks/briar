import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type TauriConfig = {
  app: {
    security: {
      csp: string;
      devCsp?: string;
    };
  };
};

const readConfig = (filename: string) =>
  JSON.parse(
    readFileSync(resolve("src-tauri", filename), "utf8"),
  ) as TauriConfig;

const directive = (policy: string, name: string) =>
  policy
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name} `)) ?? "";

describe("issue attachment preview CSP", () => {
  it.each([
    ["desktop production", readConfig("tauri.conf.json").app.security.csp],
    ["desktop development", readConfig("tauri.conf.json").app.security.devCsp!],
    ["Android", readConfig("tauri.android.conf.json").app.security.csp],
  ])("allows Blob image and video previews on %s", (_target, policy) => {
    expect(directive(policy, "img-src").split(/\s+/u)).toContain("blob:");
    expect(directive(policy, "media-src").split(/\s+/u)).toContain("blob:");
  });
});
