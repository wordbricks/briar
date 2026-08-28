import { getMobilePlatform } from "./platform";

export const appIconNames = ["purple", "gray", "pink", "green"] as const;
export type AppIconName = (typeof appIconNames)[number];

const storageKey = "briar.app-icon.v1";

type AndroidIconBridge = {
  current: () => string;
  set: (icon: string) => boolean;
};

declare global {
  interface Window {
    BriarAndroidIcon?: AndroidIconBridge;
    __TAURI_INTERNALS__?: unknown;
  }
}

function isAppIconName(value: unknown): value is AppIconName {
  return typeof value === "string" && appIconNames.includes(value as AppIconName);
}

function storedAppIcon(): AppIconName {
  if (typeof window === "undefined") return "purple";
  try {
    const value = window.localStorage.getItem(storageKey);
    return isAppIconName(value) ? value : "purple";
  } catch {
    return "purple";
  }
}

function storeAppIcon(icon: AppIconName) {
  try {
    window.localStorage.setItem(storageKey, icon);
  } catch {
    // The native icon remains selected when web storage is unavailable.
  }
}

export async function getCurrentAppIcon(): Promise<AppIconName> {
  if (typeof window === "undefined") return "purple";

  const platform = getMobilePlatform();
  if (platform === "android" && window.BriarAndroidIcon) {
    const icon = window.BriarAndroidIcon.current();
    if (isAppIconName(icon)) {
      storeAppIcon(icon);
      return icon;
    }
  }

  return storedAppIcon();
}

export async function changeAppIcon(icon: AppIconName): Promise<void> {
  if (typeof window === "undefined") return;

  const platform = getMobilePlatform();
  if (platform === "android" && window.BriarAndroidIcon) {
    if (!window.BriarAndroidIcon.set(icon)) {
      throw new Error("Android rejected the selected app icon.");
    }
  }

  storeAppIcon(icon);
}
