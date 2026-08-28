import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readConfig(filename: string) {
  return JSON.parse(
    readFileSync(resolve("src-tauri", filename), "utf8"),
  ) as {
    app: { security: { csp: string; devCsp?: string } };
  };
}

describe("Tauri content security policy", () => {
  it("allows the official sprite repository on Android", () => {
    const filename = "tauri.android.conf.json";
    const csp = readConfig(filename).app.security.csp;
    expect(csp).toContain("https://briar-api.wbai.workers.dev");
    expect(csp).toContain("https://raw.githubusercontent.com");
  });

  it.each([
    ["desktop", "tauri.conf.json"],
    ["Android", "tauri.android.conf.json"],
  ])("allows the realtime WebSocket origin on %s", (_, filename) => {
    expect(readConfig(filename).app.security.csp).toContain(
      "wss://briar-api.wbai.workers.dev",
    );
  });

  it("allows the realtime WebSocket origin during desktop development", () => {
    expect(readConfig("tauri.conf.json").app.security.devCsp).toContain(
      "wss://briar-api.wbai.workers.dev",
    );
  });
});
