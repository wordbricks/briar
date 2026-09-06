/** @vitest-environment jsdom */

import { afterEach, expect, it, vi } from "vitest";
import { commands } from "../generated/tauri";
import { clearSessionToken, writeSessionToken } from "./token-store";

vi.mock("../generated/tauri", () => ({
  commands: {
    writeSessionToken: vi.fn().mockResolvedValue(null),
    clearSessionToken: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("./api-config", () => ({ briarApiUrl: "https://briar.example.com" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

it("passes the app API origin with the desktop session for CLI synchronization", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  await writeSessionToken("new-session");
  expect(commands.writeSessionToken).toHaveBeenCalledWith(
    "new-session",
    "https://briar.example.com",
  );
  await clearSessionToken();
  expect(commands.clearSessionToken).toHaveBeenCalledOnce();
});

it("keeps browser session storage independent of native CLI authentication", async () => {
  await writeSessionToken("browser-session");
  expect(window.localStorage.getItem("briar.session-token")).toBe("browser-session");
  expect(commands.writeSessionToken).not.toHaveBeenCalled();
  await clearSessionToken();
  expect(window.localStorage.getItem("briar.session-token")).toBeNull();
  expect(commands.clearSessionToken).not.toHaveBeenCalled();
});
