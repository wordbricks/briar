export const firstRunTutorialPendingStorageKey =
  "briar.first-run-tutorial.pending.v1";

const storageKeyFor = (userId: string) =>
  `${firstRunTutorialPendingStorageKey}:${userId}`;

export function shouldShowFirstOrganizationSetup({
  hasUser,
  organizationCount,
  projectCount,
  remoteMode,
}: {
  hasUser: boolean;
  organizationCount: number;
  projectCount: number;
  remoteMode: boolean;
}) {
  return (
    !remoteMode &&
    hasUser &&
    organizationCount === 0 &&
    projectCount === 0
  );
}

export function hasPendingFirstRunTutorial(userId: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKeyFor(userId)) === "true";
  } catch {
    return false;
  }
}

export function markFirstRunTutorialPending(userId: string) {
  try {
    window.localStorage.setItem(storageKeyFor(userId), "true");
  } catch {
    // The current session can still continue when persistence is unavailable.
  }
}

export function clearFirstRunTutorialPending(userId: string) {
  try {
    window.localStorage.removeItem(storageKeyFor(userId));
  } catch {
    // The current session can still continue when persistence is unavailable.
  }
}
