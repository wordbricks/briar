/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { demoDashboard, demoRunEvents } from "../lib/demo-data";
import type {
  ExecutionWorker,
  HuntRun,
  IssueMessage,
  ProjectAgent,
  RunEvidence,
} from "../types";
import {
  CreateIssueDialog,
  EditIssueDialog,
  HuntDashboard,
  RunPage,
} from "./HuntDashboard";
import { TooltipProvider } from "./ui/tooltip";

const dashboardProps = {
  error: null,
  isCreatingIssue: false,
  deletingIssueId: null,
  updatingIssueId: null,
  recoveringRunId: null,
  recoveryError: null,
  isSidebarOpen: true,
  onCreateIssue: async () => undefined,
  onDeleteIssue: async () => undefined,
  onUpdateIssue: async () => undefined,
  onLoadAttachment: async () => new Blob(),
  onLoadIssueMessages: async () => [],
  onLoadRunEvents: async (runId: string) => demoRunEvents[runId] ?? [],
  onLoadRunEvidence: async () => [],
  onMoveRun: async () => undefined,
  onRetryRun: async () => undefined,
  onCancelRun: async () => undefined,
  onSendIssueMessage: async () => {
    throw new Error("not implemented in this test");
  },
};

const dashboardAgent: ProjectAgent = {
  id: "agent-1",
  projectId: demoDashboard.project.id,
  name: "Briar Agent",
  avatar: "data:image/png;base64,avatar",
  codexPet: null,
  provider: "codex",
  model: null,
  responsibility: "Process issues",
  skill: "# Agent",
  calendarColor: "#3275d5",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

const dashboardWorker: ExecutionWorker = {
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "user-1",
  label: "Lemon Worker",
  icon: { type: "emoji", value: "🍋" },
  agentProvider: "codex",
  providers: ["codex"],
  versions: { briar: "1.2.25" },
  state: "online",
  readiness: "busy",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 1,
  availableSessions: 0,
  lastHeartbeatAt: "2026-07-29T00:00:00.000Z",
  createdAt: "2026-07-29T00:00:00.000Z",
};

function dashboardAgentSession(
  run: HuntRun,
  status: AutoHuntSession["status"] = "running",
): AutoHuntSession {
  return {
    id: "session-1",
    dispatchGroupId: "dispatch-1",
    projectId: demoDashboard.project.id,
    agentId: dashboardAgent.id,
    sessionType: "dispatch",
    status,
    issues: [{
      runId: run.id,
      runNumber: run.runNumber,
      sourceKey: run.sourceKey,
      title: run.title,
      outcome: status === "running" ? "pending" : "completed",
      summary: null,
    }],
    startedAt: "2026-07-29T00:00:00.000Z",
    completedAt:
      status === "running" ? null : "2026-07-29T00:10:00.000Z",
    conversationId: null,
    workspaceRoot: null,
    summary: null,
    error: null,
    events: [],
    dispatchEvents: [],
    workers: [],
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("HuntDashboard", () => {
  it("offers issue creation from the work queue", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={null}
      />,
    );

    expect(markup).toContain("이슈 만들기");
  });

  it("shows the create dialog when issue creation is opened externally", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        isIssueDialogOpen
      />,
    );

    expect(markup).toContain('aria-label="새 Auto Hunt 이슈"');
  });

  it("opens issue creation with Command-N", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    expect(
      container.querySelector('[aria-keyshortcuts="Meta+N"]'),
    ).not.toBeNull();
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyN",
      key: "n",
      metaKey: true,
    });
    await act(async () => {
      window.dispatchEvent(shortcut);
    });

    expect(shortcut.defaultPrevented).toBe(true);
    expect(
      container.querySelector('[aria-label="새 Auto Hunt 이슈"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a safe projectless state after onboarding is deferred", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={null}
        noProject
        onAddProject={() => undefined}
      />,
    );

    expect(markup).toContain("아직 프로젝트가 없습니다.");
    expect(markup).toContain("프로젝트 만들기");
    expect(markup).not.toContain("이슈 만들기");
    expect(markup).not.toContain("자동사냥 칸반 보드");
  });

  it("uses the kanban as the full dashboard surface", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    );

    expect(markup).not.toContain("queue-panel");
    expect(markup).toContain('class="page-header');
    expect(markup).toContain("queue-header");
    expect(markup).toContain("app-page-header");
    expect(markup).not.toContain("에이전트가 처리하는 작업의 흐름과 병목");
    expect(markup).toContain('class="kanban-board"');
    expect(markup).not.toContain('class="page-heading"');
    expect(markup).not.toContain('class="metric-grid"');
  });

  it("separates header actions from status and type filters", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    const header = container.querySelector(".queue-header");
    const tools = header?.querySelector(".queue-tools");
    const filterBar = container.querySelector(".queue-filter-bar");

    expect(tools?.querySelector(".search-box")).not.toBeNull();
    expect(tools?.querySelector(".view-switch")).not.toBeNull();
    expect(tools?.querySelector(".create-issue-button")).not.toBeNull();
    expect(header?.querySelector(".source-filter")).toBeNull();
    expect(filterBar?.querySelector(".status-tabs")).not.toBeNull();
    expect(filterBar?.querySelector(".source-filter")).not.toBeNull();
    expect(filterBar?.textContent).toContain("유형");

    await act(async () => root.unmount());
  });

  it("does not show a repository connection banner", () => {
    const disconnectedState = { needsLocalConnection: true };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        {...disconnectedState}
        dashboard={demoDashboard}
      />,
    );

    expect(markup).not.toContain("connect-banner");
    expect(markup).not.toContain(
      "이 컴퓨터에 저장소가 연결되지 않았습니다.",
    );
  });

  it("shows the issue description instead of the run status detail on cards", () => {
    const run = {
      ...demoDashboard.runs[0],
      detail: "진행 상태 설명",
      issueDescription: "사용자가 작성한 실제 이슈 설명",
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [run] }}
      />,
    );

    expect(markup).toContain(
      '<span class="kanban-card-description">사용자가 작성한 실제 이슈 설명</span>',
    );
    expect(markup).not.toContain("진행 상태 설명");
  });

  it("attaches the active agent avatar badge to the issue being processed", () => {
    const run = demoDashboard.runs[0];
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        agents={[dashboardAgent]}
        dashboard={{ ...demoDashboard, runs: [run] }}
        sessions={[dashboardAgentSession(run)]}
      />,
    );

    expect(markup).toContain("kanban-card violet has-assignees");
    expect(markup).toContain('class="kanban-card-agent-badge"');
    expect(markup).toContain('aria-label="Briar Agent 할당"');
    expect(markup).toContain(`src="${dashboardAgent.avatar}"`);
  });

  it("stacks the assigned worker icon with the active agent avatar", () => {
    const run = {
      ...demoDashboard.runs[0],
      workerId: dashboardWorker.id,
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        agents={[dashboardAgent]}
        dashboard={{
          ...demoDashboard,
          runs: [run],
          workers: [dashboardWorker],
        }}
        sessions={[dashboardAgentSession(run)]}
      />,
    );

    expect(markup).toContain(
      "kanban-card violet has-assignees has-multiple-assignees",
    );
    expect(markup).toContain('class="kanban-card-assignee-badges"');
    expect(markup).toContain('class="kanban-card-worker-badge"');
    expect(markup).toContain('aria-label="배정된 Worker: Lemon Worker"');
    expect(markup).toContain("🍋");
    expect(markup).toContain('class="kanban-card-agent-badge"');
  });

  it("shows a specifically requested worker before it claims the issue", () => {
    const run = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      requestedWorkerId: dashboardWorker.id,
      workerId: null,
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs: [run],
          workers: [dashboardWorker],
        }}
      />,
    );

    expect(markup).toContain("kanban-card slate has-assignees");
    expect(markup).toContain('class="kanban-card-worker-badge"');
    expect(markup).toContain('aria-label="배정된 Worker: Lemon Worker"');
    expect(markup).not.toContain("kanban-card-agent-badge");
  });

  it.each(["completed", "cancelled", "blocked", "failed"] as const)(
    "hides the assigned worker icon when an issue is %s",
    (status) => {
      const run = {
        ...demoDashboard.runs[0],
        status,
        workflowStage: null,
        workerId: dashboardWorker.id,
      };
      const markup = renderToStaticMarkup(
        <HuntDashboard
          {...dashboardProps}
          dashboard={{
            ...demoDashboard,
            runs: [run],
            workers: [dashboardWorker],
          }}
        />,
      );

      expect(markup).not.toContain("kanban-card-worker-badge");
      expect(markup).not.toContain("has-assignees");
    },
  );

  it("keeps the performed agent name in issue properties after completion", async () => {
    const run = demoDashboard.runs[0];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        agents={[dashboardAgent]}
        dashboard={{ ...demoDashboard, runs: [run] }}
        sessions={[dashboardAgentSession(run, "completed")]}
      />,
    ));

    expect(container.querySelector(".kanban-card-agent-badge")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-properties-toggle")?.click();
    });
    const agentProperty = Array.from(
      container.querySelectorAll<HTMLElement>(".run-property"),
    ).find((property) => property.getAttribute("aria-label")?.startsWith("에이전트:"));
    expect(agentProperty?.querySelector("strong")?.textContent).toBe(
      dashboardAgent.name,
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not show an agent badge without a processing session", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        agents={[]}
        dashboard={{ ...demoDashboard, runs: [demoDashboard.runs[0]] }}
        sessions={[]}
      />,
    );

    expect(markup).not.toContain("kanban-card-agent-badge");
    expect(markup).not.toContain("has-assignees");
  });

  it("opens a linked pull request from the issue card icon", async () => {
    const pullRequestUrl =
      "https://github.com/example/repository/pull/42";
    const run = {
      ...demoDashboard.runs[0],
      pullRequestUrls: [pullRequestUrl],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [run] }}
      />,
    ));

    const link = container.querySelector<HTMLAnchorElement>(
      ".pull-request-icon-link",
    );
    expect(link?.href).toBe(pullRequestUrl);
    expect(link?.target).toBe("_blank");
    expect(link?.getAttribute("aria-label")).toBe("PR #42 바로 열기");
    link?.addEventListener("click", (event) => event.preventDefault());
    await act(async () => link?.click());
    expect(container.querySelector(".run-page")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-properties-toggle")?.click();
    });
    const detailLink = container.querySelector<HTMLAnchorElement>(
      ".run-property-link",
    );
    expect(detailLink?.href).toBe(pullRequestUrl);
    expect(detailLink?.textContent).toContain("PR #42");

    await act(async () => root.unmount());
  });

  it("opens issue actions from a card context menu", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    const card = container.querySelector<HTMLButtonElement>(".kanban-card");
    await act(async () => {
      card?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX: 240,
          clientY: 180,
        }),
      );
    });

    const menu = document.body.querySelector<HTMLElement>(
      ".issue-context-menu",
    );
    expect(menu?.textContent).toContain("상태");
    expect(menu?.textContent).toContain("우선순위");
    expect(menu?.textContent).toContain("선호 프로바이더");
    expect(menu?.textContent).toContain("선호 모델");
    expect(menu?.textContent).toContain("바로 처리하기");
    expect(menu?.textContent).toContain("열기");
    expect(menu?.textContent).toContain("수정");
    expect(menu?.textContent).toContain("삭제");
    const processNowItem = Array.from(
      menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).find((item) => item.textContent?.includes("바로 처리하기"));
    expect(processNowItem?.hasAttribute("data-disabled")).toBe(true);

    const editItem = Array.from(
      menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).find((item) => item.textContent?.trim() === "수정");
    await act(async () => editItem?.click());
    expect(container.querySelector(".edit-issue-dialog")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("starts the selected queued issue directly from its context menu", async () => {
    const onProcessIssueNow = vi.fn();
    const queuedRun = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      progress: 0,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [queuedRun] }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
        }),
      );
    });
    const processItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("바로 처리하기"));

    expect(processItem?.hasAttribute("data-disabled")).toBe(false);
    await act(async () => processItem?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);

    await act(async () => root.unmount());
    container.remove();
  });

  it("switches between kanban and list views while preserving issue navigation", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    const listButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="리스트 보기"]',
    );
    expect(listButton?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".kanban-progress")).toBeNull();
    expect(container.querySelector(".kanban-card")?.textContent).not.toContain(
      `${demoDashboard.runs[0].progress}%`,
    );

    await act(async () => listButton?.click());

    expect(container.querySelector(".kanban-board")).toBeNull();
    expect(container.querySelector(".issue-list")).not.toBeNull();
    expect(container.querySelectorAll(".issue-list-row")).toHaveLength(
      demoDashboard.runs.length,
    );
    expect(listButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".issue-list")?.textContent).toContain(
      demoDashboard.runs[0].title,
    );
    expect(container.querySelector(".issue-list")?.textContent).not.toContain(
      "진행률",
    );
    expect(container.querySelector(".issue-list-progress")).toBeNull();
    expect(container.querySelector(".issue-list")?.textContent).not.toContain(
      `${demoDashboard.runs[0].progress}%`,
    );
    expect(
      container.querySelectorAll(".issue-list-header [role='columnheader']"),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(".issue-list-row:first-child [role='cell']"),
    ).toHaveLength(4);

    await act(async () => {
      container.querySelector<HTMLElement>(".issue-list-row")?.click();
    });
    expect(container.querySelector(".run-page")).not.toBeNull();
    expect(container.querySelector(".run-page-actions-trigger")).not.toBeNull();
    expect(container.querySelector(".issue-list")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-titlebar-back")?.click();
    });
    expect(container.querySelector(".issue-list")).not.toBeNull();
    expect(container.querySelector(".kanban-board")).toBeNull();
    await act(async () => root.unmount());
  });

  it("shows copy ID and link beside the title and edit/delete in the actions menu", async () => {
    const onDeleteIssue = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onDeleteIssue={onDeleteIssue}
      />,
    ));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    const title = container.querySelector(".run-page-window-title");
    const trigger = container.querySelector<HTMLButtonElement>(
      ".run-page-actions-trigger",
    );
    const copyLink = container.querySelector<HTMLButtonElement>(
      ".run-page-share-copy",
    );
    const copyId = container.querySelector<HTMLButtonElement>(
      ".run-page-id-copy",
    );
    const titlebarActions = container.querySelector(
      ".run-page-titlebar-actions",
    );
    expect(copyLink?.getAttribute("aria-label")).toBe("링크 복사");
    expect(copyId?.getAttribute("aria-label")).toBe("이슈 ID 복사");
    expect(title?.nextElementSibling).toBe(titlebarActions);
    expect(titlebarActions?.firstElementChild?.classList).toContain(
      "run-page-property-badges",
    );
    expect(
      titlebarActions?.querySelector(".run-page-properties-toggle"),
    ).not.toBeNull();
    expect(copyId?.nextElementSibling).toBe(copyLink);
    expect(copyLink?.nextElementSibling).toBe(trigger);
    expect(container.querySelector(".run-page-edit")).toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu?.textContent).not.toContain("링크 공유");
    expect(menu?.textContent).toContain("수정");
    expect(menu?.textContent).toContain("삭제");

    const deleteItem = Array.from(
      menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).find((item) => item.textContent?.includes("삭제"));
    await act(async () => deleteItem?.click());
    expect(document.body.textContent).toContain(
      "활동 기록, 대화, 첨부 파일이 영구적으로 삭제됩니다",
    );

    const confirmButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "삭제");
    await act(async () => confirmButton?.click());
    expect(onDeleteIssue).toHaveBeenCalledWith(demoDashboard.runs[0].id);
    expect(container.querySelector(".run-page")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the companion queue directly in its parent", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={demoDashboard}
      />,
    );

    expect(markup).not.toContain("queue-panel");
    expect(markup).toContain('aria-label="이슈 만들기"');
    expect(markup).toContain("companion-bottom-nav");
    expect(markup).toContain("companion-fab");
    expect(markup).toContain("검색");
    expect(markup).toMatch(/<strong[^>]*>Inbox<\/strong>/);
    expect(markup).not.toContain('class="search-box"');
    expect(markup).toContain('aria-label="필터"');
    expect(markup).not.toContain('class="source-filter"');
    expect(markup).not.toContain('class="companion-search-trigger"');
    expect(markup).not.toContain('class="status-tabs"');
  });

  it("keeps the desktop context menu disabled in companion mode", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={demoDashboard}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
        }),
      );
    });
    expect(document.body.querySelector(".issue-context-menu")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the companion source filter from the queue heading", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={demoDashboard}
      />,
    ));

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="필터"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => trigger?.click());

    const menu = container.querySelector('[role="menu"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(4);
    expect(menu?.textContent).toContain("전체");
    expect(menu?.textContent).toContain("피드백");

    const feedback = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    ).find((button) => button.textContent?.includes("피드백"));
    await act(async () => feedback?.click());

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger?.className).toContain("active");
    await act(async () => root.unmount());
  });

  it("renders task search on the companion Search page", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        companionSearchMode
        dashboard={demoDashboard}
      />,
    );

    expect(markup).toMatch(/<h2[^>]*>검색<\/h2>/);
    expect(markup).toContain('class="search-box"');
    expect(markup).toContain('placeholder="작업 검색"');
    expect(markup).toMatch(
      /aria-current="page"[^>]*class="[^"]*active[^"]*"/,
    );
  });

  it("renders the issue editor metadata and accepts image or video files", () => {
    const markup = renderToStaticMarkup(
      <CreateIssueDialog
        defaultProjectId="project-1"
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={async () => undefined}
        projects={[
          {
            id: "project-1",
            name: "GG",
            organizationId: "organization-1",
            createdAt: "2026-07-01T00:00:00.000Z",
          },
          {
            id: "project-2",
            name: "Mobile",
            organizationId: "organization-1",
            createdAt: "2026-07-02T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("새 이슈");
    expect(markup).toContain(">GG<");
    expect(markup).toContain("대기");
    expect(markup).toContain("프로젝트");
    expect(markup).not.toContain("담당자");
    expect(markup).not.toContain("라벨");
    expect(markup).toContain('aria-haspopup="listbox" aria-label="프로젝트"');
    expect(markup).toContain('aria-haspopup="listbox" aria-label="상태"');
    expect(markup).toContain("native-select issue-status-select");
    expect(markup).toContain('aria-haspopup="listbox" aria-label="우선순위"');
    expect(markup).toContain("native-select issue-priority-select");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('aria-label="이미지 또는 영상 첨부"');
    expect(markup).toContain("video/quicktime");
    expect(markup).toContain("Enter로 등록");
  });

  it("edits an issue title, description, and priority", async () => {
    let updated:
      | {
          title: string;
          description: string | null;
          priority: number | null;
        }
      | undefined;
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EditIssueDialog
          isSubmitting={false}
          onClose={() => undefined}
          onUpdate={async (input) => {
            updated = input;
          }}
          run={{ ...demoDashboard.runs[0], priority: 3 }}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    const description = container.querySelector<HTMLTextAreaElement>(
      ".issue-description-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(title, "수정된 이슈");
      title?.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(description, "수정된 설명");
      description?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(updated).toEqual({
      title: "수정된 이슈",
      description: "수정된 설명",
      priority: 3,
    });
    await act(async () => root.unmount());
  });

  it("shows an active queue claim", () => {
    const claimedDashboard = {
      ...demoDashboard,
      runs: [
        {
          ...demoDashboard.runs[0],
          status: "queued" as const,
          workflowStage: null,
          claimedBy: "briar-workflow",
          claimedAt: new Date().toISOString(),
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          claimAttempts: 1,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={claimedDashboard}
      />,
    );

    expect(markup).toContain("briar-workflow 할당");
  });

  it("renders workflow stages as kanban columns", () => {
    const customWorkflow = {
      version: 1 as const,
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "security_review", label: "Security review", required: true },
      ],
      execution: { stopAfterStage: "security_review" },
      completion: { requiredStages: ["analyzing", "security_review"] },
    };
    const customDashboard = {
      ...demoDashboard,
      settings: { ...demoDashboard.settings, workflow: customWorkflow },
      runs: [{
        ...demoDashboard.runs[0],
        status: "running" as const,
        workflowStage: "security_review",
        workflow: customWorkflow,
      }],
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={customDashboard}
      />,
    );

    expect(markup).toContain('aria-label="자동사냥 칸반 보드"');
    expect(markup).toContain("분석");
    expect(markup).toContain("Security review");
    expect(markup).toContain('class="kanban-card');
    expect(markup).toContain('class="kanban-card-copy"');
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain('aria-label="백로그"');
    expect(markup).toContain('aria-label="차단"');
    expect(markup).toContain('aria-label="실패"');
    expect(markup).toContain('aria-label="취소"');
  });

  it("opens issue details as a page and returns to the kanban", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".dialog-backdrop")).toBeNull();
    expect(container.querySelector(".run-page")).not.toBeNull();
    expect(container.querySelector(".kanban-board")).toBeNull();
    expect(container.querySelector(".window-controls")).toBeNull();
    const titlebarBack = container.querySelector(".run-page-titlebar-back");
    expect(titlebarBack?.getAttribute("aria-label")).toBe("돌아가기");
    expect(container.querySelector(".run-page-window-number")?.textContent).toBe(
      `AH-${demoDashboard.runs[0].runNumber}`,
    );
    const windowTitle = container.querySelector(".run-page-window-title");
    expect(windowTitle?.textContent).toBe(demoDashboard.runs[0].title);
    expect(windowTitle?.getAttribute("title")).toBe(demoDashboard.runs[0].title);
    expect(
      container
        .querySelector(".run-page-shell > .topbar")
        ?.getAttribute("data-tauri-drag-region"),
    ).toBe("deep");
    expect(container.querySelector(".run-page-heading")).toBeNull();
    expect(container.querySelector(".run-page-back")).toBeNull();
    expect(container.querySelector(".run-page-title-row")).toBeNull();
    // Status strip (Queued + Attempt/Revision) was removed; those values live in Properties.
    expect(container.querySelector(".run-page-summary")).toBeNull();
    expect(container.querySelector(".run-page-meta")).toBeNull();
    expect(container.querySelector(".run-page > header")).toBeNull();
    expect(container.querySelector(".issue-activity-trigger")).toBeNull();
    expect(container.querySelector(".run-page-content > h1")).toBeNull();
    expect(container.querySelector(".run-page-content > .eyebrow")).toBeNull();
    expect(container.querySelector(".run-page-content > .run-detail")).toBeNull();
    expect(container.querySelector(".run-page-content > .run-issue-description")).toBeNull();
    expect(container.querySelector(".run-page-content > .issue-activity")).toBeNull();
    expect(container.querySelector(".run-properties")).toBeNull();
    expect(
      container.querySelectorAll(".run-page-property-badge"),
    ).toHaveLength(4);
    const propertiesToggle = container.querySelector<HTMLButtonElement>(
      ".run-page-properties-toggle",
    );
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => propertiesToggle?.click());
    const properties = container.querySelector(".run-properties");
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(properties).not.toBeNull();
    expect(properties?.textContent).toContain("속성");
    expect(properties?.textContent).toContain("저장소");
    expect(properties?.textContent).toContain("시도");
    expect(properties?.textContent).toContain("리비전");
    expect(
      properties?.querySelector('[aria-label^="우선순위:"]'),
    ).not.toBeNull();
    expect(properties?.querySelectorAll(".run-property-copy small")).toHaveLength(0);
    expect(properties?.querySelector(".run-status-control")).not.toBeNull();
    expect(properties?.textContent).not.toContain("전체 진행률");
    expect(properties?.querySelector(".run-property.progress")).toBeNull();
    const propertiesLayer = container.querySelector<HTMLElement>(
      ".run-properties-layer",
    );
    await act(async () => properties?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    expect(container.querySelector(".run-properties")).not.toBeNull();
    await act(async () => propertiesLayer?.click());
    expect(container.querySelector(".run-properties")).toBeNull();
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("로컬 저장소 열기");
    expect(container.textContent).not.toContain(
      "Auto Hunt 실행 증거를 실시간으로 표시합니다.",
    );
    expect(container.querySelector(".issue-status-history-panel")).toBeNull();
    const statusHistoryTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent === "상태");
    expect(statusHistoryTab).not.toBeNull();
    await act(async () => statusHistoryTab?.click());
    const statusHistoryPanel = container.querySelector(
      ".issue-status-history-panel",
    );
    expect(statusHistoryPanel?.getAttribute("role")).toBe("tabpanel");
    expect(statusHistoryPanel?.textContent).toContain(
      demoRunEvents[demoDashboard.runs[0].id][0].detail ?? "",
    );
    expect(
      statusHistoryPanel?.querySelectorAll(".timeline-event"),
    ).toHaveLength(demoRunEvents[demoDashboard.runs[0].id].length);
    expect(container.querySelector(".issue-activity-dialog")).toBeNull();
    const descriptionTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent === "이슈");
    await act(async () => descriptionTab?.click());
    expect(container.querySelector(".issue-status-history-panel")).toBeNull();
    const descriptionPane = container.querySelector(".issue-description-pane");
    expect(descriptionPane).not.toBeNull();
    expect(descriptionPane?.querySelector(":scope > header")).toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-markdown")).toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-empty")).not.toBeNull();
    expect(descriptionPane?.textContent).not.toContain(demoDashboard.runs[0].detail);
    expect(container.querySelector(".issue-content-divider")).toBeNull();
    const conversation = container.querySelector(".issue-conversation");
    expect(conversation).not.toBeNull();
    expect(conversation?.getAttribute("aria-label")).toBe("대화");
    expect(conversation?.querySelector(":scope > header")?.textContent).toContain(
      "대화",
    );
    expect(container.querySelector(".run-page-main")?.nextElementSibling).toBe(
      conversation,
    );
    expect(
      conversation?.querySelector(".issue-message-list + .issue-message-composer"),
    ).not.toBeNull();
    expect(container.querySelector(".run-page-composer-dock")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-titlebar-back")?.click();
    });

    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a retryable state when the detail timeline fails to load", async () => {
    const events = demoRunEvents[demoDashboard.runs[0].id];
    const onLoadRunEvents = vi
      .fn<() => Promise<typeof events>>()
      .mockRejectedValueOnce(new Error("Timeline unavailable"))
      .mockResolvedValueOnce(events);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onLoadRunEvents={onLoadRunEvents}
        requestedRunId={demoDashboard.runs[0].id}
      />,
    ));
    const statusHistoryTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent === "상태");
    await act(async () => statusHistoryTab?.click());

    const retry = container.querySelector<HTMLButtonElement>(
      ".issue-status-history-panel .run-evidence-state.error",
    );
    expect(retry?.textContent).toContain("Timeline unavailable");
    await act(async () => retry?.click());
    expect(
      container.querySelectorAll(".issue-status-history-panel .timeline-event"),
    ).toHaveLength(events.length);
    expect(onLoadRunEvents).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it("returns from issue details when the issue list is requested", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        requestedRunId={demoDashboard.runs[0].id}
      />,
    ));

    expect(container.querySelector(".run-page")).not.toBeNull();

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        issueListRequestKey={1}
      />,
    ));

    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps in-page issue navigation and adds conversation as a tab in companion mode", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <RunPage
        companionMode
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onDelete={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onProcessNow={() => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        onUpdateIssue={async () => undefined}
        run={demoDashboard.runs[0]}
      />,
    ));

    expect(container.querySelector(".run-page-titlebar-back")).toBeNull();
    expect(container.querySelector(".run-page-back")).not.toBeNull();
    expect(container.textContent).toContain(
      `AH-${demoDashboard.runs[0].runNumber}`,
    );
    expect(container.querySelector("#run-page-title")?.textContent).toBe(
      demoDashboard.runs[0].title,
    );
    expect(container.querySelector(".run-page-actions-trigger")).not.toBeNull();
    expect(container.querySelector(".run-page-process-now")).not.toBeNull();
    expect(container.textContent).toContain("바로 처리");
    expect(container.querySelector(".run-page-meta")).toBeNull();
    expect(container.querySelector(".run-page-summary")).toBeNull();

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const conversationTab = tabs.find((tab) => tab.textContent === "대화");
    const conversationPanel = container.querySelector<HTMLElement>(
      ".issue-conversation-tab-panel",
    );
    expect(tabs).toHaveLength(5);
    expect(conversationTab).not.toBeNull();
    expect(conversationPanel?.hidden).toBe(true);
    expect(conversationTab?.getAttribute("aria-controls")).toBe(
      conversationPanel?.id,
    );
    expect(
      container
        .querySelector(".run-page-main")
        ?.nextElementSibling?.classList.contains("issue-conversation"),
    ).not.toBe(true);

    await act(async () => conversationTab?.click());

    expect(conversationTab?.getAttribute("aria-selected")).toBe("true");
    expect(conversationPanel?.hidden).toBe(false);
    expect(conversationPanel?.getAttribute("role")).toBe("tabpanel");
    expect(conversationPanel?.querySelector(".issue-conversation")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows editable prerequisite and follow-up relationships in issue properties", async () => {
    const prerequisite = demoDashboard.runs[1];
    const dependent = demoDashboard.runs[0];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          availableRuns={demoDashboard.runs}
          isSidebarOpen
          error={null}
          isRecovering={false}
          onAddDependency={async () => undefined}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRemoveDependency={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{
            ...dependent,
            prerequisites: [
              {
                id: prerequisite.id,
                runNumber: prerequisite.runNumber,
                title: prerequisite.title,
                status: prerequisite.status,
              },
            ],
            dependents: [],
          }}
        />
      </TooltipProvider>,
    ));

    expect(
      container.querySelector(".issue-description-scroll .issue-dependencies"),
    ).toBeNull();
    expect(container.querySelector(".issue-dependencies")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-properties-toggle")?.click();
    });
    const dependencies = container.querySelector(
      ".run-properties .issue-dependencies",
    );
    expect(dependencies).not.toBeNull();
    expect(dependencies?.textContent).toContain("선행 이슈");
    expect(dependencies?.textContent).toContain(`AH-${prerequisite.runNumber}`);
    expect(dependencies?.textContent).toContain(prerequisite.title);
    expect(dependencies?.textContent).toContain("후속 이슈");
    expect(
      dependencies?.querySelector('[aria-label*="의존성 제거"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the issue description as Markdown above the conversation", () => {
    const markup = renderToStaticMarkup(
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={{
          ...demoDashboard.runs[0],
          issueDescription: [
            "# 목표",
            "",
            "- 상세 내용을 표시합니다.",
            "- 대화 위에 배치합니다.",
            "",
            "~~일반 텍스트~~ **마크다운**",
            "",
            "![화면](briar-attachment://attachment-1)",
          ].join("\n"),
          attachments: [
            {
              id: "attachment-1",
              filename: "screen.png",
              contentType: "image/png",
              byteSize: 1024,
              url: "/attachments/attachment-1",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain('<div class="issue-description-markdown">');
    expect(markup).toContain("<h1>목표</h1>");
    expect(markup).toContain("<li>상세 내용을 표시합니다.</li>");
    expect(markup).toContain("<del>일반 텍스트</del>");
    expect(markup).toContain('class="issue-markdown-image-state"');
    expect(markup).not.toContain('class="run-attachments"');
    expect(markup.indexOf("issue-description-pane")).toBeLessThan(
      markup.indexOf("issue-conversation"),
    );
  });

  it("loads collected evidence in the issue evidence tab", async () => {
    const observedAt = "2026-07-28T04:30:00.000Z";
    const evidence: RunEvidence[] = [
      {
        key: "BRIAR-12:analyzing:repository_findings",
        attempt: 1,
        revision: 1,
        stage: "analyzing",
        type: "repository_findings",
        status: "passed",
        detail: "증빙 조회 경로와 화면 연결 지점을 확인했습니다.",
        command: "bun run test src/components/HuntDashboard.test.tsx",
        url: "https://example.com/evidence/1",
        metadata: { suite: "dashboard" },
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        requiredRevision: 1,
        canonical: true,
      },
    ];
    const onLoadRunEvidence = vi.fn(async () => evidence);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={onLoadRunEvidence}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{
            ...demoDashboard.runs[0],
            workflow: {
              ...demoDashboard.runs[0].workflow,
              stages: demoDashboard.runs[0].workflow.stages.map((stage) =>
                stage.id === "analyzing"
                  ? { ...stage, evidence: ["repository_findings"] }
                  : stage.id === "local_qa"
                    ? { ...stage, evidence: ["local_ci_result"] }
                    : stage,
              ),
            },
          }}
        />,
      );
    });

    const evidenceTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("증빙"));
    await act(async () => evidenceTab?.click());

    expect(onLoadRunEvidence).toHaveBeenCalledOnce();
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "repository_findings",
    );
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "증빙 조회 경로와 화면 연결 지점을 확인했습니다.",
    );
    expect(container.querySelector(".run-evidence-command code")?.textContent)
      .toContain("HuntDashboard.test.tsx");
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "local_ci_result",
    );
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "기록 안 됨",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows authenticated result screenshots in the result and evidence tabs", async () => {
    const observedAt = "2026-07-28T04:30:00.000Z";
    const image = {
      id: "image-1",
      filename: "finished-dashboard.png",
      contentType: "image/png",
      byteSize: 1024,
      sha256: "abc",
      position: 0,
      url: "/projects/project-1/runs/run-1/evidence/images/image-1",
    };
    const staleImage = {
      ...image,
      id: "image-stale",
      filename: "stale-dashboard.png",
      url: "/projects/project-1/runs/run-1/evidence/images/image-stale",
    };
    const failedImage = {
      ...image,
      id: "image-failed",
      filename: "failed-dashboard.png",
      url: "/projects/project-1/runs/run-1/evidence/images/image-failed",
    };
    const evidence: RunEvidence[] = [
      {
        key: "BRIAR-12:local_qa:ui_result",
        attempt: 1,
        revision: 1,
        stage: "local_qa",
        type: "ui_result",
        status: "passed",
        detail: "완성된 대시보드 화면을 확인했습니다.",
        command: null,
        url: null,
        metadata: null,
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        images: [image],
        requiredRevision: 1,
        canonical: true,
      },
      {
        key: "BRIAR-12:local_qa:stale_ui_result",
        attempt: 1,
        revision: 0,
        stage: "local_qa",
        type: "ui_result",
        status: "passed",
        detail: "이전 리비전 화면입니다.",
        command: null,
        url: null,
        metadata: null,
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        images: [staleImage],
        requiredRevision: 1,
        canonical: false,
      },
      {
        key: "BRIAR-12:local_qa:failed_ui_result",
        attempt: 1,
        revision: 1,
        stage: "local_qa",
        type: "ui_result",
        status: "failed",
        detail: "실패한 화면입니다.",
        command: null,
        url: null,
        metadata: null,
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        images: [failedImage],
        requiredRevision: 1,
        canonical: true,
      },
    ];
    const onLoadImage = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:result-screenshot"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => evidence}
          onLoadRunEvidenceImage={onLoadImage}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{
            ...demoDashboard.runs[0],
            status: "completed",
            resultSummary: "완료된 결과를 확인했습니다.",
          }}
        />,
      );
    });

    expect(onLoadImage).toHaveBeenCalledTimes(1);
    expect(onLoadImage).toHaveBeenCalledWith(image);
    expect(onLoadImage).not.toHaveBeenCalledWith(staleImage);
    expect(onLoadImage).not.toHaveBeenCalledWith(failedImage);
    expect(
      container
        .querySelector(".run-result-screenshots .run-evidence-image img")
        ?.getAttribute("src"),
    ).toBe("blob:result-screenshot");
    expect(
      container.querySelectorAll(
        ".run-result-screenshots .run-evidence-image",
      ),
    ).toHaveLength(1);
    expect(
      container.querySelector(".run-result-screenshots")?.textContent,
    ).toContain("결과 화면");

    const evidenceTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("증빙"));
    await act(async () => evidenceTab?.click());

    expect(onLoadImage).toHaveBeenCalledWith(image);
    expect(onLoadImage).toHaveBeenCalledWith(staleImage);
    expect(onLoadImage).toHaveBeenCalledWith(failedImage);
    expect(
      container.querySelector(".run-evidence-image img")?.getAttribute("src"),
    ).toBe("blob:result-screenshot");
    expect(container.querySelector(".run-evidence-images")?.textContent).toContain(
      "결과 화면",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps loaded messages visible when the run snapshot refreshes", async () => {
    const createdAt = new Date().toISOString();
    const loadedMessage: IssueMessage = {
      id: "message-loaded",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "계속 보여야 하는 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const onLoadIssueMessages = vi
      .fn<() => Promise<IssueMessage[]>>()
      .mockResolvedValueOnce([loadedMessage])
      .mockImplementation(() => new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (run = demoDashboard.runs[0]) => (
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={() => onLoadIssueMessages()}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={run}
      />
    );

    await act(async () => root.render(renderPage()));
    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".issue-message-list")?.textContent).toContain(
      loadedMessage.body,
    );

    await act(async () => {
      root.render(
        renderPage({
          ...demoDashboard.runs[0],
          updatedAt: new Date(Date.now() + 15_000).toISOString(),
        }),
      );
    });

    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".issue-message-state")).toBeNull();
    expect(container.querySelector(".issue-message-list")?.textContent).toContain(
      loadedMessage.body,
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("scrolls the conversation to the bottom after loading and sending", async () => {
    const createdAt = new Date().toISOString();
    const loadedMessage: IssueMessage = {
      id: "message-loaded",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "기존 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const sentMessage: IssueMessage = {
      ...loadedMessage,
      id: "message-sent",
      body: "새 메시지",
    };
    let resolveLoadedMessages: (messages: IssueMessage[]) => void =
      () => undefined;
    const loadedMessages = new Promise<IssueMessage[]>((resolve) => {
      resolveLoadedMessages = resolve;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={() => loadedMessages}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => ({
            message: sentMessage,
            agentReply: null,
          })}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const messageList = container.querySelector<HTMLElement>(
      ".issue-message-list",
    );
    expect(messageList).not.toBeNull();
    if (!messageList) throw new Error("message list was not rendered");
    Object.defineProperty(messageList, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    messageList.scrollTop = 0;
    await act(async () => {
      resolveLoadedMessages([loadedMessage]);
      await loadedMessages;
      await Promise.resolve();
    });
    expect(messageList?.scrollTop).toBe(640);

    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    expect(textarea?.rows).toBe(2);
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, sentMessage.body);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    messageList.scrollTop = 0;
    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(messageList?.scrollTop).toBe(640);

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens a message thread in the right drawer and closes it with Escape", async () => {
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "원문 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "스레드 답장",
      replyCount: 0,
    };
    const sentReply: IssueMessage = {
      ...reply,
      id: "message-new-reply",
      body: "새 스레드 답장",
    };
    const agentReply: IssueMessage = {
      ...sentReply,
      id: "message-agent-reply",
      body: "스레드에서 답변합니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
    };
    let resolveAgentReply: (message: IssueMessage) => void = () => undefined;
    const pendingAgentReply = new Promise<IssueMessage>((resolve) => {
      resolveAgentReply = resolve;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [rootMessage, reply]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => ({
            message: sentReply,
            agentReply: pendingAgentReply,
          })}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const threadSummary = container.querySelector<HTMLButtonElement>(
      ".issue-thread-summary",
    );
    expect(threadSummary?.getAttribute("title")).toBe("스레드에서 답장하기");
    expect(threadSummary?.textContent).toContain("답장 1개");
    expect(threadSummary?.textContent).toContain("스레드 보기");
    expect(
      threadSummary?.querySelector('.issue-thread-participant[title="Jay"]'),
    ).not.toBeNull();
    expect(container.querySelector(".issue-message-actions")).toBeNull();
    const threadContent = container.querySelector<HTMLElement>(
      ".issue-thread-content",
    );
    expect(threadContent).not.toBeNull();
    if (!threadContent) throw new Error("thread content was not rendered");
    Object.defineProperty(threadContent, "scrollHeight", {
      configurable: true,
      value: 480,
    });
    threadContent.scrollTop = 0;
    await act(async () => threadSummary?.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector(".issue-thread-content")?.textContent).toContain(
      "스레드 답장",
    );
    expect(threadContent?.scrollTop).toBe(480);
    const threadDrawer = container.querySelector<HTMLElement>(
      ".issue-thread-drawer",
    );
    const threadLayer = container.querySelector<HTMLElement>(
      ".issue-thread-layer",
    );
    await act(async () => threadDrawer?.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => threadLayer?.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(threadSummary);
    await act(async () => threadSummary?.click());

    const threadComposer = container.querySelector<HTMLElement>(
      ".issue-thread-drawer .issue-message-composer",
    );
    const threadTextarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-thread-drawer .issue-message-composer textarea",
    );
    expect(
      threadComposer?.querySelector(".issue-composer-formatting"),
    ).toBeNull();
    expect(
      threadComposer?.querySelector(".issue-composer-link"),
    ).not.toBeNull();
    expect(threadComposer?.querySelectorAll("footer button")).toHaveLength(2);
    expect(threadTextarea?.placeholder).toBe("답장 남기기…");
    await act(async () => {
      if (!threadTextarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(threadTextarea, sentReply.body);
      threadTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    threadContent.scrollTop = 0;
    await act(async () => {
      threadTextarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(threadContent?.scrollTop).toBe(480);
    expect(
      threadContent.querySelector(":scope > .issue-agent-reply-state")
        ?.textContent,
    ).toContain("Briar가 답변을 작성하고 있습니다");
    expect(
      container.querySelector(".issue-message-list > .issue-agent-reply-state"),
    ).toBeNull();

    await act(async () => {
      resolveAgentReply(agentReply);
      await pendingAgentReply;
    });
    expect(threadContent.textContent).toContain(agentReply.body);
    expect(
      threadContent.querySelector(":scope > .issue-agent-reply-state"),
    ).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(threadSummary);
    await act(async () => root.unmount());
    container.remove();
  });

  it("inserts @briar and places the provider reply in its thread", async () => {
    const createdAt = new Date().toISOString();
    const userMessage: IssueMessage = {
      id: "message-user",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "@briar 변경 내용을 설명해 줘",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const agentMessage: IssueMessage = {
      ...userMessage,
      id: "message-agent",
      parentMessageId: userMessage.id,
      body: "Codex가 처리한 변경 내용을 설명합니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
    };
    let sentBody = "";
    let resolveAgentReply: (message: IssueMessage) => void = () => undefined;
    const pendingAgentReply = new Promise<IssueMessage>((resolve) => {
      resolveAgentReply = resolve;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async (input) => {
            sentBody = input.body;
            return {
              message: userMessage,
              agentReply: pendingAgentReply,
            };
          }}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => {
      textarea?.focus();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@briar ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea?.value).toBe("@briar ");

    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@briar 변경 내용을 설명해 줘");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          shiftKey: true,
        }),
      );
    });
    expect(sentBody).toBe("");
    expect(textarea?.value).toBe("@briar 변경 내용을 설명해 줘");

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });

    expect(sentBody).toBe("@briar 변경 내용을 설명해 줘");
    expect(textarea?.value).toBe("");
    expect(container.textContent).toContain(userMessage.body);
    expect(container.textContent).toContain("Briar가 답변을 작성하고 있습니다");
    const userMessageItem = Array.from(
      container.querySelectorAll<HTMLElement>(".issue-message"),
    ).find((item) => item.textContent?.includes(userMessage.body));
    expect(
      userMessageItem?.querySelector(".issue-agent-reply-state"),
    ).not.toBeNull();
    expect(
      container.querySelector(".issue-message-list > .issue-agent-reply-state"),
    ).toBeNull();
    await act(async () => {
      resolveAgentReply(agentMessage);
      await pendingAgentReply;
    });
    expect(
      container.querySelector(".issue-message-list")?.textContent,
    ).not.toContain(agentMessage.body);
    const threadSummary = container.querySelector<HTMLButtonElement>(
      ".issue-thread-summary",
    );
    expect(threadSummary?.textContent).toContain("답장 1개");
    expect(threadSummary?.textContent).toContain("스레드 보기");
    expect(
      threadSummary?.querySelector(
        '.issue-thread-participant.agent[title="Briar · Codex"]',
      ),
    ).not.toBeNull();
    await act(async () => threadSummary?.click());
    expect(container.querySelector(".issue-thread-content")?.textContent)
      .toContain(agentMessage.body);
    expect(
      container.querySelector('.issue-message-avatar.agent[aria-label="Briar · Codex"]'),
    ).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it("suggests and completes @briar when typing a mention", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("message should not be sent");
          }}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => {
      textarea?.focus();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const suggestion = container.querySelector<HTMLButtonElement>(
      '[role="option"]',
    );
    expect(suggestion?.textContent).toContain("@briar");
    expect(textarea?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(textarea?.value).toBe("@briar ");
    expect(container.querySelector('[role="option"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("sends the selected member id with an issue conversation mention", async () => {
    const createdAt = new Date().toISOString();
    let sentInput:
      | {
          body: string;
          parentMessageId: string | null;
          mentionedUserIds?: string[];
        }
      | undefined;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          mentionMembers={[
            {
              userId: "member-1",
              name: "Member One",
              email: "member@example.com",
              image: null,
              role: "member",
              createdAt,
            },
          ]}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async (input) => {
            sentInput = input;
            return {
              message: {
                id: "member-mention",
                runId: demoDashboard.runs[0].id,
                parentMessageId: null,
                body: input.body,
                author: {
                  id: "owner",
                  name: "Owner",
                  image: null,
                  provider: null,
                },
                replyCount: 0,
                createdAt,
                updatedAt: createdAt,
              },
              agentReply: null,
            };
          }}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => {
      textarea?.focus();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@mem");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const suggestion = container.querySelector<HTMLButtonElement>(
      '[role="option"]',
    );
    expect(suggestion?.textContent).toContain("@member");
    await act(async () => suggestion?.click());
    expect(textarea?.value).toBe("@member ");

    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@member 확인해 주세요");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });

    expect(sentInput).toEqual({
      body: "@member 확인해 주세요",
      parentMessageId: null,
      mentionedUserIds: ["member-1"],
    });
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps a drag title header without embedding Auto Hunt health", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={null}
      />,
    );

    expect(markup).toContain("app-page-header");
    expect(markup).toContain('data-tauri-drag-region="deep"');
    expect(markup).not.toContain("health-trigger");
    expect(markup).not.toContain("Auto Hunt 연결 상태");
    expect(markup).not.toContain("Briar CLI");
  });

  it("shows attempt-aware recovery actions for failed runs", () => {
    const failedRun = {
      ...demoDashboard.runs[0],
      status: "failed" as const,
      currentAttempt: 2,
      detail: "Worker deployment timed out",
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={failedRun}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain("실행이 실패했습니다");
    expect(markup).toContain("3번 시도로 새 작업이 시작됩니다");
    expect(markup).toContain("재시도");
    expect(markup).toContain(
      'aria-description="재시도하면 기존 Agent·Worker 배정으로 작업이 다시 대기열에 들어가며, 사용 가능한 Worker가 자동으로 가져가 다시 실행합니다."',
    );
    expect(markup).toContain("작업 취소");
    expect(markup).toContain('class="recovery-panel"');
    expect(markup).toContain('class="run-page-property-badge red"');
    expect(markup).toContain(">실패</span>");
    expect(markup).toContain('aria-expanded="false" class="run-page-properties-toggle"');
  });

  it("does not show an error-like status banner for queued remote work", () => {
    const queuedRemoteRun = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      workerId: "worker-1",
      detail: "사용자가 특정 Worker에 작업을 배정했습니다.",
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={queuedRemoteRun}
        />
      </TooltipProvider>,
    );

    expect(markup).not.toContain('class="recovery-panel"');
    expect(markup).not.toContain("사용자가 특정 Worker에 작업을 배정했습니다.");
    // Status remains visible in compact property badges, not as an error card.
    expect(markup).toContain('class="run-page-property-badge');
    expect(markup).toContain(">대기</span>");
  });

  it("shows a plain-language result card for a completed issue", () => {
    const completedRun = {
      ...demoDashboard.runs[0],
      status: "completed" as const,
      issueDescription: "## 요청\n\n완료 결과를 쉽게 확인할 수 있게 해주세요.",
      resultSummary: "고객이 완료된 작업 결과를 이슈에서 바로 확인할 수 있습니다.",
      structuredResult: {
        summary: "고객이 완료된 작업 결과와 화면을 이슈에서 바로 확인할 수 있습니다. 주요 흐름도 정상 동작하는지 확인했습니다.",
        outcome: "completed" as const,
        importance: "important" as const,
        urgency: "normal" as const,
        impact: "issue" as const,
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      },
    };
    const markup = renderToStaticMarkup(
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={completedRun}
      />,
    );

    expect(markup).toContain('class="completed-issue-card"');
    expect(markup).toContain("작업 결과");
    expect(markup).toContain(completedRun.structuredResult.summary);
    expect(markup).toContain("증빙 자세히 보기");
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('class="run-result-panel"');
    expect(markup).not.toContain('class="issue-description-markdown"');
  });

  it("shows blocker details at the top of the issue description", () => {
    const blockedRun = {
      ...demoDashboard.runs[0],
      status: "blocked" as const,
      currentAttempt: 2,
      detail: "GitHub 인증이 만료되어 PR을 생성할 수 없습니다.",
      issueDescription: "## 작업 내용\n\nPR을 생성하고 검증합니다.",
      structuredResult: {
        summary: "GitHub 인증이 필요합니다.",
        outcome: "blocked" as const,
        importance: "important" as const,
        urgency: "normal" as const,
        impact: "issue" as const,
        humanActionRequired: true,
        nextAction: "GitHub CLI에 다시 로그인한 뒤 이 이슈를 재시도하세요.",
        dueAt: null,
      },
    };
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={blockedRun}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('class="blocked-issue-card"');
    expect(markup).toContain("작업이 멈춘 이유");
    expect(markup).toContain(blockedRun.structuredResult.summary);
    expect(markup).toContain(blockedRun.detail);
    expect(markup).toContain("다시 진행하려면");
    expect(markup).toContain(blockedRun.structuredResult.nextAction);
    expect(markup).toContain('<details class="blocked-issue-details">');
    expect(markup).toContain("<summary>");
    expect(markup).toContain("자세한 내용 보기");
    expect(markup).not.toContain('<details class="blocked-issue-details" open="">');
    expect(markup.indexOf("blocked-issue-card")).toBeLessThan(
      markup.indexOf("issue-description-markdown"),
    );
    expect(markup).toContain("재시도");
    expect(markup).toContain("작업 취소");
    expect(markup).not.toContain('class="recovery-panel"');
  });
});
