/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { demoDashboard, demoRunEvents } from "../lib/demo-data";
import * as api from "../lib/api";
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
import { ToastProvider } from "./ui/toast";
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
    expect(markup).toContain('class="kanban-card-provider-badge codex"');
  });

  it("shows the source as a card badge without an attachment badge", () => {
    const run = {
      ...demoDashboard.runs[0],
      attachments: [
        {
          id: "attachment-1",
          filename: "screenshot.png",
          contentType: "image/png",
          byteSize: 1_024,
          url: "/attachments/attachment-1",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [run] }}
      />,
    );

    expect(markup).toContain('class="kanban-source"');
    expect(markup).toContain('class="source-dot issue"');
    expect(markup).not.toContain("lucide-paperclip");
    expect(markup).not.toContain("screenshot.png");
    expect(markup).not.toContain("attachment-1");
  });

  it("shows a BadgeCheck review icon on completed issue status pills when result reviews exist", () => {
    const reviewed = {
      ...demoDashboard.runs[0],
      id: "reviewed-completed",
      status: "completed" as const,
      workflowStage: null,
      progress: 100,
      resultSummary: "작업 결과가 준비되었습니다.",
      resultReviews: [
        {
          userId: "reviewer-1",
          name: "민지 김",
          username: "minji",
          image: null,
          completedAt: "2026-08-02T01:00:00.000Z",
        },
      ],
    };
    const unreviewed = {
      ...demoDashboard.runs[0],
      id: "unreviewed-completed",
      status: "completed" as const,
      workflowStage: null,
      progress: 100,
      resultSummary: "아직 검수 전입니다.",
      resultReviews: [],
    };

    const reviewedMarkup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [reviewed] }}
      />,
    );
    const unreviewedMarkup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [unreviewed] }}
      />,
    );

    expect(reviewedMarkup).toContain('class="status-pill emerald reviewed"');
    expect(reviewedMarkup).toContain("lucide-badge-check");
    expect(reviewedMarkup).toContain("status-pill-review-icon");
    expect(reviewedMarkup).toContain("검수 완료됨");
    expect(unreviewedMarkup).toContain('class="status-pill emerald"');
    expect(unreviewedMarkup).not.toContain("status-pill emerald reviewed");
    expect(unreviewedMarkup).not.toContain("lucide-badge-check");
  });

  it("shows the human assignee avatar with the source and priority badges", () => {
    const assignee = demoDashboard.members?.[0];
    if (!assignee) throw new Error("Demo assignee is required");
    const run = {
      ...demoDashboard.runs[0],
      assigneeUserId: assignee.userId,
      priority: 2,
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        agents={[dashboardAgent]}
        dashboard={{ ...demoDashboard, runs: [run] }}
        sessions={[dashboardAgentSession(run)]}
      />,
    );

    const container = document.createElement("div");
    container.innerHTML = markup;
    const card = container.querySelector(".kanban-card");

    expect(card?.classList.contains("has-assignees")).toBe(true);
    expect(card?.classList.contains("has-multiple-assignees")).toBe(false);
    expect(
      card?.querySelector(
        ".kanban-card-badges .kanban-assignee .issue-assignee-avatar",
      ),
    ).not.toBeNull();
    expect(
      card?.querySelector(".kanban-card-badges .kanban-source"),
    ).not.toBeNull();
    expect(
      card?.querySelector(".kanban-card-badges .kanban-priority"),
    ).not.toBeNull();
    expect(
      card?.querySelector(".kanban-card-assignee-badges .kanban-card-person-badge"),
    ).toBeNull();
    expect(
      card?.querySelector(".kanban-card-assignee-badges .kanban-card-agent-badge"),
    ).not.toBeNull();
    expect(markup).toContain('aria-label="담당자: Jay"');
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
    expect(markup).toContain('class="kanban-card-provider-badge codex"');
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
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <ToastProvider>
        <HuntDashboard
          {...dashboardProps}
          dashboard={demoDashboard}
          onDeleteIssue={onDeleteIssue}
        />
      </ToastProvider>,
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
    await act(async () => copyId?.click());
    expect(writeText).toHaveBeenCalledWith(
      `AH-${demoDashboard.runs[0].runNumber}`,
    );
    const toastMessages = () =>
      Array.from(
        document.body.querySelectorAll<HTMLElement>('[data-testid="app-toast"]'),
      ).map((node) => node.textContent ?? "");
    expect(toastMessages().some((text) => text.includes("이슈 ID가 복사되었습니다")))
      .toBe(true);
    await act(async () => copyLink?.click());
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`/open/issues/${demoDashboard.project.id}/`),
    );
    expect(toastMessages().some((text) => text.includes("링크가 복사되었습니다")))
      .toBe(true);
    expect(titlebarActions?.querySelector(".run-page-share-status")).toBeNull();
    expect(title?.nextElementSibling).toBe(titlebarActions);
    expect(titlebarActions?.firstElementChild?.classList).toContain(
      "run-page-property-badges",
    );
    const processNow = titlebarActions?.querySelector<HTMLButtonElement>(
      ".run-page-process-now",
    );
    expect(processNow).not.toBeNull();
    expect(processNow?.textContent).toContain("바로 처리");
    expect(processNow?.disabled).toBe(true);
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

  it("starts a queued issue from the issue detail process-now button", async () => {
    const onProcessIssueNow = vi.fn();
    const queuedRun = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      progress: 0,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      workerId: null,
      requestedWorkerId: null,
      executionReadiness: "ready" as const,
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
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    const processNow = container.querySelector<HTMLButtonElement>(
      ".run-page-titlebar-actions .run-page-process-now",
    );
    expect(processNow).not.toBeNull();
    expect(processNow?.disabled).toBe(false);
    expect(processNow?.textContent).toContain("바로 처리하기");
    await act(async () => processNow?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);

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
    expect(markup).not.toMatch(/<h2[^>]*>작업 큐<\/h2>/);
    expect(markup).toContain("개 작업");
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

  it("orders companion tasks by most recently updated first", () => {
    const base = demoDashboard.runs[0];
    const olderActive = {
      ...base,
      id: "order-older-active",
      runNumber: 101,
      title: "Older active task",
      status: "running" as const,
      updatedAt: "2026-08-01T10:00:00.000Z",
    };
    const newerCompleted = {
      ...base,
      id: "order-newer-completed",
      runNumber: 102,
      title: "Newer completed task",
      status: "completed" as const,
      workflowStage: null,
      progress: 100,
      updatedAt: "2026-08-03T12:00:00.000Z",
      completedAt: "2026-08-03T12:00:00.000Z",
    };
    const middleBlocked = {
      ...base,
      id: "order-middle-blocked",
      runNumber: 103,
      title: "Middle blocked task",
      status: "blocked" as const,
      workflowStage: null,
      updatedAt: "2026-08-02T08:00:00.000Z",
    };

    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={{
          ...demoDashboard,
          // Deliberately not status-first or update-sorted input order.
          runs: [olderActive, newerCompleted, middleBlocked],
        }}
      />,
    );

    const titles = Array.from(
      markup.matchAll(/class="kanban-card-copy"><strong>([^<]*)<\/strong>/g),
    ).map((match) => match[1]);
    expect(titles).toEqual([
      "Newer completed task",
      "Middle blocked task",
      "Older active task",
    ]);
  });

  it("reveals the process dialog shortcut when a queued companion task is swiped left", async () => {
    const onProcessIssueNow = vi.fn();
    const queuedRun = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      workerId: null,
      requestedWorkerId: null,
      executionReadiness: "ready" as const,
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={{ ...demoDashboard, runs: [queuedRun] }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    ));

    const swipeRow = container.querySelector<HTMLElement>(
      ".companion-task-swipe",
    );
    const firePointer = (
      type: string,
      clientX: number,
      clientY: number,
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: clientX },
        clientY: { value: clientY },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        pointerType: { value: "touch" },
      });
      swipeRow?.dispatchEvent(event);
    };

    await act(async () => {
      firePointer("pointerdown", 70, 20);
      firePointer("pointermove", 10, 22);
      firePointer("pointerup", 10, 22);
    });

    const action = container.querySelector<HTMLButtonElement>(
      ".companion-task-swipe-action",
    );
    expect(swipeRow?.className).toContain("open");
    expect(action?.getAttribute("aria-hidden")).toBe("false");
    expect(action?.getAttribute("aria-label")).toBe("바로 처리하기");
    expect(action?.disabled).toBe(false);

    await act(async () => action?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);
    expect(container.querySelector(".run-page")).toBeNull();

    await act(async () => root.unmount());
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
    expect(markup).toContain("담당자");
    expect(markup).not.toContain("라벨");
    expect(markup).toContain('aria-haspopup="listbox" aria-label="프로젝트"');
    expect(markup).toContain('aria-haspopup="listbox" aria-label="상태"');
    expect(markup).toContain("native-select issue-status-select");
    expect(markup).toContain('aria-haspopup="listbox" aria-label="우선순위"');
    expect(markup).toContain("native-select issue-priority-select");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('aria-label="이미지 또는 영상 첨부"');
    expect(markup).toContain('accept="image/*,video/*"');
    expect(markup).toContain("Enter로 등록");
  });

  it("edits an issue title, description, and priority", async () => {
    let updated:
      | {
          title: string;
          description: string | null;
          priority: number | null;
          assigneeUserId?: string | null;
        }
      | undefined;
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EditIssueDialog
          isSubmitting={false}
          members={[
            {
              userId: "user-1",
              name: "Kim",
              email: "kim@example.com",
              image: null,
              role: "member",
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ]}
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
      container
        .querySelector<HTMLButtonElement>(
          ".issue-assignee-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[role="option"][data-value="user-1"]',
        )
        ?.click();
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
      assigneeUserId: "user-1",
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
      version: 2 as const,
      requirements: [],
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "security_review", label: "Security review", required: true },
      ],
      execution: {
        checkpoints: [{
          key: "after-security-review",
          stage: "security_review",
          position: "after" as const,
        }],
      },
      completion: { requiredStages: ["analyzing", "security_review"] },
    };
    const customDashboard = {
      ...demoDashboard,
      settings: {
        ...demoDashboard.settings,
        workflow: customWorkflow,
        checkpointPolicy: undefined,
      },
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
    expect(markup).toContain('draggable="false"');
    expect(markup).toContain('data-kanban-column-id="status:backlog"');
    expect(markup).toContain('aria-label="백로그"');
    expect(markup).toContain('aria-label="차단"');
    expect(markup).toContain('aria-label="실패"');
    expect(markup).toContain('aria-label="취소"');
    expect(markup).toContain("Security review 완료 후 확인");
    expect(markup).toContain('data-checkpoint-count="1"');
  });

  it("marks effective pause checkpoints at their kanban boundaries", () => {
    const workflow = {
      version: 2 as const,
      requirements: [],
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "security_review", label: "Security review", required: true },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["analyzing", "security_review"] },
    };
    const dashboard = {
      ...demoDashboard,
      settings: {
        ...demoDashboard.settings,
        workflow,
        checkpointPolicy: {
          availableBoundaries: [],
          projectMandatory: [{
            key: "project-after-analyzing",
            stage: "analyzing",
            position: "after" as const,
          }],
          userDefaults: [{
            key: "user-before-security-review",
            stage: "security_review",
            position: "before" as const,
          }],
          effective: [
            {
              key: "project-after-analyzing",
              stage: "analyzing",
              position: "after" as const,
            },
            {
              key: "user-before-security-review",
              stage: "security_review",
              position: "before" as const,
            },
          ],
          projectRevision: 1,
          userRevision: 1,
        },
      },
      runs: [],
    };

    const markup = renderToStaticMarkup(
      <HuntDashboard {...dashboardProps} dashboard={dashboard} />,
    );

    expect(markup.match(/class="kanban-checkpoint-marker"/g)).toHaveLength(1);
    expect(markup).toContain('data-checkpoint-count="2"');
    expect(markup).toContain("분석 완료 후 확인");
    expect(markup).toContain("Security review 시작 전 확인");
  });

  it("updates kanban pause markers when checkpoint settings change", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const checkpointPolicy = {
      ...demoDashboard.settings.checkpointPolicy!,
      projectMandatory: [],
      userDefaults: [],
      effective: [],
    };
    const dashboard = {
      ...demoDashboard,
      settings: { ...demoDashboard.settings, checkpointPolicy },
    };

    await act(async () => root.render(
      <HuntDashboard {...dashboardProps} dashboard={dashboard} />,
    ));
    expect(container.querySelector(".kanban-checkpoint-marker")).toBeNull();

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...dashboard,
          settings: {
            ...dashboard.settings,
            checkpointPolicy: {
              ...checkpointPolicy,
              effective: [{
                key: "user-before-implementing",
                stage: "implementing",
                position: "before",
              }],
              userDefaults: [{
                key: "user-before-implementing",
                stage: "implementing",
                position: "before",
              }],
            },
          },
        }}
      />,
    ));
    expect(
      container.querySelector(".kanban-checkpoint-marker")?.getAttribute(
        "aria-label",
      ),
    ).toContain("구현 시작 전 확인");

    await act(async () => root.unmount());
  });

  it("changes issue status when a kanban card is pointer-dragged onto another column", async () => {
    const onMoveRun = vi.fn(async () => undefined);
    const queuedRun = {
      ...demoDashboard.runs[0],
      id: "run-drag-queued",
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
    await act(async () =>
      root.render(
        <HuntDashboard
          {...dashboardProps}
          dashboard={{ ...demoDashboard, runs: [queuedRun] }}
          onMoveRun={onMoveRun}
        />,
      ),
    );

    const card = container.querySelector<HTMLElement>(".kanban-card");
    const backlogColumn = container.querySelector<HTMLElement>(
      '[aria-label="백로그"]',
    );
    expect(card?.getAttribute("draggable")).toBe("false");
    expect(backlogColumn).not.toBeNull();

    const firePointer = (
      target: EventTarget | null,
      type: string,
      clientX: number,
      clientY: number,
    ) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: clientX },
        clientY: { value: clientY },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        pointerType: { value: "mouse" },
      });
      target?.dispatchEvent(event);
      return event;
    };

    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => backlogColumn),
    });
    await act(async () => {
      firePointer(card, "pointerdown", 120, 120);
      firePointer(card, "pointermove", 140, 120);
    });
    expect(card?.className).toContain("dragging");
    expect(
      document.body.querySelector(".kanban-card-drag-preview"),
    ).not.toBeNull();

    await act(async () => {
      firePointer(card, "pointermove", 160, 120);
    });
    expect(
      container.querySelector('[aria-label="백로그"]')?.className,
    ).toContain("drag-over");

    await act(async () => {
      firePointer(card, "pointerup", 160, 120);
    });
    if (originalElementFromPoint) {
      Object.defineProperty(
        document,
        "elementFromPoint",
        originalElementFromPoint,
      );
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }

    expect(onMoveRun).toHaveBeenCalledWith(queuedRun.id, {
      status: "backlog",
      workflowStage: null,
    });
    expect(document.body.querySelector(".kanban-card-drag-preview")).toBeNull();

    // Drop should not open the issue detail page.
    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.click();
    });
    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows recovery errors from failed status moves on the board", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <HuntDashboard
          {...dashboardProps}
          dashboard={demoDashboard}
          recoveryError="상태 이동에 실패했습니다."
        />,
      ),
    );

    expect(container.querySelector(".error-banner")?.textContent).toContain(
      "상태 이동에 실패했습니다.",
    );

    await act(async () => root.unmount());
    container.remove();
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
    const workflowProgress = container.querySelector(".issue-workflow-progress");
    expect(workflowProgress?.querySelector("ol")?.getAttribute("aria-label")).toBe(
      "전체 진행률",
    );
    const workflowStages = workflowProgress?.querySelectorAll("li") ?? [];
    expect(workflowStages).toHaveLength(demoDashboard.runs[0].workflow.stages.length);
    expect(workflowStages[0]?.getAttribute("data-state")).toBe("complete");
    expect(workflowStages[1]?.getAttribute("data-state")).toBe("active");
    expect(workflowStages[1]?.getAttribute("aria-current")).toBe("step");
    expect(workflowStages[2]?.getAttribute("data-state")).toBe("upcoming");
    expect(workflowStages[0]?.getAttribute("aria-label")).toContain("완료");
    expect(workflowStages[1]?.getAttribute("aria-label")).toContain("진행 중");
    expect(workflowStages[2]?.getAttribute("aria-label")).toContain("대기");
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

  it("marks an open issue viewed again when its inbox version changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onIssueViewed = vi.fn();
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onIssueViewed={onIssueViewed}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    const viewedRun = demoDashboard.runs[0];
    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    const callsAfterOpening = onIssueViewed.mock.calls.length;

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs: demoDashboard.runs.map((run) =>
            run.id === viewedRun.id
              ? {
                  ...run,
                  eventCount: run.eventCount + 1,
                  lastEventAt: "2026-08-06T03:00:00.000Z",
                }
              : run,
          ),
        }}
        onIssueViewed={onIssueViewed}
      />,
    ));

    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    expect(onIssueViewed).toHaveBeenCalledTimes(callsAfterOpening + 1);

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

  it("refreshes status history when the open issue records a new event", async () => {
    const run = demoDashboard.runs[0];
    const events = demoRunEvents[run.id];
    const queuedEvent = events.at(-1)!;
    const onLoadRunEvents = vi
      .fn<() => Promise<typeof events>>()
      .mockResolvedValueOnce([queuedEvent])
      .mockResolvedValueOnce(events);
    const initialDashboard = {
      ...demoDashboard,
      runs: [{ ...run, eventCount: 1 }, ...demoDashboard.runs.slice(1)],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={initialDashboard}
        onLoadRunEvents={onLoadRunEvents}
        requestedRunId={run.id}
      />,
    ));
    expect(onLoadRunEvents).toHaveBeenCalledTimes(1);
    const statusHistoryTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent === "상태");
    await act(async () => statusHistoryTab?.click());
    expect(
      container.querySelectorAll(".issue-status-history-panel .timeline-event"),
    ).toHaveLength(1);

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onLoadRunEvents={onLoadRunEvents}
        requestedRunId={run.id}
      />,
    ));
    expect(onLoadRunEvents).toHaveBeenCalledTimes(2);
    expect(
      container.querySelectorAll(".issue-status-history-panel .timeline-event"),
    ).toHaveLength(events.length);

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

  it("offers full-page navigation when issue details are shown in a side panel", async () => {
    const onOpenFullPage = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
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
        onOpenFullPage={onOpenFullPage}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={demoDashboard.runs[0]}
      />,
    ));

    const openFullPage = container.querySelector<HTMLButtonElement>(
      ".run-page-open-full-page",
    );
    expect(openFullPage?.getAttribute("aria-label")).toBe(
      "전체 페이지에서 열기",
    );
    await act(async () => openFullPage?.click());
    expect(onOpenFullPage).toHaveBeenCalledTimes(1);

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
    expect(tabs).toHaveLength(6);
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

  it("shows durable Worker provider output in the issue work log tab", async () => {
    const run: HuntRun = {
      ...demoDashboard.runs[0],
      status: "completed",
      workerId: "worker-1",
    };
    const loadTranscript = vi
      .spyOn(api, "loadProjectAgentTranscript")
      .mockResolvedValue({
        session: {
          sessionId: `detached-${run.id}`,
          runId: run.id,
          workerId: "worker-1",
          agentProvider: "codex",
          startedAt: "2026-08-03T12:00:00.000Z",
          lastEventAt: "2026-08-03T12:00:01.000Z",
          eventCount: 1,
        },
        events: [{
          sequence: 1,
          direction: "server",
          message: {
            type: "item.completed",
            item: {
              id: "message-1",
              type: "agent_message",
              phase: "final_answer",
              text: "저장소 구조를 확인하고 있습니다.",
            },
          },
          recordedAt: "2026-08-03T12:00:01.000Z",
        }],
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
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          projectId={demoDashboard.project.id}
          run={run}
          token="session-token"
        />,
      );
      await Promise.resolve();
    });

    const activityTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "작업 로그");
    await act(async () => activityTab?.click());

    expect(loadTranscript).toHaveBeenCalledWith(
      "session-token",
      demoDashboard.project.id,
      `detached-${run.id}`,
      0,
    );
    expect(container.querySelector(".issue-agent-activity-panel")?.textContent)
      .toContain("저장소 구조를 확인하고 있습니다.");
    expect(container.querySelector(".issue-agent-activity-panel")?.textContent)
      .toContain("Codex");
    const messageHeader = container.querySelector(
      ".issue-agent-activity-panel .auto-hunt-agent-message > header",
    );
    expect(messageHeader?.querySelector("strong")?.textContent).toBe("Codex");
    expect(messageHeader?.querySelector("svg")).not.toBeNull();
    expect(messageHeader?.textContent).not.toContain("최종 메시지");

    await act(async () => root.unmount());
    loadTranscript.mockRestore();
    container.remove();
  });

  it("shows editable prerequisite and follow-up relationships in issue properties", async () => {
    const prerequisite = demoDashboard.runs[1];
    const dependent = demoDashboard.runs[0];
    const addDependency = vi.fn(async () => undefined);
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
          onAddDependency={addDependency}
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

    await act(async () => {
      dependencies?.querySelector<HTMLButtonElement>(
        ".issue-dependency-add-button",
      )?.click();
    });
    const picker = document.querySelector('[role="dialog"]');
    expect(picker?.textContent).toContain("선행 이슈 추가");
    expect(picker?.querySelector('[aria-label="이슈 검색"]')).not.toBeNull();
    const candidateButton = picker?.querySelector<HTMLButtonElement>(
      ".issue-dependency-picker-item",
    );
    expect(candidateButton).not.toBeNull();
    await act(async () => candidateButton?.click());
    expect(addDependency).toHaveBeenCalledWith(
      expect.not.stringMatching(prerequisite.id),
    );
    await act(async () => {
      Array.from(picker?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.trim() === "닫기")
        ?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

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
    const enlargeButton = container.querySelector<HTMLButtonElement>(
      '.run-result-screenshots [aria-label="finished-dashboard.png 크게 보기"]',
    );
    expect(enlargeButton).not.toBeNull();
    expect(
      container.querySelector(".run-result-screenshots .run-evidence-image a"),
    ).toBeNull();

    await act(async () => enlargeButton?.click());

    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src"))
      .toBe("blob:result-screenshot");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "finished-dashboard.png",
    );

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click();
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();

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

  it("keeps attachment images loaded when the run snapshot refreshes", async () => {
    const createObjectUrl = vi.fn((blob: Blob) =>
      `blob:issue-attachment-${blob.size}`
    );
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    const attachments = [
      {
        id: "attachment-inline",
        filename: "inline.png",
        contentType: "image/png",
        byteSize: 6,
        url: "/attachments/attachment-inline",
      },
      {
        id: "attachment-gallery",
        filename: "gallery.png",
        contentType: "image/png",
        byteSize: 7,
        url: "/attachments/attachment-gallery",
      },
    ];
    const onLoadAttachment = vi.fn(
      async (attachment: typeof attachments[number]) =>
        new Blob([attachment.filename], { type: attachment.contentType }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (nextAttachments = attachments) => (
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={onLoadAttachment}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={{
          ...demoDashboard.runs[0],
          issueDescription:
            "![inline](briar-attachment://attachment-inline)",
          attachments: nextAttachments,
        }}
      />
    );

    await act(async () => root.render(renderPage()));
    expect(onLoadAttachment).toHaveBeenCalledTimes(2);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.render(renderPage(attachments.map((attachment) => ({
        ...attachment,
      }))));
    });

    expect(onLoadAttachment).toHaveBeenCalledTimes(2);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll(".issue-description-scroll img"),
    ).toHaveLength(2);

    await act(async () => {
      root.render(renderPage(attachments.map((attachment) => ({
        ...attachment,
        url: attachment.id === "attachment-inline"
          ? "/attachments/attachment-inline-v2"
          : attachment.url,
      }))));
    });

    expect(onLoadAttachment).toHaveBeenCalledTimes(3);
    expect(createObjectUrl).toHaveBeenCalledTimes(3);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });

  it("scrolls the conversation to the bottom after loading and sending", async () => {
    const createdAt = new Date().toISOString();
    const loadedMessage: IssueMessage = {
      id: "message-loaded",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "## 기존 메시지\n\n- 마크다운 항목",
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
    expect(messageList.querySelector(".issue-message-body h2")?.textContent).toBe(
      "기존 메시지",
    );
    expect(messageList.querySelector(".issue-message-body li")?.textContent).toBe(
      "마크다운 항목",
    );

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

  it("pastes an image into the issue conversation and sends it without text", async () => {
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const sentMessage: IssueMessage = {
      id: "message-with-image",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "![clipboard.png](briar-attachment://stored-image)",
      attachments: [{
        id: "stored-image",
        filename: image.name,
        contentType: image.type,
        byteSize: image.size,
        url: "blob:stored-image",
      }],
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    const onSendIssueMessage = vi.fn(async () => ({
      message: sentMessage,
      agentReply: null,
    }));
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
          onLoadAttachment={async () => image}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={onSendIssueMessage}
          run={demoDashboard.runs[0]}
        />,
      );
      await Promise.resolve();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-conversation > .issue-message-composer textarea",
    );
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [image],
        items: [{ kind: "file", getAsFile: () => image }],
        types: ["Files"],
      },
    });
    await act(async () => textarea?.dispatchEvent(paste));
    expect(container.querySelector(".issue-composer-attachment")?.textContent)
      .toContain("clipboard.png");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".issue-conversation > .issue-message-composer .issue-message-send",
      )?.click();
      await Promise.resolve();
    });
    expect(onSendIssueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [image],
        body: expect.stringContaining("briar-attachment://"),
      }),
    );
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows replies at the same level and writes a reply below its message", async () => {
    const createdAt = "2026-08-03T10:00:00.000Z";
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "원문 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "기존 답글",
      replyCount: 0,
      createdAt: "2026-08-03T10:01:00.000Z",
      updatedAt: "2026-08-03T10:01:00.000Z",
    };
    const sentReply: IssueMessage = {
      ...reply,
      id: "message-new-reply",
      body: "새 답글",
      createdAt: "2026-08-03T10:02:00.000Z",
      updatedAt: "2026-08-03T10:02:00.000Z",
    };
    const agentReply: IssueMessage = {
      ...sentReply,
      id: "message-agent-reply",
      body: "대댓글에서 답변합니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      createdAt: "2026-08-03T10:03:00.000Z",
      updatedAt: "2026-08-03T10:03:00.000Z",
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

    const messageGroups = Array.from(
      container.querySelectorAll<HTMLElement>(".issue-message-group"),
    );
    expect(messageGroups).toHaveLength(2);
    expect(container.querySelector(".issue-message-replies")).toBeNull();
    expect(container.querySelector(".issue-thread-drawer")).toBeNull();
    expect(container.querySelector(".issue-thread-summary")).toBeNull();
    const replyGroup = messageGroups[1];
    expect(replyGroup.querySelector(".issue-message-parent-quote")?.textContent)
      .toContain("원문 메시지");
    expect(replyGroup.textContent).toContain("기존 답글");

    const messageGroup = messageGroups[0];
    const replyButton = messageGroup.querySelector<HTMLButtonElement>(
      ".issue-reply-trigger",
    );
    expect(replyButton?.getAttribute("title")).toBe("답글 작성");
    expect(replyButton?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => replyButton?.click());
    expect(replyButton?.getAttribute("aria-expanded")).toBe("true");

    const replyComposer = messageGroup.querySelector<HTMLElement>(
      ".issue-inline-reply-composer .issue-message-composer",
    );
    const replyTextarea = replyComposer?.querySelector<HTMLTextAreaElement>(
      "textarea",
    );
    expect(replyComposer?.querySelector(".issue-composer-formatting")).toBeNull();
    expect(replyComposer?.querySelector(".issue-composer-link")).not.toBeNull();
    expect(replyComposer?.querySelectorAll("footer button")).toHaveLength(2);
    expect(replyTextarea?.placeholder).toBe("답장 남기기…");

    const messageList = container.querySelector<HTMLElement>(
      ".issue-message-list",
    );
    if (!messageList) throw new Error("message list was not rendered");
    Object.defineProperty(messageList, "scrollHeight", {
      configurable: true,
      value: 480,
    });
    await act(async () => {
      if (!replyTextarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(replyTextarea, sentReply.body);
      replyTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    messageList.scrollTop = 0;
    await act(async () => {
      replyTextarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(messageList.scrollTop).toBe(480);
    expect(
      messageGroup.querySelector(":scope > .issue-agent-reply-state")?.textContent,
    ).toContain("Briar가 답변을 작성하고 있습니다");
    expect(messageList.textContent).toContain(sentReply.body);
    expect(
      Array.from(
        container.querySelectorAll(".issue-message-parent-quote"),
      ).some((quote) => quote.textContent?.includes("원문 메시지")),
    ).toBe(true);

    await act(async () => {
      resolveAgentReply(agentReply);
      await pendingAgentReply;
    });
    expect(messageList.textContent).toContain(agentReply.body);
    expect(
      messageGroup.querySelector(":scope > .issue-agent-reply-state"),
    ).toBeNull();

    await act(async () => replyButton?.click());
    expect(messageGroup.querySelector(".issue-inline-reply-composer")).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders replies flat and sends a reply to any message", async () => {
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "원문 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 1,
      createdAt: "2026-08-03T10:00:00.000Z",
      updatedAt: "2026-08-03T10:00:00.000Z",
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "기존 답글",
      replyCount: 1,
      createdAt: "2026-08-03T10:01:00.000Z",
      updatedAt: "2026-08-03T10:01:00.000Z",
    };
    const nestedReply: IssueMessage = {
      ...rootMessage,
      id: "message-nested-reply",
      parentMessageId: reply.id,
      body: "기존 대댓글",
      replyCount: 0,
      createdAt: "2026-08-03T10:02:00.000Z",
      updatedAt: "2026-08-03T10:02:00.000Z",
    };
    let sentParentId: string | null | undefined;
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
          onLoadIssueMessages={async () => [rootMessage, reply, nestedReply]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async (input) => {
            sentParentId = input.parentMessageId;
            return { message: nestedReply, agentReply: null };
          }}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const groupByBody = (body: string) =>
      Array.from(
        container.querySelectorAll<HTMLElement>(".issue-message-group"),
      ).find((group) =>
        group
          .querySelector(":scope > .issue-message > div > .issue-message-body")
          ?.textContent?.includes(body),
      );
    const replyGroup = groupByBody("기존 답글");
    const nestedGroup = groupByBody("기존 대댓글");
    expect(container.querySelectorAll(".issue-message-group")).toHaveLength(3);
    expect(container.querySelector(".issue-message-replies")).toBeNull();
    expect(replyGroup).not.toBeUndefined();
    expect(nestedGroup).not.toBeUndefined();
    expect(replyGroup?.querySelector(".issue-message-parent-quote")?.textContent)
      .toContain("원문 메시지");
    expect(
      nestedGroup?.querySelector(".issue-message-parent-quote")?.textContent,
    ).toContain("기존 답글");

    const nestedReplyButton = nestedGroup?.querySelector<HTMLButtonElement>(
      ".issue-reply-trigger",
    );
    expect(nestedReplyButton?.getAttribute("title")).toBe("답글 작성");
    await act(async () => nestedReplyButton?.click());
    const nestedComposer = nestedGroup?.querySelector<HTMLElement>(
      ".issue-inline-reply-composer .issue-message-composer textarea",
    ) as HTMLTextAreaElement | null;
    expect(nestedComposer?.placeholder).toBe("답장 남기기…");

    await act(async () => {
      if (!nestedComposer) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(nestedComposer, "대댓글에 이어서");
      nestedComposer.dispatchEvent(new Event("input", { bubbles: true }));
      nestedComposer.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(sentParentId).toBe(nestedReply.id);
    await act(async () => root.unmount());
    container.remove();
  });

  it("inserts @briar and places the provider reply below its comment", async () => {
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
    const userMessageGroup = Array.from(
      container.querySelectorAll<HTMLElement>(".issue-message-group"),
    ).find((group) => group.textContent?.includes(userMessage.body));
    expect(
      userMessageGroup?.querySelector(":scope > .issue-agent-reply-state"),
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
    ).toContain(agentMessage.body);
    expect(
      container.querySelector(
        '.issue-message-list .issue-message-avatar.agent[aria-label="Briar · Codex"]',
      ),
    ).not.toBeNull();
    expect(
      Array.from(
        container.querySelectorAll(".issue-message-parent-quote"),
      ).some((quote) => quote.textContent?.includes(userMessage.body)),
    ).toBe(true);
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

  it("shows a concise paused checkpoint summary in the result tab", () => {
    const pausedRun = {
      ...demoDashboard.runs[1],
      status: "paused" as const,
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
          run={pausedRun}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain(
      'class="completed-issue-card paused-result-card"',
    );
    expect(markup).toContain("검토 대기");
    expect(markup).toContain("부분 작업 결과");
    expect(markup).toContain("작업 상세 패널을 결과 중심 구조로 정리했습니다");
    expect(markup).toContain("컴포넌트 회귀 테스트와 로컬 빌드를 통과했습니다");
    expect(markup).toContain("검토 전 작업");
    expect(markup).toContain("작업 결과");
    expect(markup).toContain("리비전 1");
    expect(markup).toContain('<div class="completed-issue-summary paused-result-summary"><h2>구현</h2>');
    expect(markup.match(/<li>/g)).toHaveLength(3);
    expect(markup).toContain("승인하고 계속");
    expect(markup).toContain("증빙 자세히 보기");
    expect(markup).toContain('class="run-page-property-badge amber"');
    expect(markup).toContain('class="run-result-panel"');
    expect(markup).not.toContain('class="recovery-panel paused"');
    expect(markup).not.toContain('class="issue-description-markdown"');
  });

  it("shows the work completed before a paused review in chronological order", async () => {
    const pausedRun = {
      ...demoDashboard.runs[1],
      status: "paused" as const,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TooltipProvider>
          <RunPage
            isSidebarOpen
            error={null}
            isRecovering={false}
            onBack={() => undefined}
            onCancel={async () => undefined}
            onLoadAttachment={async () => new Blob()}
            onLoadIssueMessages={async () => []}
            onLoadRunEvents={async () => demoRunEvents[pausedRun.id] ?? []}
            onLoadRunEvidence={async () => []}
            onMove={async () => undefined}
            onRetry={async () => undefined}
            onSendIssueMessage={async () => {
              throw new Error("not implemented in this test");
            }}
            run={pausedRun}
          />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    const reviewWork = container.querySelector(".paused-review-work");
    expect(reviewWork?.textContent).toContain("상세 패널 구현");
    expect(reviewWork?.textContent).toContain("로컬 검증 실행");
    expect(reviewWork?.textContent).toContain("기록 2개");
    expect(reviewWork?.textContent?.indexOf("상세 패널 구현")).toBeLessThan(
      reviewWork?.textContent?.indexOf("로컬 검증 실행") ?? -1,
    );
    expect(container.querySelector(".paused-review-result")?.textContent).toContain(
      "컴포넌트 회귀 테스트와 로컬 빌드를 통과했습니다",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the resume button spinning until the paused run actually resumes", async () => {
    const onResume = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
            onResume={onResume}
            onRetry={async () => undefined}
            onSendIssueMessage={async () => {
              throw new Error("not implemented in this test");
            }}
            run={{ ...demoDashboard.runs[1], status: "paused" as const }}
          />
        </TooltipProvider>,
      );
    });

    const resumeButton = container.querySelector<HTMLButtonElement>(
      ".paused-result-resume",
    );
    expect(resumeButton?.disabled).toBe(false);
    expect(resumeButton?.querySelector(".spin")).toBeNull();

    await act(async () => {
      resumeButton?.click();
      await Promise.resolve();
    });

    expect(onResume).toHaveBeenCalledOnce();
    expect(resumeButton?.disabled).toBe(true);
    expect(resumeButton?.querySelector(".spin")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("submits paused review feedback as an explicit rework request", async () => {
    const onRework = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onRework={onRework}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{ ...demoDashboard.runs[1], status: "paused" as const }}
        />
      </TooltipProvider>,
    ));

    const openButton = container.querySelector<HTMLButtonElement>(
      ".paused-result-rework",
    );
    expect(openButton?.textContent).toContain("수정 요청");
    await act(async () => openButton?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".paused-rework-form textarea",
    );
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "결과 요약을 더 짧게 만들고 모바일 화면도 다시 확인해 주세요.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = container.querySelector<HTMLFormElement>(".paused-rework-form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(onRework).toHaveBeenCalledWith({
      workflowStage: "local_qa",
      reason: "결과 요약을 더 짧게 만들고 모바일 화면도 다시 확인해 주세요.",
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("requires the user to accept an @briar rework proposal before revision", async () => {
    const proposalId = "abababab-abab-4bab-8bab-abababababab";
    const message: IssueMessage = {
      id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      runId: demoDashboard.runs[1].id,
      parentMessageId: null,
      body: "D를 D′로 바꾸는 개정을 제안했습니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      replyCount: 0,
      proposedAction: {
        id: proposalId,
        type: "request_issue_rework",
        workflowStage: "local_qa",
        reason: "D를 D′로 변경하고 영향받는 QA를 다시 확인합니다.",
        status: "pending",
        acceptedAt: null,
        appliedRevision: null,
      },
      createdAt: "2026-08-05T01:00:00.000Z",
      updatedAt: "2026-08-05T01:00:00.000Z",
    };
    const onAccept = vi.fn(async () => ({
      ...message.proposedAction!,
      status: "accepted" as const,
      acceptedAt: "2026-08-05T01:01:00.000Z",
      appliedRevision: 2,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          onAcceptIssueReworkProposal={onAccept}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [message]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{ ...demoDashboard.runs[1], status: "completed" as const }}
        />
      </TooltipProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    const acceptButton = container.querySelector<HTMLButtonElement>(
      ".issue-rework-proposal-accept",
    );
    expect(acceptButton?.textContent).toContain("수락하고 개정 시작");
    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      acceptButton?.click();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledWith(proposalId);
    expect(container.textContent).toContain("리비전 2 개정이 시작되었습니다.");

    await act(async () => root.unmount());
    container.remove();
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
        summary:
          "## 변경 결과\n\n- **결과 요약**을 이슈에서 바로 확인할 수 있습니다.\n- 주요 흐름을 검증했습니다.\n\n<script>alert('unsafe')</script>",
        outcome: "completed" as const,
        importance: "important" as const,
        urgency: "normal" as const,
        impact: "issue" as const,
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      },
      executionMetrics: {
        inputTokens: 1_000,
        outputTokens: 250,
        cacheReadTokens: 800,
        cacheWriteTokens: null,
        reasoningOutputTokens: 100,
        totalTokens: 1_250,
        durationMs: 90_000,
      },
      preferredProvider: null,
      preferredModel: null,
      requestedProvider: "grok" as const,
      requestedModel: "grok-4.5",
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
    expect(markup).toContain('class="completed-issue-summary"');
    expect(markup).toContain("<h2>변경 결과</h2>");
    expect(markup).toContain("<ul>");
    expect(markup).toContain("<strong>결과 요약</strong>");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("unsafe");
    expect(markup).toContain("증빙 자세히 보기");
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('class="run-result-panel"');
    expect(markup).toContain('class="run-result-metrics"');
    expect(markup).toContain("소요 시간");
    expect(markup).toContain("1m 30s");
    expect(markup).toContain("프로바이더");
    expect(markup).toContain("Grok");
    expect(markup).toContain("모델");
    expect(markup).toContain("grok-4.5");
    expect(markup).toContain("전체 토큰");
    expect(markup).toContain("1,250");
    expect(markup).toContain("캐시");
    expect(markup).toContain("추론");
    expect(markup).not.toContain('class="issue-description-markdown"');
  });

  it("prefers issue preferred provider/model over requested values in result metrics", () => {
    const completedRun = {
      ...demoDashboard.runs[0],
      status: "completed" as const,
      resultSummary: "프로바이더 우선순위를 검증합니다.",
      executionMetrics: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningOutputTokens: null,
        totalTokens: 15,
        durationMs: 12_000,
      },
      preferredProvider: "claude" as const,
      preferredModel: "opus",
      requestedProvider: "grok" as const,
      requestedModel: "grok-4.5",
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

    expect(markup).toContain("프로바이더");
    expect(markup).toContain("Claude");
    expect(markup).toContain("모델");
    expect(markup).toContain("Claude Opus");
    expect(markup).not.toContain("Grok");
    expect(markup).not.toContain("grok-4.5");
  });

  it("shows result reviewers in the result and properties panels and records the current member", async () => {
    const onCompleteResultReview = vi.fn(async () => undefined);
    const completedRun = {
      ...demoDashboard.runs[0],
      status: "completed" as const,
      resultSummary: "검수할 작업 결과입니다.",
      resultReviews: [
        {
          userId: "reviewer-1",
          name: "민지 김",
          username: "minji",
          image: "https://example.com/minji.png",
          completedAt: "2026-08-02T01:00:00.000Z",
        },
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          currentUserId="reviewer-2"
          error={null}
          isRecovering={false}
          isSidebarOpen
          onBack={() => undefined}
          onCancel={async () => undefined}
          onCompleteResultReview={onCompleteResultReview}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={completedRun}
        />
      </TooltipProvider>,
    ));

    expect(container.querySelector(".run-result-review")?.textContent).toContain(
      "@minji",
    );
    expect(
      container.querySelector(".completed-issue-card-heading .status-pill.reviewed"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".completed-issue-card-heading .status-pill-review-icon",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".run-page-property-badge.reviewed"),
    ).not.toBeNull();
    const reviewButton = container.querySelector<HTMLButtonElement>(
      ".run-result-review-complete",
    );
    expect(reviewButton?.textContent).toContain("검수 완료");
    await act(async () => reviewButton?.click());
    expect(onCompleteResultReview).toHaveBeenCalledOnce();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(
        ".run-page-properties-toggle",
      )?.click()
    );
    const reviewProperty = container.querySelector(
      ".run-result-review-property",
    );
    expect(reviewProperty?.getAttribute("aria-label")).toContain("@minji");
    expect(reviewProperty?.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/minji.png",
    );

    await act(async () => root.unmount());
    container.remove();
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
