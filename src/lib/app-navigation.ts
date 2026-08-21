export type ActivePage =
  | "lobby"
  | "issues"
  | "agents"
  | "channels"
  | "dms"
  | "schedule"
  | "inbox"
  | "organization-create"
  | "settings";

export type AppNavigationLocation = ActivePage | `issues/${string}`;

const issueLocationPrefix = "issues/";

export function issueNavigationLocation(runId: string): AppNavigationLocation {
  return `${issueLocationPrefix}${encodeURIComponent(runId)}`;
}

export function pageFromNavigationLocation(
  location: AppNavigationLocation,
): ActivePage {
  if (location.startsWith(issueLocationPrefix)) return "issues";
  return location as ActivePage;
}

export function runIdFromNavigationLocation(
  location: AppNavigationLocation,
): string | null {
  if (!location.startsWith(issueLocationPrefix)) return null;
  const encodedRunId = location.slice(issueLocationPrefix.length);
  if (!encodedRunId) return null;
  try {
    return decodeURIComponent(encodedRunId);
  } catch {
    return null;
  }
}
