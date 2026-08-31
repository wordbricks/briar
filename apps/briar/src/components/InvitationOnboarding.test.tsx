/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type { OrganizationInvitationPreview } from "../types";
import { InvitationOnboarding } from "./InvitationOnboarding";

const invitation = {
  id: "invitation-1",
  organizationId: "organization-1",
  organizationName: "Wordbricks",
  initialProjectId: "project-1",
  initialProjectName: "Briar",
  emailHint: "n***@wordbricks.ai",
  role: "viewer",
  status: "pending",
  expiresAt: "2026-09-07T00:00:00.000Z",
  acceptedAt: null,
  createdAt: "2026-08-31T00:00:00.000Z",
} satisfies OrganizationInvitationPreview;

const user = {
  id: "user-1",
  name: "New User",
  email: "new@example.com",
};

function invitationScreen(
  invitationValue: OrganizationInvitationPreview,
  onAccept = vi.fn().mockResolvedValue(undefined),
) {
  return (
    <InvitationOnboarding
      accepting={false}
      error={null}
      loading={false}
      loadInvitation={async () => ({ invitation: invitationValue })}
      loginCode={null}
      onAccept={onAccept}
      onCancelLogin={() => undefined}
      onLeave={() => undefined}
      onLogin={() => undefined}
      onSwitchAccount={async () => undefined}
      token="briar_invite_example"
      user={user}
    />
  );
}

describe("InvitationOnboarding", () => {
  it("shows the preview without accepting until the user confirms", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(root, invitationScreen(invitation, onAccept));

    expect(container.textContent).toContain("Wordbricks에 초대받았습니다.");
    expect(container.textContent).toContain("Briar 프로젝트");
    expect(container.textContent).toContain("Git이나 개발 도구를 설치할 필요가 없습니다.");
    expect(onAccept).not.toHaveBeenCalled();

    const accept = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("초대 수락"));
    await act(async () => accept?.click());
    expect(onAccept).toHaveBeenCalledOnce();

    await cleanup();
  });

  it("shows GitHub and personal agent setup only for development roles", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      invitationScreen({ ...invitation, role: "developer" }),
    );

    expect(container.textContent).toContain("GitHub 저장소");
    expect(container.textContent).toContain("개인 개발 에이전트");
    expect(container.textContent).not.toContain(
      "Git이나 개발 도구를 설치할 필요가 없습니다.",
    );

    await cleanup();
  });
});
