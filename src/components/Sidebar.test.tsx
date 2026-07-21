import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("offers project creation beside the switcher and in workspace navigation", () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        activeProjectId="project-1"
        isOpen
        onAddProject={() => undefined}
        onLogout={() => undefined}
        onProjectChange={() => undefined}
        onToggle={() => undefined}
        projects={[
          { id: "project-1", name: "Briar", createdAt: "2026-07-22T00:00:00Z" },
        ]}
        user={{ id: "user-1", name: "Jay", email: "jay@example.com" }}
      />,
    );

    expect(markup).toContain('aria-label="프로젝트 추가"');
    expect(markup).toContain("<jelly-select");
    expect(markup).toContain('label="프로젝트 선택"');
    expect(markup).not.toContain("<select");
    expect(markup).toContain('aria-label="왼쪽 패널 닫기"');
    expect(markup).not.toContain("Briar</span>");
    expect(markup).toContain("Projects");
  });
});
