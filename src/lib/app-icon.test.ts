import { afterEach, describe, expect, it, vi } from "vitest";
import { changeAppIcon, getCurrentAppIcon } from "./app-icon";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app icon selection", () => {
  it("reads and changes the Android launcher alias through the native bridge", async () => {
    let selected = "green";
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36",
    });
    vi.stubGlobal("window", {
      BriarAndroidIcon: {
        current: () => selected,
        set: (icon: string) => {
          selected = icon;
          return true;
        },
      },
      localStorage,
    });

    await expect(getCurrentAppIcon()).resolves.toBe("green");
    await changeAppIcon("pink");
    expect(selected).toBe("pink");
    expect(localStorage.getItem("briar.app-icon.v1")).toBe("pink");
  });

  it("keeps purple as the safe default for an unknown stored icon", async () => {
    localStorage.setItem("briar.app-icon.v1", "unknown");
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh)" });
    vi.stubGlobal("window", { localStorage });

    await expect(getCurrentAppIcon()).resolves.toBe("purple");
  });
});
