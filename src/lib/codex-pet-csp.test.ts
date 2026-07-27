import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readConfig(filename: string) {
  return JSON.parse(
    readFileSync(resolve("src-tauri", filename), "utf8"),
  ) as {
    app: { security: { csp: string } };
  };
}

describe("Codex Pet content security policy", () => {
  it.each([
    ["iOS", "tauri.ios.conf.json"],
    ["Android", "tauri.android.conf.json"],
  ])("allows the official sprite repository on %s", (_, filename) => {
    expect(readConfig(filename).app.security.csp).toContain(
      "connect-src 'self' ipc: http://ipc.localhost https://briar-api.wbai.workers.dev https://raw.githubusercontent.com",
    );
  });
});
