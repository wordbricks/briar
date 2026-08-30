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

  it.each([
    ["desktop production", readConfig("tauri.conf.json").app.security.csp],
    ["Android", readConfig("tauri.android.conf.json").app.security.csp],
  ])("allows only the production API shell for HTML frames on %s", (_target, policy) => {
    expect(directive(policy, "frame-src").split(/\s+/u)).toContain(
      "https://briar-api.wbai.workers.dev/html-artifact-preview",
    );
    const scriptSources = directive(policy, "script-src").split(/\s+/u);
    expect(scriptSources).toEqual(["script-src", "'self'"]);
    expect(scriptSources).not.toContain("'unsafe-inline'");
  });

  it("allows the exact local shell only in desktop development", () => {
    const policy = readConfig("tauri.conf.json").app.security.devCsp!;
    expect(directive(policy, "frame-src").split(/\s+/u)).toContain(
      "http://127.0.0.1:8787/html-artifact-preview",
    );
  });
});
