import type { Workspace, Project } from "../types";

const storageKeyPrefix = "briar.active-workspace.v1";

const storageKeyFor = (userId: string) =>
  `${storageKeyPrefix}:${encodeURIComponent(userId)}`;

export function readActiveWorkspaceId(userId: string) {
  try {
    return window.localStorage.getItem(storageKeyFor(userId));
  } catch {
    return null;
  }
}

export function writeActiveWorkspaceId(
  userId: string,
  workspaceId: string,
) {
  try {
    window.localStorage.setItem(storageKeyFor(userId), workspaceId);
  } catch {
    // Keep the active workspace in memory when storage is unavailable.
  }
}

export function resolveActiveAccountSelection(
  userId: string,
  workspaces: Workspace[],
  projects: Project[],
  lockedProjectId: string | null = null,
) {
  if (lockedProjectId) {
    const project = projects.find((candidate) => candidate.id === lockedProjectId);
    return project
      ? {
          activeWorkspaceId: project.workspaceId,
          activeProjectId: project.id,
        }
      : { activeWorkspaceId: null, activeProjectId: null };
  }
  const storedWorkspaceId = readActiveWorkspaceId(userId);
  const activeWorkspaceId =
    workspaces.find(
      (workspace) => workspace.id === storedWorkspaceId,
    )?.id ??
    workspaces.find(
      (workspace) => workspace.id === projects[0]?.workspaceId,
    )?.id ??
    workspaces[0]?.id ??
    null;
  const activeProjectId =
    projects.find(
      (project) => project.workspaceId === activeWorkspaceId,
    )?.id ?? null;

  return { activeWorkspaceId, activeProjectId };
}
