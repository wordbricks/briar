// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { openAuthorization } from "./auth-session";

const invoke = vi.fn();
const openUrl = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  Reflect.deleteProperty(window, "BriarAndroidAuth");
  vi.unstubAllGlobals();
});

describe("openAuthorization", () => {
  it("uses the native iOS authentication session and captures its callback", async () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15",
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockResolvedValue("briar-companion://auth-complete");

    await expect(
      openAuthorization("https://example.com/device?client=mobile"),
    ).resolves.toBe("completed");
    expect(invoke).toHaveBeenCalledWith("plugin:auth-session|start", {
      authUrl: "https://example.com/device?client=mobile",
      callbackUrlScheme: "briar-companion",
      ephemeral: false,
    });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("keeps the existing Android in-app authentication bridge", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    });
    const open = vi.fn();
    window.BriarAndroidAuth = { open };

    await expect(
      openAuthorization("https://example.com/device?client=mobile"),
    ).resolves.toBe("launched");
    expect(open).toHaveBeenCalledWith(
      "https://example.com/device?client=mobile",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
