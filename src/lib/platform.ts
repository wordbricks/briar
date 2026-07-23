const androidUserAgent = /\bAndroid\b/iu;

export function isAndroidCompanion() {
  if (import.meta.env.VITE_BRIAR_COMPANION === "true") return true;
  if (typeof navigator === "undefined") return false;
  return androidUserAgent.test(navigator.userAgent);
}

export function isDesktopTauri() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    !isAndroidCompanion()
  );
}

export function isMacDesktopTauri() {
  if (!isDesktopTauri() || typeof navigator === "undefined") return false;
  return /\bMacintosh\b|\bMac OS X\b/iu.test(navigator.userAgent);
}
