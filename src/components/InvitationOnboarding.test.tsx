/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOrganizationInvitation } from "../lib/api";
import { InvitationOnboarding } from "./InvitationOnboarding";

vi.mock("../lib/api", () => ({
  isApiErrorStatus: (error: unknown, status: number) =>
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status,
  loadOrganizationInvitation: vi.fn(),
}));

const invitation = {
  id: "invitation-1",
  organizationId: "organization-1",
  organizationName: "Wordbricks",
  initialProjectId: "project-1",
  initialProjectName: "Briar",
  emailHint: "n***@wordbricks.ai",
  role: "member" as const,
  status: "pending" as const,
  expiresAt: "2026-08-10T00:00:00.000Z",
  acceptedAt: null,
  createdAt: "2026-08-03T00:00:00.000Z",
};

describe("InvitationOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOrganizationInvitation).mockResolvedValue({ invitation });
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows the invited organization and project without developer setup", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onLogin = vi.fn();

    await act(async () => {
      root.render(
        <InvitationOnboarding
          accepting={false}
          error={null}
          loading={false}
          loginCode={null}
          onAccept={vi.fn()}
          onCancelLogin={vi.fn()}
          onLeave={vi.fn()}
          onLogin={onLogin}
          onSwitchAccount={vi.fn()}
          token="briar_invite_example"
          user={null}
        />,
      );
    });

    expect(container.textContent).toContain("Wordbricks에 초대받았습니다.");
    expect(container.textContent).toContain("Briar 프로젝트");
    expect(container.textContent).toContain(
      "Git이나 개발 도구를 설치할 필요가 없습니다.",
    );
    expect(container.textContent).not.toContain("데스크톱 도구 설정");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) =>
          button.textContent?.includes("초대받은 이메일로 인증코드 받기"),
        )
        ?.click();
    });
    expect(onLogin).toHaveBeenCalledOnce();
    expect(onLogin).toHaveBeenCalledWith("email");

    await act(async () => root.unmount());
    container.remove();
  });

  it("guides a signed-in user to switch accounts after an email mismatch", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const mismatch = Object.assign(new Error("mismatch"), { status: 409 });

    await act(async () => {
      root.render(
        <InvitationOnboarding
          accepting={false}
          error={null}
          loading={false}
          loginCode={null}
          onAccept={vi.fn().mockRejectedValue(mismatch)}
          onCancelLogin={vi.fn()}
          onLeave={vi.fn()}
          onLogin={vi.fn()}
          onSwitchAccount={vi.fn()}
          token="briar_invite_example"
          user={{
            id: "user-1",
            name: "Wrong User",
            username: null,
            email: "wrong@example.com",
            image: null,
          }}
        />,
      );
    });

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("초대 수락"))
        ?.click();
    });

    expect(container.textContent).toContain(
      "초대받은 이메일과 현재 로그인한 이메일이 다릅니다.",
    );
    expect(container.textContent).toContain("다른 계정으로 로그인");

    await act(async () => root.unmount());
    container.remove();
  });
});
