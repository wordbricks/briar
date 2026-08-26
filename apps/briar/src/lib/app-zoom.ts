import { isDesktopTauri } from "./platform";

export const appZoomStorageKey = "briar.appZoom";
export const appZoomSteps = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4] as const;

export type AppZoom = (typeof appZoomSteps)[number];

export type AppZoomApply = (zoom: AppZoom) => void | Promise<void>;

export type AppZoomCommandResult = {
  readonly changed: boolean;
  readonly zoom: AppZoom;
};

export type AppZoomCommands = {
  /** Returns the in-memory zoom selected by this command instance. */
  readonly getZoom: () => AppZoom;
  /** Steps toward the next supported zoom. Repeated calls are supported. */
  readonly zoomIn: () => AppZoomCommandResult;
  /** Steps toward the previous supported zoom. Repeated calls are supported. */
  readonly zoomOut: () => AppZoomCommandResult;
};

const defaultZoomIndex = appZoomSteps.indexOf(1);

function readZoomIndex(): number {
  try {
    const storedZoom = Number(window.localStorage.getItem(appZoomStorageKey));
    const storedIndex = appZoomSteps.findIndex((zoom) => zoom === storedZoom);
    return storedIndex === -1 ? defaultZoomIndex : storedIndex;
  } catch {
    return defaultZoomIndex;
  }
}

function writeZoom(zoom: AppZoom) {
  try {
    window.localStorage.setItem(appZoomStorageKey, String(zoom));
  } catch {
    // Keep the selected zoom for the current session when storage is unavailable.
  }
}

async function applyZoom(zoom: AppZoom) {
  if (isDesktopTauri()) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoom);
      document.documentElement.style.removeProperty("zoom");
      return;
    } catch (error) {
      console.error("Failed to set the native webview zoom", error);
    }
  }

  document.documentElement.style.setProperty("zoom", String(zoom));
}

/**
 * Creates one zoom command state machine and applies the saved zoom once.
 *
 * Commands deliberately return synchronously. Native desktop application is
 * still fire-and-forget because applying webview zoom is asynchronous.
 */
export function createAppZoomCommands(
  setZoom: AppZoomApply = applyZoom,
): AppZoomCommands {
  let zoomIndex = readZoomIndex();
  void setZoom(appZoomSteps[zoomIndex]);

  const move = (direction: -1 | 1): AppZoomCommandResult => {
    const nextIndex = Math.min(
      appZoomSteps.length - 1,
      Math.max(0, zoomIndex + direction),
    );
    if (nextIndex === zoomIndex) {
      return {
        changed: false,
        zoom: appZoomSteps[zoomIndex],
      };
    }

    zoomIndex = nextIndex;
    const zoom = appZoomSteps[zoomIndex];
    writeZoom(zoom);
    void setZoom(zoom);
    return { changed: true, zoom };
  };

  return {
    getZoom: () => appZoomSteps[zoomIndex],
    zoomIn: () => move(1),
    zoomOut: () => move(-1),
  };
}
