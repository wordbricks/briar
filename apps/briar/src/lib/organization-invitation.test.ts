/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  beginOrganizationInvitation,
  clearOrganizationInvitationProgress,
  leaveOrganizationInvitationRoute,
  loadOrganizationInvitationProgress,
  loadOrganizationInvitationToken,
  organizationInvitationProgressFrom,
  parseOrganizationInvitationToken,
  storeOrganizationInvitationProgress,
} from "./organization-invitation";

const token = `briar_invite_${"a".repeat(64)}`;

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/app/");
});

describe("organization invitation state", () => {
  it("extracts a valid token from either a token or invitation link", () => {
    expect(parseOrganizationInvitationToken(token)).toBe(token);
    expect(
      parseOrganizationInvitationToken(
        `https://briar.wordbricks.ai/app/invitations/${token}`,
      ),
    ).toBe(token);
    expect(parseOrganizationInvitationToken("https://example.com/orgs/1")).toBeNull();
  });

  it("keeps a pending token through a route replacement and refresh read", () => {
    beginOrganizationInvitation(token);

    expect(window.location.pathname).toBe(`/app/invitations/${token}`);
    expect(loadOrganizationInvitationToken()).toBe(token);
  });

  it("persists the server-returned role branch and clears it on completion", () => {
    const progress = organizationInvitationProgressFrom(
      {
        id: "invitation-1",
        organizationId: "organization-1",
        organizationName: "Wordbricks",
        initialProjectId: "project-1",
        initialProjectName: "Briar",
        emailHint: "d***@example.com",
        role: "developer",
        status: "pending",
        expiresAt: "2026-09-07T00:00:00.000Z",
        acceptedAt: null,
        createdAt: "2026-08-31T00:00:00.000Z",
      },
      "user-1",
    );
    storeOrganizationInvitationProgress(progress);

    expect(loadOrganizationInvitationProgress()).toEqual({
      ...progress,
      nextStep: "developer",
    });

    clearOrganizationInvitationProgress();
    expect(loadOrganizationInvitationProgress()).toBeNull();
  });

  it("clears token and progress when the invitation flow is cancelled", () => {
    beginOrganizationInvitation(token);
    storeOrganizationInvitationProgress({
      userId: "user-1",
      organizationId: "organization-1",
      organizationName: "Wordbricks",
      initialProjectId: "project-1",
      initialProjectName: "Briar",
      role: "viewer",
      nextStep: "collaborator",
    });

    leaveOrganizationInvitationRoute();

    expect(loadOrganizationInvitationToken()).toBeNull();
    expect(loadOrganizationInvitationProgress()).toBeNull();
    expect(window.location.pathname).toBe("/app/");
  });
});
