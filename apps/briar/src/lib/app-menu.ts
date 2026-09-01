import { isMacDesktopTauri } from "./platform";
import { commands, events } from "../generated/tauri";

function listenForAppMenuEvent(
  listen: (onSelect: () => void) => Promise<() => void>,
  onSelect: () => void,
) {
  if (typeof window === "undefined" || !isMacDesktopTauri()) {
    return () => undefined;
  }

  let cancelled = false;
  let unlisten: (() => void) | undefined;

  void Promise.resolve()
    .then(() => (cancelled ? undefined : listen(onSelect)))
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
  return listenForAppMenuEvent(
    (callback) => events.appMenuSettings.listen(callback),
    onSelect,
  );
}

export function listenForAppMenuUpdate(onSelect: () => void) {
  return listenForAppMenuEvent(
    (callback) => events.appMenuUpdate.listen(callback),
    onSelect,
  );
}

export async function syncAppUpdateMenu(updateAvailable: boolean) {
  if (typeof window === "undefined" || !isMacDesktopTauri()) return;
  await commands.syncAppUpdateMenu(updateAvailable);
}
