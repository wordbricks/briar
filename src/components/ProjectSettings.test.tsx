/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { AutoHuntAutomation } from "../lib/auto-hunt-automation";
import type { ProjectSettings as ProjectSettingsData } from "../types";
import { ProjectSettings } from "./ProjectSettings";

describe("ProjectSettings", () => {
  it("keeps project settings focused on project-wide configuration", async () => {
    const onRegenerateWorkflow = vi.fn(async () => undefined);
    const onUpdateAutomation = vi.fn(async (automation: AutoHuntAutomation) =>
      automation
    );
    const onUpdateLinear = vi.fn(
      async (linear: ProjectSettingsData["linear"]) => linear,
    );
    const onConnectLinearImport = vi.fn(async () => ({
      viewer: {
        name: "Demo",
        email: null,
        organizationName: "Demo Org",
      },
      teams: [],
    }));
    const onLoadLinearImportStates = vi.fn(async () => ({ states: [] }));
    const onImportLinearIssues = vi.fn(async () => ({
      imported: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      truncated: false,
    }));
    const onRefreshVelen = vi.fn(async () => ({
      authenticated: true,
      email: "jay@example.com",
      currentOrg: "wordbricks",
      organizations: [{ name: "Wordbricks", slug: "wordbricks" }],
      sources: [{
        sourceKey: "linear-wordbricks",
        sourceRef: "linear://linear-wordbricks",
        provider: "linear",
        status: "active",
      }],
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectSettings
          dashboard={{
            ...demoDashboard,
            settings: {
              ...demoDashboard.settings,
              githubRepository: null,
            },
          }}
          githubRepository="wordbricks/briar"
          isDeleting={false}
          isSidebarOpen
          onBack={() => undefined}
          onDelete={async () => undefined}
          onRegenerateWorkflow={onRegenerateWorkflow}
          onUpdateAutomation={onUpdateAutomation}
          onUpdateLinear={onUpdateLinear}
          onConnectLinearImport={onConnectLinearImport}
          onLoadLinearImportStates={onLoadLinearImportStates}
          onImportLinearIssues={onImportLinearIssues}
          onRefreshVelen={onRefreshVelen}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-22T00:00:00Z",
          }}
          repositoryConnected
          velen={await onRefreshVelen()}
        />,
      );
    });
    expect(container.textContent).toContain("wordbricks/briar");

    const openSection = async (
      section: "general" | "issue-import" | "auto-hunt" | "workflow",
    ) => {
      const button = container.querySelector<HTMLButtonElement>(
        `[data-project-settings-section="${section}"]`,
      );
      await act(async () => button?.click());
      return button;
    };

    expect(container.querySelector(".project-settings-sidebar")).not.toBeNull();
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          "[data-project-settings-section]",
        ),
      ).map((button) => button.textContent),
    ).toEqual([
      "General",
      "이슈 임포트",
      "자동사냥",
      "워크플로우",
    ]);
    expect(
      container
        .querySelector('[data-project-settings-section="general"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      container.querySelector<HTMLElement>(".project-settings-card")?.hidden,
    ).toBe(false);
    expect(container.querySelector(".project-settings-llm")).toBeNull();

    await openSection("workflow");
    expect(
      container.querySelector<HTMLElement>(".project-settings-automation")?.hidden,
    ).toBe(false);
    expect(container.querySelector(".project-settings-automation")?.textContent).toContain(
      "완료 조건",
    );
    expect(container.querySelector(".project-workflow-contract")?.textContent).toContain(
      "bun run test",
    );
    expect(container.querySelector(".project-workflow-contract")?.textContent).toContain(
      "릴리스비활성",
    );
    expect(container.querySelector(".project-workflow-contract pre")).toBeNull();
    expect(container.querySelectorAll(".project-workflow-stage")).toHaveLength(3);
    expect(
      container.querySelector(".project-workflow-contract")?.getAttribute("aria-label"),
    ).toBe("Auto Hunt 워크플로 다이어그램");

    const regenerateButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-settings-automation-actions button",
      ),
    ).find((button) => button.textContent?.includes("워크플로우 재생성"));
    await act(async () => regenerateButton?.click());
    expect(onRegenerateWorkflow).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "코드 분석 결과로 워크플로우를 갱신했습니다.",
    );

    await openSection("auto-hunt");
    expect(
      container.querySelector<HTMLElement>(".project-settings-auto-run")?.hidden,
    ).toBe(false);
    expect(container.querySelector(".project-settings-auto-run")?.textContent).toContain(
      "자동 실행 조건",
    );
    const autoRunToggle = container.querySelector<HTMLInputElement>(
      ".project-settings-auto-run .project-settings-toggle input",
    );
    await act(async () => autoRunToggle?.click());
    const autoRunSave = container.querySelector<HTMLButtonElement>(
      ".project-settings-auto-run > footer button",
    );
    await act(async () => autoRunSave?.click());
    expect(onUpdateAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, maxIssuesPerSession: 3 }),
    );

    await openSection("issue-import");
    expect(
      container.querySelector<HTMLElement>(".project-settings-linear")?.hidden,
    ).toBe(false);
    expect(container.querySelector(".project-settings-linear")?.textContent).toContain(
      "Linear 연결",
    );
    const linearTeam = container.querySelector<HTMLInputElement>(
      '.project-settings-linear input[aria-label="팀 키"]',
    );
    await act(async () => {
      if (!linearTeam) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(linearTeam, "BRIAR");
      linearTeam.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const linearSave = container.querySelector<HTMLButtonElement>(
      ".project-settings-linear > footer button",
    );
    await act(async () => linearSave?.click());
    expect(onUpdateLinear).toHaveBeenCalledWith({
      enabled: true,
      source: "linear://linear-wordbricks",
      teamKey: "BRIAR",
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("asks for confirmation once before deleting the project", async () => {
    const onDelete = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectSettings
          dashboard={demoDashboard}
          githubRepository="wordbricks/briar"
          isDeleting={false}
          isSidebarOpen
          onBack={() => undefined}
          onDelete={onDelete}
          onRegenerateWorkflow={async () => undefined}
          onUpdateAutomation={async (automation) => automation}
          onUpdateLinear={async (linear) => linear}
          onConnectLinearImport={async () => ({
            viewer: { name: "Demo", email: null, organizationName: "Demo" },
            teams: [],
          })}
          onLoadLinearImportStates={async () => ({ states: [] })}
          onImportLinearIssues={async () => ({
            imported: 0,
            skipped: 0,
            failed: 0,
            total: 0,
            truncated: false,
          })}
          onRefreshVelen={async () => null}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-22T00:00:00Z",
          }}
          repositoryConnected
          velen={null}
        />,
      );
    });

    const deleteButton = container.querySelector<HTMLButtonElement>(
      ".project-settings-danger > button",
    );
    await act(async () => deleteButton?.click());
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Briar 프로젝트를 삭제할까요?",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".delete-project-confirm")?.click();
    });
    expect(onDelete).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
