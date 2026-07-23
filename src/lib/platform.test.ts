import { afterEach, describe, expect, it, vi } from "vitest";
import { isAndroidCompanion, isDesktopTauri } from "./platform";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("platform detection", () => {
  it("detects an Android WebView as the companion app", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36",
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

    expect(isAndroidCompanion()).toBe(true);
    expect(isDesktopTauri()).toBe(false);
  });

  it("keeps desktop Tauri features on desktop", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh)" });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

    expect(isAndroidCompanion()).toBe(false);
    expect(isDesktopTauri()).toBe(true);
  });
});
