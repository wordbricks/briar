/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  beginWorkspaceInvitation,
  clearWorkspaceInvitationProgress,
  leaveWorkspaceInvitationRoute,
  loadWorkspaceInvitationProgress,
  loadWorkspaceInvitationToken,
  organizationInvitationProgressFrom,
  parseWorkspaceInvitationToken,
  storeWorkspaceInvitationProgress,
} from "./workspace-invitation";

const token = `briar_invite_${"a".repeat(64)}`;

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/app/");
});

describe("workspace invitation state", () => {
  it("extracts a valid token from either a token or invitation link", () => {
    expect(parseWorkspaceInvitationToken(token)).toBe(token);
    expect(
      parseWorkspaceInvitationToken(
        `https://briar.wordbricks.ai/app/invitations/${token}`,
      ),
    ).toBe(token);
    expect(parseWorkspaceInvitationToken("https://example.com/orgs/1")).toBeNull();
  });

  it("keeps a pending token through a route replacement and refresh read", () => {
    beginWorkspaceInvitation(token);

    expect(window.location.pathname).toBe(`/app/invitations/${token}`);
    expect(loadWorkspaceInvitationToken()).toBe(token);
  });

  it("persists the server-returned role branch and clears it on completion", () => {
    const progress = organizationInvitationProgressFrom(
      {
        id: "invitation-1",
        workspaceId: "workspace-1",
        workspaceName: "Wordbricks",
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
    storeWorkspaceInvitationProgress(progress);

    expect(loadWorkspaceInvitationProgress()).toEqual({
      ...progress,
      nextStep: "developer",
    });

    clearWorkspaceInvitationProgress();
    expect(loadWorkspaceInvitationProgress()).toBeNull();
  });

  it("clears token and progress when the invitation flow is cancelled", () => {
    beginWorkspaceInvitation(token);
    storeWorkspaceInvitationProgress({
      userId: "user-1",
      workspaceId: "workspace-1",
      workspaceName: "Wordbricks",
      initialProjectId: "project-1",
      initialProjectName: "Briar",
      role: "viewer",
      nextStep: "collaborator",
    });

    leaveWorkspaceInvitationRoute();

    expect(loadWorkspaceInvitationToken()).toBeNull();
    expect(loadWorkspaceInvitationProgress()).toBeNull();
    expect(window.location.pathname).toBe("/app/");
  });
});
