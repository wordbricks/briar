import { isDesktopTauri } from "./platform";
import {
  commands,
  type AppRuntimeSettings,
  type AppRuntimeSettingsUpdate,
} from "../generated/tauri";

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
  return commands.loadAppRuntimeSettings();
}

export async function updateAppRuntimeSettings(
  settings: AppRuntimeSettingsUpdate,
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
  return commands.updateAppRuntimeSettings(settings);
}
