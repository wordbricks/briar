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

  it("keeps first-project onboarding non-cancellable", () => {
    const markup = renderToStaticMarkup(<ProjectOnboarding {...baseProps} />);

    expect(markup).toContain("프로젝트 만들기");
    expect(markup).not.toContain("대시보드로 돌아가기");
  });
});
