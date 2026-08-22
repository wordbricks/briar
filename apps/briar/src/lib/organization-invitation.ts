const invitationStorageKey = "briar.organization-invitation.v1";
const invitationPathPattern = /\/app\/invitations\/([^/?#]{1,256})\/?$/u;

export function loadOrganizationInvitationToken() {
  if (typeof window === "undefined") return null;
  const pathToken = window.location.pathname.match(invitationPathPattern)?.[1];
  if (pathToken) {
    const token = decodeURIComponent(pathToken);
    try {
      window.sessionStorage.setItem(invitationStorageKey, token);
    } catch {
      // The current page can continue with the token from the URL.
    }
    return token;
  }
  try {
    return window.sessionStorage.getItem(invitationStorageKey);
  } catch {
    return null;
  }
}

export function clearOrganizationInvitationToken() {
  try {
    window.sessionStorage.removeItem(invitationStorageKey);
  } catch {
    // Clearing browser history below still leaves the accepted link unusable.
  }
}

export function leaveOrganizationInvitationRoute() {
  clearOrganizationInvitationToken();
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", "/app/");
}
