import { isDesktopTauri } from "./platform";

export const appZoomStorageKey = "briar.appZoom";
export const appZoomSteps = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4] as const;

const defaultZoomIndex = appZoomSteps.indexOf(1);

function readZoomIndex() {
  try {
    const storedZoom = Number(window.localStorage.getItem(appZoomStorageKey));
    const storedIndex = appZoomSteps.findIndex((zoom) => zoom === storedZoom);
    return storedIndex === -1 ? defaultZoomIndex : storedIndex;
  } catch {
    return defaultZoomIndex;
  }
}

function writeZoom(zoom: number) {
  try {
    window.localStorage.setItem(appZoomStorageKey, String(zoom));
  } catch {
    // Keep the selected zoom for the current session when storage is unavailable.
  }
}

async function applyZoom(zoom: number) {
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

function zoomDirection(event: KeyboardEvent) {
  if (
    event.isComposing ||
    !event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return 0;
  }

  if (
    event.code === "Equal" ||
    event.code === "NumpadAdd" ||
    event.key === "+" ||
    event.key === "="
  ) {
    return 1;
  }

  if (
    event.code === "Minus" ||
    event.code === "NumpadSubtract" ||
    event.key === "-" ||
    event.key === "−"
  ) {
    return -1;
  }

  return 0;
}

export function installAppZoomShortcuts(
  setZoom: (zoom: number) => void | Promise<void> = applyZoom,
) {
  let zoomIndex = readZoomIndex();
  void setZoom(appZoomSteps[zoomIndex]);

  const handleKeyDown = (event: KeyboardEvent) => {
    const direction = zoomDirection(event);
    if (direction === 0) return;

    event.preventDefault();
    const nextIndex = Math.min(
      appZoomSteps.length - 1,
      Math.max(0, zoomIndex + direction),
    );
    if (nextIndex === zoomIndex) return;

    zoomIndex = nextIndex;
    const zoom = appZoomSteps[zoomIndex];
    writeZoom(zoom);
    void setZoom(zoom);
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}
