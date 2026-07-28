import { isDesktopTauri } from "./platform";

export type AppRuntimeSettings = {
  preventSleepWhileRunning: boolean;
  preventSleepSupported: boolean;
};

const storageKey = "briar.settings.runtime.v1";

const browserFallback = (): AppRuntimeSettings => {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as Partial<AppRuntimeSettings>;
    return {
      preventSleepWhileRunning:
        stored.preventSleepWhileRunning === true,
      preventSleepSupported: false,
    };
  } catch {
    return {
      preventSleepWhileRunning: false,
      preventSleepSupported: false,
    };
  }
};

export async function loadAppRuntimeSettings(): Promise<AppRuntimeSettings> {
  if (!isDesktopTauri()) return browserFallback();
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppRuntimeSettings>("load_app_runtime_settings");
}

export async function updateAppRuntimeSettings(
  settings: Pick<AppRuntimeSettings, "preventSleepWhileRunning">,
): Promise<AppRuntimeSettings> {
  if (!isDesktopTauri()) {
    const result = {
      ...settings,
      preventSleepSupported: false,
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(result));
    } catch {
      // Keep the preference for the current session when storage is unavailable.
    }
    return result;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppRuntimeSettings>("update_app_runtime_settings", {
    settings,
  });
}
