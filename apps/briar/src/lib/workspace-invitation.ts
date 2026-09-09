import type {
  WorkspaceInvitationPreview,
  WorkspaceAssignableRole,
} from "../types";

const invitationStorageKey = "briar.workspace-invitation.v1";
const invitationProgressStorageKey =
  "briar.workspace-invitation.progress.v1";
const invitationPathPattern = /\/app\/invitations\/([^/?#]{1,256})\/?$/u;
const invitationTokenPattern = /^briar_invite_[0-9a-f]{64}$/u;

export type WorkspaceInvitationProgress = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  initialProjectId: string;
  initialProjectName: string;
  role: WorkspaceAssignableRole;
  nextStep: "collaborator" | "developer";
};

function invitationTokenFromPath(pathname: string) {
  const encoded = pathname.match(invitationPathPattern)?.[1];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function parseWorkspaceInvitationToken(value: string) {
  const candidate = value.trim();
  if (invitationTokenPattern.test(candidate)) return candidate;
  try {
    const base =
      typeof window === "undefined"
        ? "https://briar.wordbricks.ai"
        : window.location.origin;
    const token = invitationTokenFromPath(new URL(candidate, base).pathname);
    return token && invitationTokenPattern.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function storeWorkspaceInvitationToken(token: string) {
  try {
    window.sessionStorage.setItem(invitationStorageKey, token);
  } catch {
    // The current page can continue with the token held by React state.
  }
}

export function loadWorkspaceInvitationToken() {
  if (typeof window === "undefined") return null;
  const pathToken = invitationTokenFromPath(window.location.pathname);
  if (pathToken) {
    storeWorkspaceInvitationToken(pathToken);
    return pathToken;
  }
  try {
    return window.sessionStorage.getItem(invitationStorageKey);
  } catch {
    return null;
  }
}

export function beginWorkspaceInvitation(token: string) {
  storeWorkspaceInvitationToken(token);
  if (typeof window !== "undefined") {
    window.history.replaceState(
      null,
      "",
      `/app/invitations/${encodeURIComponent(token)}`,
    );
  }
}

export function clearWorkspaceInvitationToken() {
  try {
    window.sessionStorage.removeItem(invitationStorageKey);
  } catch {
    // Clearing browser history below still leaves the accepted link unusable.
  }
}

function isWorkspaceAssignableRole(
  role: unknown,
): role is WorkspaceAssignableRole {
  return (
    role === "co-owner" ||
    role === "developer" ||
    role === "editor" ||
    role === "viewer"
  );
}

export function organizationInvitationProgressFrom(
  invitation: WorkspaceInvitationPreview,
  userId: string,
): WorkspaceInvitationProgress {
  return {
    userId,
    workspaceId: invitation.workspaceId,
    workspaceName: invitation.workspaceName,
    initialProjectId: invitation.initialProjectId,
    initialProjectName: invitation.initialProjectName,
    role: invitation.role,
    nextStep:
      invitation.role === "co-owner" || invitation.role === "developer"
        ? "developer"
        : "collaborator",
  };
}

export function storeWorkspaceInvitationProgress(
  progress: WorkspaceInvitationProgress,
) {
  try {
    window.sessionStorage.setItem(
      invitationProgressStorageKey,
      JSON.stringify(progress),
    );
  } catch {
    // The current page can continue with the progress held by React state.
  }
}

export function loadWorkspaceInvitationProgress(): WorkspaceInvitationProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(invitationProgressStorageKey);
    if (!stored) return null;
    const progress = JSON.parse(
      stored,
    ) as Partial<WorkspaceInvitationProgress>;
    if (
      typeof progress.workspaceId !== "string" ||
      typeof progress.userId !== "string" ||
      typeof progress.workspaceName !== "string" ||
      typeof progress.initialProjectId !== "string" ||
      typeof progress.initialProjectName !== "string" ||
      !isWorkspaceAssignableRole(progress.role) ||
      progress.nextStep !==
        (progress.role === "co-owner" || progress.role === "developer"
          ? "developer"
          : "collaborator")
    ) {
      window.sessionStorage.removeItem(invitationProgressStorageKey);
      return null;
    }
    return progress as WorkspaceInvitationProgress;
  } catch {
    return null;
  }
}

export function clearWorkspaceInvitationProgress() {
  try {
    window.sessionStorage.removeItem(invitationProgressStorageKey);
  } catch {
    // The in-memory state can still be cleared for the current page.
  }
}

export function leaveWorkspaceInvitationRoute({
  preserveProgress = false,
}: { preserveProgress?: boolean } = {}) {
  clearWorkspaceInvitationToken();
  if (!preserveProgress) clearWorkspaceInvitationProgress();
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", "/app/");
}
