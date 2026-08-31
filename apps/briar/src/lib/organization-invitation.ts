import type {
  OrganizationInvitationPreview,
  OrganizationAssignableRole,
} from "../types";

const invitationStorageKey = "briar.organization-invitation.v1";
const invitationProgressStorageKey =
  "briar.organization-invitation.progress.v1";
const invitationPathPattern = /\/app\/invitations\/([^/?#]{1,256})\/?$/u;
const invitationTokenPattern = /^briar_invite_[0-9a-f]{64}$/u;

export type OrganizationInvitationProgress = {
  userId: string;
  organizationId: string;
  organizationName: string;
  initialProjectId: string;
  initialProjectName: string;
  role: OrganizationAssignableRole;
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

export function parseOrganizationInvitationToken(value: string) {
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

export function storeOrganizationInvitationToken(token: string) {
  try {
    window.sessionStorage.setItem(invitationStorageKey, token);
  } catch {
    // The current page can continue with the token held by React state.
  }
}

export function loadOrganizationInvitationToken() {
  if (typeof window === "undefined") return null;
  const pathToken = invitationTokenFromPath(window.location.pathname);
  if (pathToken) {
    storeOrganizationInvitationToken(pathToken);
    return pathToken;
  }
  try {
    return window.sessionStorage.getItem(invitationStorageKey);
  } catch {
    return null;
  }
}

export function beginOrganizationInvitation(token: string) {
  storeOrganizationInvitationToken(token);
  if (typeof window !== "undefined") {
    window.history.replaceState(
      null,
      "",
      `/app/invitations/${encodeURIComponent(token)}`,
    );
  }
}

export function clearOrganizationInvitationToken() {
  try {
    window.sessionStorage.removeItem(invitationStorageKey);
  } catch {
    // Clearing browser history below still leaves the accepted link unusable.
  }
}

function isOrganizationAssignableRole(
  role: unknown,
): role is OrganizationAssignableRole {
  return (
    role === "co-owner" ||
    role === "developer" ||
    role === "editor" ||
    role === "viewer"
  );
}

export function organizationInvitationProgressFrom(
  invitation: OrganizationInvitationPreview,
  userId: string,
): OrganizationInvitationProgress {
  return {
    userId,
    organizationId: invitation.organizationId,
    organizationName: invitation.organizationName,
    initialProjectId: invitation.initialProjectId,
    initialProjectName: invitation.initialProjectName,
    role: invitation.role,
    nextStep:
      invitation.role === "co-owner" || invitation.role === "developer"
        ? "developer"
        : "collaborator",
  };
}

export function storeOrganizationInvitationProgress(
  progress: OrganizationInvitationProgress,
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

export function loadOrganizationInvitationProgress(): OrganizationInvitationProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(invitationProgressStorageKey);
    if (!stored) return null;
    const progress = JSON.parse(
      stored,
    ) as Partial<OrganizationInvitationProgress>;
    if (
      typeof progress.organizationId !== "string" ||
      typeof progress.userId !== "string" ||
      typeof progress.organizationName !== "string" ||
      typeof progress.initialProjectId !== "string" ||
      typeof progress.initialProjectName !== "string" ||
      !isOrganizationAssignableRole(progress.role) ||
      progress.nextStep !==
        (progress.role === "co-owner" || progress.role === "developer"
          ? "developer"
          : "collaborator")
    ) {
      window.sessionStorage.removeItem(invitationProgressStorageKey);
      return null;
    }
    return progress as OrganizationInvitationProgress;
  } catch {
    return null;
  }
}

export function clearOrganizationInvitationProgress() {
  try {
    window.sessionStorage.removeItem(invitationProgressStorageKey);
  } catch {
    // The in-memory state can still be cleared for the current page.
  }
}

export function leaveOrganizationInvitationRoute({
  preserveProgress = false,
}: { preserveProgress?: boolean } = {}) {
  clearOrganizationInvitationToken();
  if (!preserveProgress) clearOrganizationInvitationProgress();
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", "/app/");
}
