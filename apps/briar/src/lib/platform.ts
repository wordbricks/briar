export type MobilePlatform = "android" | "ios";

export function getMobilePlatform(): MobilePlatform | null {
  if (typeof navigator !== "undefined") {
    if (/\bAndroid\b/iu.test(navigator.userAgent)) return "android";
    if (/\biPhone\b|\biPad\b|\biPod\b/iu.test(navigator.userAgent)) return "ios";
  }
  return import.meta.env.VITE_BRIAR_COMPANION === "true" ? "android" : null;
}

export function isMobileCompanion() {
  if (import.meta.env.VITE_BRIAR_COMPANION === "true") return true;
  return getMobilePlatform() !== null;
}

export function isWebApp() {
  return (
    import.meta.env.VITE_BRIAR_WEB === "true" &&
    typeof window !== "undefined" &&
    !("__TAURI_INTERNALS__" in window)
  );
}

export function isDesktopTauri() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    !isMobileCompanion()
  );
}

export function supportsManagedComputerRemoteDesktop() {
  return isWebApp() || isDesktopTauri();
}

export function isMacDesktopTauri() {
  if (!isDesktopTauri() || typeof navigator === "undefined") return false;
  return /\bMacintosh\b|\bMac OS X\b/iu.test(navigator.userAgent);
}
