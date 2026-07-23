import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanionHeader } from "./CompanionHeader";

describe("CompanionHeader", () => {
  it("renders a compact workspace header with project and account controls", () => {
    const markup = renderToStaticMarkup(
      <CompanionHeader
        activeProjectId="project-1"
        loading={false}
        onLogout={() => undefined}
        onProjectChange={() => undefined}
        onRefresh={() => undefined}
        projects={[{ id: "project-1", name: "Briar", createdAt: "2026-07-23" }]}
        user={{
          id: "user-1",
          name: "Jay",
          email: "jay@example.com",
        }}
      />,
    );

    expect(markup).toContain('class="companion-workspace"');
    expect(markup).toContain('aria-label="현재 프로젝트"');
    expect(markup).toContain(">Briar</option>");
    expect(markup).toContain('class="companion-header-actions"');
    expect(markup).toContain('class="companion-account-button"');
    expect(markup).toContain(">J</span>");
  });
});
