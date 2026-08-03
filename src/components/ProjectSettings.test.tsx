/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import { projectIconFromFile } from "../lib/project-icon";
import type { ProjectSettings as ProjectSettingsData } from "../types";
import { ProjectSettings } from "./ProjectSettings";

vi.mock("../lib/project-icon", () => ({
  projectIconAccept: "image/jpeg,image/png,image/webp,image/svg+xml,image/x-icon,.ico",
  projectIconFromFile: vi.fn(),
}));

describe("ProjectSettings", () => {
  it("keeps project settings focused on project-wide configuration", async () => {
    const onAnalyzeWorkflowRequirements = vi.fn(async () => undefined);
    const onRegenerateWorkflow = vi.fn(async () => undefined);
    const onReviseWorkflow = vi.fn(async () => undefined);
    const onSaveCheckpointPolicy = vi.fn(async () => undefined);
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
    const onIconChange = vi.fn(async () => undefined);
    vi.mocked(projectIconFromFile).mockResolvedValue(
      "data:image/webp;base64,aWNvbg==",
    );
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
              workflow: {
                ...demoDashboard.settings.workflow,
                requirements: [{
                  id: "bun",
                  label: "Bun",
                  kind: "executable",
                  tool: "bun",
                  reason: "Runs repository validation.",
                }],
              },
              checkpointPolicy: {
                availableBoundaries: demoDashboard.settings.workflow.stages.flatMap(
                  (stage) => ([
                    { stage: stage.id, stageLabel: stage.label, position: "before" as const },
                    { stage: stage.id, stageLabel: stage.label, position: "after" as const },
                  ]),
                ),
                projectMandatory: [{
                  key: "legacy-after-local_qa",
                  stage: "local_qa",
                  position: "after",
                }],
                userDefaults: [],
                effective: [{
                  key: "legacy-after-local_qa",
                  stage: "local_qa",
                  position: "after",
                }],
                projectRevision: 1,
                userRevision: 0,
              },
            },
          }}
          githubRepository="wordbricks/briar"
          health={{
            projectId: "project-1",
            healthy: true,
            repositoryPath: "/repo",
            repositoryRemote: null,
            repositoryHealthy: true,
            cliPath: "/bin/briar",
            cliInstalled: true,
            cliVersion: "1.0.0",
            cliExpectedVersion: "1.0.0",
            cliCurrent: true,
            skillPath: "/skills/briar-workflow",
            skillInstalled: true,
            skillVersion: "1.0.0",
            skillExpectedVersion: "1.0.0",
            skillCurrent: true,
            velenOrg: null,
            velenAuthenticated: false,
            velenEmail: null,
            velenHealthy: true,
            requirements: [{
              id: "bun",
              label: "Bun",
              kind: "executable",
              tool: "bun",
              reason: "Runs repository validation.",
              healthy: true,
              detail: "/usr/local/bin/bun",
            }],
            issues: [],
          }}
          isDeleting={false}
          isSidebarOpen
          onBack={() => undefined}
          onAnalyzeWorkflowRequirements={onAnalyzeWorkflowRequirements}
          onDelete={async () => undefined}
          onRegenerateWorkflow={onRegenerateWorkflow}
          onReviseWorkflow={onReviseWorkflow}
          onSaveCheckpointPolicy={onSaveCheckpointPolicy}
          onUpdateVelenOrg={async (org) => org}
          onUpdateLinear={onUpdateLinear}
          onConnectLinearImport={onConnectLinearImport}
          onLoadLinearImportStates={onLoadLinearImportStates}
          onImportLinearIssues={onImportLinearIssues}
          onIconChange={onIconChange}
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
      section:
        | "general"
        | "integrations"
        | "issue-import"
        | "agent-configuration"
        | "execution"
        | "workflow",
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
      "Integrations",
      "이슈 임포트",
      "에이전트 구성",
      "실행 환경",
      "워크플로우",
    ]);
    expect(
      container.querySelector('[data-project-settings-section="auto-hunt"]'),
    ).toBeNull();
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
    expect(container.querySelector(".project-settings-card")).toBeNull();
    expect(
      container.querySelector<HTMLElement>(".project-settings-automation")?.hidden,
    ).toBe(false);
    expect(container.querySelector(".project-settings-automation")?.textContent).toContain(
      "완료 조건",
    );
    expect(container.querySelector(".project-workflow-contract")?.textContent).toContain(
      "bun run test",
    );
    expect(container.querySelector(".project-workflow-requirements")?.textContent).toContain(
      "Bun",
    );
    expect(container.querySelector(".project-workflow-requirements")?.textContent).toContain(
      "정상",
    );
    expect(container.querySelector(".project-workflow-contract")?.textContent).toContain(
      "자동화 확인 지점실행 순서에 따라 확인 지점 1개에서 대기합니다.",
    );
    expect(container.querySelector(".project-workflow-contract pre")).toBeNull();
    expect(container.querySelectorAll(".project-workflow-stage")).toHaveLength(3);
    const implementingBefore = container.querySelector<HTMLInputElement>(
      'input[aria-label="Implement before project"]',
    );
    const mandatoryUserBoundary = container.querySelector<HTMLInputElement>(
      'input[aria-label="Local validation after user"]',
    );
    expect(mandatoryUserBoundary?.checked).toBe(true);
    expect(mandatoryUserBoundary?.disabled).toBe(true);
    await act(async () => implementingBefore?.click());
    expect(onSaveCheckpointPolicy).toHaveBeenCalledWith(
      "project",
      expect.arrayContaining([
        expect.objectContaining({ stage: "implementing", position: "before" }),
      ]),
      1,
    );
    expect(
      container.querySelector(".project-workflow-contract")?.getAttribute("aria-label"),
    ).toBe("Auto Hunt 워크플로 다이어그램");

    const revisionInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="자연어로 수정 요청"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(
        revisionInput,
        "main 에 머지되어야 complete가 되도록 수정해줘",
      );
      revisionInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const reviseButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-settings-workflow-revision button",
      ),
    ).find((button) => button.textContent?.includes("AI로 수정"));
    await act(async () => reviseButton?.click());
    expect(onReviseWorkflow).toHaveBeenCalledWith(
      "main 에 머지되어야 complete가 되도록 수정해줘",
    );
    expect(container.textContent).toContain(
      "요청에 맞게 워크플로우를 수정했습니다.",
    );
    expect(revisionInput?.value).toBe("");

    const analyzeRequirementsButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-settings-automation-actions button",
      ),
    ).find((button) => button.textContent?.includes("필요 도구 분석하기"));
    await act(async () => analyzeRequirementsButton?.click());
    expect(onAnalyzeWorkflowRequirements).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "필요 도구 목록과 이 컴퓨터의 준비 상태를 갱신했습니다.",
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

    await openSection("agent-configuration");
    expect(container.querySelector(".project-settings-card")).toBeNull();
    expect(
      container.querySelector<HTMLElement>(
        ".project-settings-agent-configuration",
      )?.hidden,
    ).toBe(false);
    expect(
      container.querySelector(".project-settings-runtime")?.textContent,
    ).toContain("프로젝트 실행 기본값");
    expect(container.querySelector("#project-runtime-provider")).not.toBeNull();
    expect(container.querySelector("#project-runtime-model")).not.toBeNull();
    expect(container.querySelector("#project-runtime-effort")).not.toBeNull();
    expect(container.querySelector("#project-runtime-approval")).not.toBeNull();

    const providerTrigger = container.querySelector<HTMLButtonElement>(
      "#project-runtime-provider",
    );
    await act(async () => providerTrigger?.click());
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          "#project-runtime-provider-listbox .select-menu-option",
        ),
      ).map((option) => option.dataset.value),
    ).toEqual(["codex", "claude", "grok", "opencode"]);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '#project-runtime-provider-listbox .select-menu-option[data-value="claude"]',
        )
        ?.click();
    });
    const runtimeSave = container.querySelector<HTMLButtonElement>(
      ".project-settings-runtime > footer button",
    );
    expect(runtimeSave?.textContent).toContain("실행 기본값 저장");
    await act(async () => runtimeSave?.click());
    expect(runtimeSave?.textContent).toContain("저장됨");

    const sandboxControl = container.querySelector<HTMLElement>(
      ".project-settings-sandbox",
    );
    expect(sandboxControl?.textContent).toContain("제한 없음");
    const sandboxToggle = sandboxControl?.querySelector<HTMLButtonElement>(
      "button[role='switch']",
    );
    await act(async () => sandboxToggle?.click());
    expect(sandboxControl?.textContent).toContain("워크트리만");
    expect(container.querySelector(".project-settings-auto-run")).toBeNull();
    expect(container.textContent).not.toContain("이 컴퓨터를 Worker로 공유");

    await openSection("execution");
    expect(container.textContent).toContain("프로젝트 실행 정책");
    expect(container.textContent).toContain("모든 연결된 Worker 허용");
    expect(container.textContent).toContain(
      "조직 설정 → Workers에서 관리합니다.",
    );

    await openSection("integrations");
    expect(container.querySelector(".project-settings-card")).toBeNull();
    const velenSection = container.querySelector<HTMLElement>(
      '[data-project-integration="velen"]',
    );
    expect(
      velenSection?.hidden,
    ).toBe(false);
    expect(velenSection?.textContent).toContain(
      "Velen 연결",
    );
    expect(
      container.querySelector<HTMLElement>(
        '[data-project-integration="linear"]',
      )?.hidden,
    ).toBe(true);

    await openSection("issue-import");
    expect(velenSection?.hidden).toBe(true);
    expect(container.textContent).toContain("Linear 연결");
    const linearSection = container.querySelector<HTMLElement>(
      '[data-project-integration="linear"]',
    );
    expect(linearSection?.hidden).toBe(false);
    const linearTeam = linearSection?.querySelector<HTMLInputElement>(
      'input[aria-label="팀 키"]',
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
    const linearSave = linearSection?.querySelector<HTMLButtonElement>(
      ":scope > footer button",
    );
    await act(async () => linearSave?.click());
    expect(onUpdateLinear).toHaveBeenCalledWith({
      enabled: true,
      source: "linear://linear-wordbricks",
      teamKey: "BRIAR",
    });

    await openSection("general");
    expect(container.querySelector(".project-settings-card")?.textContent).toContain(
      "Briar",
    );
    const iconFile = new File(["icon"], "icon.svg", { type: "image/svg+xml" });
    const iconInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="아이콘 업로드"]',
    )!;
    Object.defineProperty(iconInput, "files", {
      configurable: true,
      value: [iconFile],
    });
    await act(async () => {
      iconInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(projectIconFromFile).toHaveBeenCalledWith(iconFile);
    expect(onIconChange).toHaveBeenCalledWith(
      "project-1",
      "data:image/webp;base64,aWNvbg==",
    );
    expect(container.textContent).toContain("프로젝트 아이콘을 저장했습니다.");

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
          onAnalyzeWorkflowRequirements={async () => undefined}
          onDelete={onDelete}
          onRegenerateWorkflow={async () => undefined}
          onReviseWorkflow={async () => undefined}
          onUpdateVelenOrg={async (org) => org}
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
          onIconChange={async () => undefined}
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
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Briar 프로젝트를 삭제할까요?",
    );

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(".delete-project-confirm")
        ?.click();
    });
    expect(onDelete).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
