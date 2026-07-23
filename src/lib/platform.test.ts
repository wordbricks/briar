import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAndroidCompanion,
  isDesktopTauri,
  isMacDesktopTauri,
} from "./platform";

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
    expect(isMacDesktopTauri()).toBe(true);
  });

  it("does not enable the native intro for another desktop platform", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

    expect(isDesktopTauri()).toBe(true);
    expect(isMacDesktopTauri()).toBe(false);
  });
});
