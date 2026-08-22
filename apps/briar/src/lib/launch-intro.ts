export const launchIntroStorageKey = "briar.launch-intro.seen.v2";
export const launchIntroPreviewStorageKey = "briar.launch-intro.preview.v1";

export function isLaunchIntroPreview() {
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_BRIAR_INTRO_PREVIEW === "true"
  ) {
    return true;
  }
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(launchIntroPreviewStorageKey) === "true";
  } catch {
    return false;
  }
}

export function clearLaunchIntroPreview() {
  try {
    window.localStorage.removeItem(launchIntroPreviewStorageKey);
  } catch {
    // Preview still closes when persistence is unavailable.
  }
}

export function isNativeLaunchIntroWindow() {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("launchIntro") === "native"
  );
}

export function shouldShowLaunchIntro() {
  if (typeof window === "undefined") return false;
  if (isLaunchIntroPreview()) return true;
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
