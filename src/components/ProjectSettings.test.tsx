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
          onRefreshVelen={onRefreshVelen}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-22T00:00:00Z",
          }}
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
    expect(container.querySelector(".project-settings-automation")?.textContent).toContain(
      "completion",
    );
    expect(container.querySelector(".project-settings-auto-run")?.textContent).toContain(
      "자동 실행 조건",
    );
    expect(container.querySelector(".project-settings-linear")?.textContent).toContain(
      "Linear 연결",
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

    const saveButton = container.querySelector<HTMLButtonElement>(
      ".project-settings-llm-control > button",
    );
    expect(saveButton?.textContent).toContain("저장");
    await act(async () => saveButton?.click());
    expect(saveButton?.textContent).toContain("저장됨");

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
          onRefreshVelen={async () => null}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-22T00:00:00Z",
          }}
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
