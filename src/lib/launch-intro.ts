export const launchIntroStorageKey = "briar.launch-intro.seen.v2";

export function isNativeLaunchIntroWindow() {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("launchIntro") === "native"
  );
}

export function shouldShowLaunchIntro() {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("intro")) return true;
  try {
    return window.localStorage.getItem(launchIntroStorageKey) !== "true";
  } catch {
    return true;
  }
}

export function markLaunchIntroSeen() {
  try {
    window.localStorage.setItem(launchIntroStorageKey, "true");
  } catch {
    // The intro still completes when persistence is unavailable.
  }
}
