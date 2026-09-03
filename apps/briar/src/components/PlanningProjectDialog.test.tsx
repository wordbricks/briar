/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type { PlanningProject } from "../types";
import { PlanningProjectDialog } from "./PlanningProjectDialog";

const planningProject = (
  input: Partial<PlanningProject> = {},
): PlanningProject => ({
  id: "planning-1",
  workspaceId: "organization-1",
  workspaceName: "Briar",
  teamId: "team-1",
  teamName: "Desktop",
  name: "Project navigation",
  description: "Expose the project list",
  status: "active",
  leadUserId: null,
  leadName: null,
  startDate: null,
  targetDate: null,
  icon: null,
  color: null,
  sortOrder: 1,
  isDefault: false,
  role: "owner",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...input,
});

const findButton = (label: string) => Array.from(
  document.querySelectorAll<HTMLButtonElement>('button'),
).find((button) => button.textContent?.trim() === label);

describe("PlanningProjectDialog deletion", () => {
  it("requires confirmation before deleting a non-default project", async () => {
    window.localStorage.setItem("briar.locale.v1", "ko");
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <PlanningProjectDialog
          onCreate={vi.fn()}
          onDelete={onDelete}
          onOpenChange={onOpenChange}
          onUpdate={vi.fn()}
          open
          project={planningProject()}
          teamName="Desktop"
        />
      </I18nProvider>,
    );

    expect(document.body.textContent).toContain(
      "이슈는 같은 팀의 기본 프로젝트로 옮겨집니다",
    );
    await act(async () => findButton("프로젝트 삭제")?.click());
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Project navigation 프로젝트를 삭제할까요?",
    );

    await act(async () => findButton("프로젝트 삭제")?.click());
    expect(onDelete).toHaveBeenCalledWith("planning-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("protects the default General project from deletion", async () => {
    window.localStorage.setItem("briar.locale.v1", "ko");
    const onDelete = vi.fn();
    const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <PlanningProjectDialog
          onCreate={vi.fn()}
          onDelete={onDelete}
          onOpenChange={vi.fn()}
          onUpdate={vi.fn()}
          open
          project={planningProject({ isDefault: true, name: "General" })}
          teamName="Desktop"
        />
      </I18nProvider>,
    );

    expect(document.body.textContent).toContain(
      "기본 프로젝트는 삭제할 수 없습니다",
    );
    expect(findButton("프로젝트 삭제")).toBeUndefined();
    expect(onDelete).not.toHaveBeenCalled();

    await cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
