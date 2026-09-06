/** @vitest-environment jsdom */

import { afterEach, expect, it, vi } from "vitest";
import { briarApiUrl } from "./api-config";
import { clearSessionToken, writeSessionToken } from "./token-store";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it("passes the app API origin through native IPC for CLI synchronization", async () => {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  vi.stubGlobal("__TAURI_INTERNALS__", {
    async invoke(command: string, args: Record<string, unknown>) {
      calls.push({ command, args });
      return null;
    },
  });
  await writeSessionToken("new-session");
  await clearSessionToken();
  expect(calls).toEqual([
    { command: "write_session_token", args: { token: "new-session", apiUrl: briarApiUrl } },
    { command: "clear_session_token", args: {} },
  ]);
});

it("keeps browser session storage independent of native CLI authentication", async () => {
  await writeSessionToken("browser-session");
  expect(window.localStorage.getItem("briar.session-token")).toBe("browser-session");
  await clearSessionToken();
  expect(window.localStorage.getItem("briar.session-token")).toBeNull();
});
