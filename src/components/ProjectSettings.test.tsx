/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { AutoHuntAutomation } from "../lib/auto-hunt-automation";
import type { ProjectSettings as ProjectSettingsData } from "../types";
import { ProjectSettings } from "./ProjectSettings";

describe("ProjectSettings", () => {
  it("configures the project provider, model, effort, and approval policy", async () => {
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
          dashboard={demoDashboard}
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

    const optionValues = async (controlId: string) => {
      const trigger = container.querySelector<HTMLButtonElement>(`#${controlId}`);
      await act(async () => trigger?.click());
      const values = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          `#${controlId}-listbox .select-menu-option`,
        ),
      ).map((option) => option.dataset.value);
      await act(async () => trigger?.click());
      return values;
    };
    const choose = async (controlId: string, value: string) => {
      const trigger = container.querySelector<HTMLButtonElement>(`#${controlId}`);
      await act(async () => trigger?.click());
      const option = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          `#${controlId}-listbox .select-menu-option`,
        ),
      ).find((candidate) => candidate.dataset.value === value);
      await act(async () => option?.click());
    };
    const openSection = async (
      section: "general" | "issue-import" | "auto-hunt" | "workflow" | "agent",
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
      "에이전트 설정",
    ]);
    expect(
      container
        .querySelector('[data-project-settings-section="general"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      container.querySelector<HTMLElement>(".project-settings-card")?.hidden,
    ).toBe(false);
    expect(
      container.querySelector<HTMLElement>(".project-settings-llm")?.hidden,
    ).toBe(true);

    await openSection("agent");
    expect(
      container.querySelector<HTMLElement>(".project-settings-llm")?.hidden,
    ).toBe(false);
    expect(await optionValues("project-agent-provider")).toEqual([
      "codex",
      "claude",
      "grok",
    ]);
    expect(await optionValues("project-approval-policy")).toEqual([
      "untrusted",
      "on-request",
      "never",
    ]);
    expect(await optionValues("project-agent-model")).toEqual([
      "",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(await optionValues("project-agent-effort")).toEqual([
      "",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    await choose("project-agent-provider", "claude");
    expect(await optionValues("project-agent-model")).toEqual([
      "",
      "sonnet",
      "opus",
      "haiku",
      "fable",
    ]);
    expect(await optionValues("project-agent-effort")).toEqual([
      "",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    await choose("project-agent-model", "sonnet");
    await choose("project-agent-effort", "high");
    await choose("project-approval-policy", "on-request");
    expect(container.querySelector(".project-settings-llm")?.textContent).toContain(
      "Claude가 읽기 전용 경계를 넘어야 할 때 승인을 요청합니다.",
    );
    expect(
      container.querySelector<HTMLElement>(".project-settings-card")?.hidden,
    ).toBe(true);

    const saveButton = container.querySelector<HTMLButtonElement>(
      ".project-settings-llm-control > button",
    );
    expect(saveButton?.textContent).toContain("저장");
    await act(async () => saveButton?.click());
    expect(saveButton?.textContent).toContain("저장됨");

    await openSection("workflow");
    expect(
      container.querySelector<HTMLElement>(".project-settings-automation")?.hidden,
    ).toBe(false);
    expect(container.querySelector(".project-settings-automation")?.textContent).toContain(
      "completion",
    );
    expect(container.querySelector(".project-workflow-contract")?.textContent).toContain(
      "bun run test",
    );
    expect(container.querySelector(".project-workflow-contract")?.textContent).toContain(
      '"enabled": false',
    );

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
