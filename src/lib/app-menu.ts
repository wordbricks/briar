import { invoke } from "@tauri-apps/api/core";
import { isMacDesktopTauri } from "./platform";

export const APP_MENU_SETTINGS_EVENT = "app-menu-settings";
export const APP_MENU_UPDATE_EVENT = "app-menu-update";

function listenForAppMenuEvent(eventName: string, onSelect: () => void) {
  if (typeof window === "undefined" || !isMacDesktopTauri()) {
    return () => undefined;
  }

  let cancelled = false;
  let unlisten: (() => void) | undefined;

  void import("@tauri-apps/api/event")
    .then(({ listen }) => {
      if (cancelled) return;
      return listen(eventName, onSelect);
    })
    .then((dispose) => {
      if (!dispose) return;
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    })
    .catch(() => {
      // The native menu event bridge is available only in the packaged macOS app.
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export function listenForAppMenuSettings(onSelect: () => void) {
  return listenForAppMenuEvent(APP_MENU_SETTINGS_EVENT, onSelect);
}

export function listenForAppMenuUpdate(onSelect: () => void) {
  return listenForAppMenuEvent(APP_MENU_UPDATE_EVENT, onSelect);
}

export async function syncAppUpdateMenu(updateAvailable: boolean) {
  if (typeof window === "undefined" || !isMacDesktopTauri()) return;
  await invoke("sync_app_update_menu", { updateAvailable });
}
