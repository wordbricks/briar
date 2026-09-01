import { getMobilePlatform } from "./platform";
import { commands } from "../generated/tauri";

type AndroidBadgeBridge = {
  set: (count: number) => boolean;
};

declare global {
  interface Window {
    BriarAndroidBadge?: AndroidBadgeBridge;
  }
}

function normalizedBadgeCount(count: number) {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.trunc(count));
}

export async function syncAppBadgeCount(count: number): Promise<void> {
  if (typeof window === "undefined") return;

  const normalizedCount = normalizedBadgeCount(count);
  if (getMobilePlatform() === "android") {
    if (
      window.BriarAndroidBadge &&
      !window.BriarAndroidBadge.set(normalizedCount)
    ) {
      throw new Error("Android launcher rejected the app badge count.");
    }
    return;
  }

  if (window.__TAURI_INTERNALS__) {
    await commands.setAppBadgeCount(normalizedCount);
  }
}
