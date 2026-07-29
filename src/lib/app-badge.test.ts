import { afterEach, describe, expect, it, vi } from "vitest";
import { syncAppBadgeCount } from "./app-badge";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

describe("app badge count", () => {
  it("syncs the unread count through the Android launcher bridge", async () => {
    const set = vi.fn(() => true);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36",
    });
    vi.stubGlobal("window", {
      BriarAndroidBadge: { set },
      __TAURI_INTERNALS__: {},
    });

    await syncAppBadgeCount(4);

    expect(set).toHaveBeenCalledWith(4);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("clears invalid badge values before sending them to Android", async () => {
    const set = vi.fn(() => true);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36",
    });
    vi.stubGlobal("window", {
      BriarAndroidBadge: { set },
      __TAURI_INTERNALS__: {},
    });

    await syncAppBadgeCount(Number.NaN);

    expect(set).toHaveBeenCalledWith(0);
  });

  it("reports when the Android launcher rejects badge counts", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36",
    });
    vi.stubGlobal("window", {
      BriarAndroidBadge: { set: vi.fn(() => false) },
      __TAURI_INTERNALS__: {},
    });

    await expect(syncAppBadgeCount(2)).rejects.toThrow(
      "Android launcher rejected the app badge count.",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the native Tauri command on iOS and desktop", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)",
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

    await syncAppBadgeCount(3.8);

    expect(invoke).toHaveBeenCalledWith("set_app_badge_count", { count: 3 });
  });

  it("does nothing in a regular browser", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh)" });
    vi.stubGlobal("window", {});

    await syncAppBadgeCount(2);

    expect(invoke).not.toHaveBeenCalled();
  });
});
