import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectOnboarding } from "./ProjectOnboarding";

const baseProps = {
  connection: null,
  error: null,
  loading: false,
  onCancel: () => undefined,
  onConnect: async () => undefined,
  onCreate: async () => undefined,
  onLogout: () => undefined,
  onVelenOrgChange: async () => null,
  user: { id: "user-1", name: "Jay", email: "jay@example.com" },
  velen: null,
};

describe("ProjectOnboarding", () => {
  it("shows a cancellable new-project flow for an existing workspace", () => {
    const markup = renderToStaticMarkup(
      <ProjectOnboarding {...baseProps} canCancel />,
    );

    expect(markup).toContain("프로젝트 추가");
    expect(markup).toContain("대시보드로 돌아가기");
  });

  it("explains automatic workflow generation during repository connection", () => {
    const markup = renderToStaticMarkup(
      <ProjectOnboarding
        {...baseProps}
        connection={{
          project: { id: "project-1", name: "Briar", createdAt: "2026-07-22T00:00:00Z" },
          agentToken: "token",
        }}
        velen={{
          authenticated: true,
          currentOrg: "briar",
          email: "jay@example.com",
          organizations: [{ name: "Briar", slug: "briar" }],
          sources: [],
        }}
      />,
    );

    expect(markup).toContain('<jelly-select label="Velen 조직"');
    expect(markup).toContain("워크플로우 자동 생성");
    expect(markup).toContain("Codex App Server");
    expect(markup).toContain("저장소 선택하고 워크플로우 생성");
    expect(markup).not.toContain('label="Auto Hunt 워크플로"');
    expect(markup).not.toContain('aria-pressed="true"');
    expect(markup).not.toContain("<select");
  });

  it("keeps first-project onboarding non-cancellable", () => {
    const markup = renderToStaticMarkup(<ProjectOnboarding {...baseProps} />);

    expect(markup).toContain("프로젝트 만들기");
    expect(markup).not.toContain("대시보드로 돌아가기");
  });
});
