import type { IssueLinkTarget } from "./issue-links";

export type IssueLinkNavigationFailure =
  | "project-unavailable"
  | "project-window-locked";

export type IssueLinkNavigationOutcome =
  | { status: "opened"; projectChanged: boolean }
  | { status: "rejected"; reason: IssueLinkNavigationFailure };

export async function navigateToIssueLink(input: {
  target: IssueLinkTarget;
  activeProjectId: string | null;
  availableProjectIds: readonly string[];
  lockedProjectId: string | null;
  ensureProjectSelected: (projectId: string) => Promise<unknown>;
  openIssue: (target: IssueLinkTarget) => void;
}): Promise<IssueLinkNavigationOutcome> {
  const {
    target,
    activeProjectId,
    availableProjectIds,
    lockedProjectId,
    ensureProjectSelected,
    openIssue,
  } = input;

  if (lockedProjectId && target.projectId !== lockedProjectId) {
    return { status: "rejected", reason: "project-window-locked" };
  }

  const projectChanged = activeProjectId !== target.projectId;
  if (projectChanged || !availableProjectIds.includes(target.projectId)) {
    try {
      await ensureProjectSelected(target.projectId);
    } catch {
      return { status: "rejected", reason: "project-unavailable" };
    }
  }

  openIssue(target);
  return { status: "opened", projectChanged };
}
