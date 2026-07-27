export const projectOnboardingDeferredStorageKey =
  "briar.project-onboarding.deferred.v1";

const storageKeyFor = (userId: string) =>
  `${projectOnboardingDeferredStorageKey}:${userId}`;

export function hasDeferredProjectOnboarding(userId: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKeyFor(userId)) === "true";
  } catch {
    return false;
  }
}

export function markProjectOnboardingDeferred(userId: string) {
  try {
    window.localStorage.setItem(storageKeyFor(userId), "true");
  } catch {
    // The current session can still continue when persistence is unavailable.
  }
}
