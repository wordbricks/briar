/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../../../test/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "@/hooks/useAutoHuntSessions";
import { demoDashboard, demoRunEvents } from "@/lib/demo-data";
import * as api from "@/lib/api";
import * as channelRealtime from "@/lib/channel-realtime";
import * as issueActivityHook from "@/hooks/use-issue-agent-activity";
import type { ExecutionWorker, HuntRun, IssueMessage, IssueMessageSendResult, ProjectAgent, RunEvidence, UpdateIssueInput } from "@/types";
import { CreateIssueDialog, EditIssueDialog, HuntDashboard, IssueAgentActivityPanel, RunPage, runMatchesIssuePropertyFilters, type IssuePropertyFilters } from "@/components/HuntDashboard";
import { createIssueDraftStorageKey } from "@/lib/create-issue-draft";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  }
};
const dashboardAgent: ProjectAgent = {
  id: "agent-1",
  projectId: demoDashboard.project.id,
  name: "Briar Agent",
  avatar: "data:image/png;base64,avatar",
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Process issues",
  skill: "# Agent",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z"
};
const issueMentionAgent: ProjectAgent = {
  ...dashboardAgent,
  id: "agent-mention-1",
  name: "Developer"
};
const dashboardWorker: ExecutionWorker = {
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "user-1",
  label: "Lemon Worker",
  icon: {
    type: "emoji",
    value: "🍋"
  },
  agentProvider: "codex",
  providers: ["codex"],
  versions: {
    briar: "1.2.25"
  },
  state: "online",
  readiness: "busy",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 1,
  availableSessions: 0,
  lastHeartbeatAt: "2026-07-29T00:00:00.000Z",
  createdAt: "2026-07-29T00:00:00.000Z"
};
function dashboardAgentSession(run: HuntRun, status: AutoHuntSession["status"] = "running"): AutoHuntSession {
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
      summary: null
    }],
    startedAt: "2026-07-29T00:00:00.000Z",
    completedAt: status === "running" ? null : "2026-07-29T00:10:00.000Z",
    conversationId: null,
    workspaceRoot: null,
    summary: null,
    error: null,
    events: [],
    dispatchEvents: [],
    workers: []
  };
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function pendingAgentReplyState(scope: ParentNode | null | undefined) {
  return scope?.querySelector<HTMLElement>(":scope > .issue-agent-reply-state");
}
function expectPendingAgentReplyLoader(scope: ParentNode | null | undefined) {
  const pending = pendingAgentReplyState(scope);
  const loader = pending?.querySelector<HTMLElement>("[data-testid='loading-state']");
  expect(loader).not.toBeNull();
  expect(loader?.dataset.variant).toBe("Drive");
  expect(loader?.dataset.size).toBe("compact");
  expect(pending?.textContent).toContain("에이전트가 답변을 작성하고 있습니다");
  expect(pending?.textContent).toContain("0.0s");
  expect(pending?.querySelector(".spin")).toBeNull();
  return pending;
}
describe("HuntBoard", () => {
  it("shows accessible difficulty icons in Kanban and list cards", async () => {
    const runs = (["easy", "normal", "hard"] as const).map((difficulty, index) => ({
      ...demoDashboard.runs[index]!,
      difficulty
    }));
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs,
        }}
      />,
    );
    expect(Array.from(container.querySelectorAll<HTMLElement>(".kanban-card [data-difficulty]")).map(icon => icon.dataset.difficulty).sort()).toEqual(["easy", "hard", "normal"]);
    expect(container.querySelector('[data-difficulty="easy"]')?.getAttribute("aria-label")).toBe("난이도: 쉬움");
    expect(container.querySelector('[data-difficulty="normal"]')?.getAttribute("title")).toBe("난이도: 보통");
    expect(container.querySelector('[data-difficulty="hard"]')?.getAttribute("aria-label")).toBe("난이도: 어려움");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="리스트 보기"]')?.click());
    expect(container.querySelectorAll(".issue-list-task [data-difficulty]")).toHaveLength(3);
    await cleanup();
  });
  it.each(["issue", "feedback", "error"] as const)("shows the assignee avatar immediately after the %s source label", async source => {
    const member = demoDashboard.members![0]!;
    const run = {
      ...demoDashboard.runs[0],
      assigneeUserId: member.userId,
      source
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs: [run],
        }}
      />,
    );
    const sourceLabel = container.querySelector(".kanban-source");
    const assigneeAvatar = container.querySelector(".kanban-assignee");
    expect(sourceLabel?.nextElementSibling).toBe(assigneeAvatar);
    expect(assigneeAvatar?.getAttribute("aria-label")).toBe(`담당자: ${member.name}`);
    await cleanup();
  });
  it("filters the visible issues from the property menu", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={demoDashboard} />);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="프로퍼티 필터"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0
      }));
    });
    const statusFilter = Array.from(document.body.querySelectorAll<HTMLElement>(".issue-property-filter-item")).find(item => item.textContent?.includes("상태"));
    expect(statusFilter).toBeTruthy();
    await act(async () => statusFilter?.click());
    const completedFilter = Array.from(document.body.querySelectorAll<HTMLElement>(".issue-property-filter-choice")).find(item => item.textContent?.includes("완료"));
    expect(completedFilter).toBeTruthy();
    await act(async () => completedFilter?.click());
    expect(container.querySelectorAll(".kanban-card")).toHaveLength(1);
    expect(container.textContent).toContain("D1 작업 이벤트 스키마 추가");
    expect(trigger?.textContent).toContain("1");
    await cleanup();
  });
  it("combines issue property filters while allowing multiple values per property", () => {
    const runningIssue = {
      ...demoDashboard.runs[0],
      agentId: "agent-1",
      assigneeUserId: "member-1",
      createdByUserId: "creator-1",
      priority: 1,
      source: "issue" as const,
      status: "running" as const
    };
    const unassignedFeedback = {
      ...demoDashboard.runs[1],
      agentId: null,
      assigneeUserId: null,
      createdByUserId: "creator-1",
      priority: null,
      source: "feedback" as const,
      status: "paused" as const
    };
    const filters: IssuePropertyFilters = {
      status: ["running", "paused"],
      source: ["issue", "feedback"],
      priority: ["1"],
      assignee: ["member-1"],
      agent: ["agent-1"],
      creator: ["creator-1"]
    };
    expect(runMatchesIssuePropertyFilters(runningIssue, filters)).toBe(true);
    expect(runMatchesIssuePropertyFilters(unassignedFeedback, filters)).toBe(false);
    expect(runMatchesIssuePropertyFilters(unassignedFeedback, {
      status: ["paused"],
      source: [],
      priority: ["__unset__"],
      assignee: ["__unset__"],
      agent: ["__unset__"],
      creator: []
    })).toBe(true);
  });
  it("opens issue creation with Command-N", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={demoDashboard} />);
    expect(container.querySelector('[aria-keyshortcuts="Meta+N"]')).not.toBeNull();
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyN",
      key: "n",
      metaKey: true
    });
    await act(async () => {
      window.dispatchEvent(shortcut);
    });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(container.querySelector('[aria-label="새 이슈"]')).not.toBeNull();
    await cleanup();
  });
  it("does not capture Command-N without a project", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={null} noProject />);
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
    expect(shortcut.defaultPrevented).toBe(false);
    expect(container.querySelector('[aria-label="새 이슈"]')).toBeNull();
    await cleanup();
  });
  it("adds a bottom drop space and opens issue creation for a kanban column", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={demoDashboard} />);
    const implementingColumn = container.querySelector<HTMLElement>('[data-kanban-column-id="stage:implementing"]');
    const addButton = implementingColumn?.querySelector<HTMLButtonElement>("[data-kanban-column-add]");
    expect(implementingColumn?.querySelector(".kanban-column-content")).not.toBeNull();
    expect(addButton?.getAttribute("aria-label")).toBe("구현에 이슈 추가");
    await act(async () => addButton?.click());
    expect(container.querySelector('[role="dialog"][aria-label="새 이슈"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".issue-dialog-close")?.click());
    await cleanup();
  });
  it("moves a newly created issue to the column that opened its add action", async () => {
    window.localStorage.removeItem(createIssueDraftStorageKey);
    const onCreateIssue = vi.fn(async () => ({
      runId: "created-from-kanban"
    }));
    const onMoveRun = vi.fn(async () => undefined);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onCreateIssue={onCreateIssue}
        onMoveRun={onMoveRun}
      />,
    );
    const addButton = container.querySelector<HTMLButtonElement>('[data-kanban-column-id="stage:implementing"] [data-kanban-column-add]');
    await act(async () => addButton?.click());
    const titleInput = container.querySelector<HTMLInputElement>(".issue-title-input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(titleInput, "Created in implementing");
      titleInput?.dispatchEvent(new Event("input", {
        bubbles: true
      }));
      container.querySelector<HTMLFormElement>(".issue-dialog")?.requestSubmit();
    });
    expect(onCreateIssue).toHaveBeenCalledWith(demoDashboard.project.id, expect.objectContaining({
      status: "queued",
      title: "Created in implementing"
    }));
    expect(onMoveRun).toHaveBeenCalledWith("created-from-kanban", {
      status: "running",
      workflowStage: "implementing"
    });
    expect(container.querySelector('[role="dialog"][aria-label="새 이슈"]')).toBeNull();
    window.localStorage.removeItem(createIssueDraftStorageKey);
    await cleanup();
  });
  it.each(["completed", "cancelled", "blocked", "failed"] as const)("hides the assigned worker icon when an issue is %s", status => {
    const run = {
      ...demoDashboard.runs[0],
      status,
      workflowStage: null,
      workerId: dashboardWorker.id
    };
    const markup = renderToStaticMarkup(<HuntDashboard {...dashboardProps} dashboard={{
      ...demoDashboard,
      runs: [run],
      workers: [dashboardWorker]
    }} />);
    expect(markup).not.toContain("kanban-card-worker-badge");
    expect(markup).not.toContain("has-assignees");
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
      leaseExpiresAt: null
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs: [queuedRun],
        }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        cancelable: true
      }));
    });
    const processItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.includes("바로 처리하기"));
    expect(processItem?.hasAttribute("data-disabled")).toBe(false);
    await act(async () => processItem?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);
    await cleanup();
  });
  it("collapses and expands a kanban stage column per user and project", async () => {
    window.localStorage.clear();
    const userId = "user-collapse-1";
    const projectId = demoDashboard.project.id;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard {...dashboardProps} currentUserId={userId} dashboard={demoDashboard} />,
    );
    const collapseButton = container.querySelector<HTMLButtonElement>('button[aria-label="분석 열 접기"]');
    expect(collapseButton).not.toBeNull();
    expect(container.querySelector('[data-kanban-column-id="stage:analyzing"][data-kanban-column-collapsed="false"]')).not.toBeNull();
    await act(async () => collapseButton?.click());
    const collapsedColumn = container.querySelector('[data-kanban-column-id="stage:analyzing"]');
    expect(collapsedColumn?.getAttribute("data-kanban-column-collapsed")).toBe("true");
    expect(collapsedColumn?.closest(".kanban-column-shell")?.classList.contains("is-collapsed")).toBe(true);
    expect(collapsedColumn?.querySelector(".kanban-card")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="분석 열 펼치기"]')?.getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(window.localStorage.getItem(`briar.settings.kanbanColumnCollapse.v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`)!)).toEqual(["stage:analyzing"]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="분석 열 펼치기"]')?.click();
    });
    expect(container.querySelector('[data-kanban-column-id="stage:analyzing"]')?.getAttribute("data-kanban-column-collapsed")).toBe("false");
    await cleanup();
  });
  it("hides a kanban column into the hidden list and can show it again", async () => {
    window.localStorage.clear();
    const userId = "user-hide-1";
    const projectId = demoDashboard.project.id;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard {...dashboardProps} currentUserId={userId} dashboard={demoDashboard} />,
    );
    const hideTrigger = container.querySelector<HTMLButtonElement>('[aria-label="분석 열 메뉴"]');
    expect(hideTrigger).not.toBeNull();
    expect(container.querySelector('[data-kanban-column-id="stage:analyzing"]')).not.toBeNull();
    expect(container.querySelector("[data-kanban-hidden-columns]")).toBeNull();
    await act(async () => {
      hideTrigger?.dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0
      }));
    });
    const hideItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.includes("열 숨기기"));
    expect(hideItem).not.toBeUndefined();
    await act(async () => hideItem?.click());
    expect(container.querySelector('[data-kanban-column-id="stage:analyzing"]')).toBeNull();
    expect(container.querySelector('[data-kanban-hidden-column-id="stage:analyzing"]')).not.toBeNull();
    expect(container.querySelector("[data-kanban-hidden-columns]")?.textContent).toContain("숨긴 열");
    expect(JSON.parse(window.localStorage.getItem(`briar.settings.kanbanColumnHide.v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`)!)).toEqual(["stage:analyzing"]);
    const showTrigger = container.querySelector<HTMLButtonElement>('[aria-label="분석 숨긴 열 메뉴"]');
    await act(async () => {
      showTrigger?.dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0
      }));
    });
    const showItem = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.includes("열 표시"));
    expect(showItem).not.toBeUndefined();
    await act(async () => showItem?.click());
    expect(container.querySelector('[data-kanban-column-id="stage:analyzing"]')).not.toBeNull();
    expect(container.querySelector("[data-kanban-hidden-columns]")).toBeNull();
    await cleanup();
  });
  it("switches between kanban and list views while preserving issue navigation", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={demoDashboard} />);
    const listButton = container.querySelector<HTMLButtonElement>('button[aria-label="리스트 보기"]');
    expect(listButton?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".kanban-progress")).toBeNull();
    expect(container.querySelector(".kanban-card")?.textContent).not.toContain(`${demoDashboard.runs[0].progress}%`);
    expect(container.querySelector(".kanban-board[data-keyboard-list]")).not.toBeNull();
    expect(container.querySelectorAll(".kanban-card[data-keyboard-list-item]")).toHaveLength(container.querySelectorAll(".kanban-card").length);
    await act(async () => listButton?.click());
    expect(container.querySelector(".kanban-board")).toBeNull();
    expect(container.querySelector(".issue-list")).not.toBeNull();
    expect(container.querySelector(".issue-list-body[data-keyboard-list]")).not.toBeNull();
    expect(container.querySelectorAll(".issue-list-row")).toHaveLength(demoDashboard.runs.length);
    expect(container.querySelectorAll(".issue-list-row[data-keyboard-list-item]")).toHaveLength(demoDashboard.runs.length);
    expect(listButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".issue-list")?.textContent).toContain(demoDashboard.runs[0].title);
    expect(container.querySelector(".issue-list")?.textContent).not.toContain("진행률");
    expect(container.querySelector(".issue-list-progress")).toBeNull();
    expect(container.querySelector(".issue-list")?.textContent).not.toContain(`${demoDashboard.runs[0].progress}%`);
    expect(container.querySelectorAll(".issue-list-header [role='columnheader']")).toHaveLength(4);
    expect(container.querySelectorAll(".issue-list-row:first-child [role='cell']")).toHaveLength(4);
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
    await cleanup();
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
      executionReadiness: "ready" as const
    };
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={{
          ...demoDashboard,
          runs: [queuedRun],
        }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    );
    const swipeRow = container.querySelector<HTMLElement>(".companion-task-swipe");
    const firePointer = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true
      });
      Object.defineProperties(event, {
        button: {
          value: 0
        },
        clientX: {
          value: clientX
        },
        clientY: {
          value: clientY
        },
        isPrimary: {
          value: true
        },
        pointerId: {
          value: 1
        },
        pointerType: {
          value: "touch"
        }
      });
      swipeRow?.dispatchEvent(event);
    };
    await act(async () => {
      firePointer("pointerdown", 70, 20);
      firePointer("pointermove", 10, 22);
      firePointer("pointerup", 10, 22);
    });
    const action = container.querySelector<HTMLButtonElement>(".companion-task-swipe-action");
    expect(swipeRow?.className).toContain("open");
    expect(action?.getAttribute("aria-hidden")).toBe("false");
    expect(action?.getAttribute("aria-label")).toBe("바로 처리하기");
    expect(action?.disabled).toBe(false);
    await act(async () => action?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);
    expect(container.querySelector(".run-page")).toBeNull();
    await cleanup();
  });
  it("shows paused issues in their stage column on the attention filter", async () => {
    const pausedRun = demoDashboard.runs.find(run => run.status === "paused");
    const blockedRun = demoDashboard.runs.find(run => run.status === "blocked");
    expect(pausedRun).toBeTruthy();
    expect(blockedRun).toBeTruthy();
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={demoDashboard} />);
    const attentionTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".status-tabs button")).find(button => button.textContent?.includes("확인 필요"));
    expect(attentionTab).toBeTruthy();
    await act(async () => {
      attentionTab?.click();
    });
    expect(container.querySelector('[data-kanban-column-id="status:paused"]')).toBeNull();
    const localQaColumn = container.querySelector('[data-kanban-column-id="stage:local_qa"]');
    expect(localQaColumn?.textContent).toContain(pausedRun!.title);
    expect(localQaColumn?.querySelector(".kanban-card-review-banner")?.textContent).toContain("리뷰를 기다리고 있습니다");
    expect(container.querySelector('[data-kanban-column-id="stage:implementing"]')).toBeNull();
    expect(container.querySelector('[data-kanban-column-id="status:blocked"]')?.textContent).toContain(blockedRun!.title);
    expect(container.querySelector('[data-kanban-column-id="status:failed"]')).not.toBeNull();
    await cleanup();
  });
  it("does not start a pointer drag for paused review cards", async () => {
    const pausedRun = {
      ...demoDashboard.runs[1],
      status: "paused" as const,
      workflowStage: "local_qa"
    };
    const onMoveRun = vi.fn(async () => undefined);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs: [pausedRun],
        }}
        onMoveRun={onMoveRun}
      />,
    );
    const card = container.querySelector<HTMLElement>(".kanban-card");
    const backlogColumn = container.querySelector<HTMLElement>('[aria-label="백로그"]');
    expect(card?.className).toContain("awaiting-review");
    expect(card?.querySelector(".kanban-card-review-banner")).not.toBeNull();
    const firePointer = (target: EventTarget | null, type: string, clientX: number, clientY: number) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true
      });
      Object.defineProperties(event, {
        button: {
          value: 0
        },
        clientX: {
          value: clientX
        },
        clientY: {
          value: clientY
        },
        isPrimary: {
          value: true
        },
        pointerId: {
          value: 1
        },
        pointerType: {
          value: "mouse"
        }
      });
      target?.dispatchEvent(event);
    };
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => backlogColumn)
    });
    await act(async () => {
      firePointer(card, "pointerdown", 120, 120);
      firePointer(card, "pointermove", 180, 120);
      firePointer(card, "pointerup", 180, 120);
    });
    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    expect(card?.className).not.toContain("dragging");
    expect(document.body.querySelector(".kanban-card-drag-preview")).toBeNull();
    expect(onMoveRun).not.toHaveBeenCalled();
    await cleanup();
  });
  it("marks effective pause checkpoints at their kanban boundaries", () => {
    const workflow = {
      version: 2 as const,
      requirements: [],
      stages: [{
        id: "analyzing",
        label: "Analyze",
        required: true
      }, {
        id: "security_review",
        label: "Security review",
        required: true
      }],
      execution: {
        checkpoints: []
      },
      completion: {
        requiredStages: ["analyzing", "security_review"]
      }
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
            position: "after" as const
          }],
          userDefaults: [{
            key: "user-before-security-review",
            stage: "security_review",
            position: "before" as const
          }],
          effective: [{
            key: "project-after-analyzing",
            stage: "analyzing",
            position: "after" as const
          }, {
            key: "user-before-security-review",
            stage: "security_review",
            position: "before" as const
          }],
          projectRevision: 1,
          userRevision: 1
        }
      },
      runs: []
    };
    const markup = renderToStaticMarkup(<HuntDashboard {...dashboardProps} dashboard={dashboard} />);
    expect(markup.match(/class="kanban-checkpoint-marker"/g)).toHaveLength(1);
    expect(markup).toContain('data-checkpoint-count="2"');
    expect(markup).toContain("분석 완료 후 확인");
    expect(markup).toContain("Security review 시작 전 확인");
  });
  it("updates kanban pause markers when checkpoint settings change", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const checkpointPolicy = {
      ...demoDashboard.settings.checkpointPolicy!,
      projectMandatory: [],
      userDefaults: [],
      effective: []
    };
    const dashboard = {
      ...demoDashboard,
      settings: {
        ...demoDashboard.settings,
        checkpointPolicy
      }
    };
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={dashboard} />);
    expect(container.querySelector(".kanban-checkpoint-marker")).toBeNull();
    await renderReactTestRoot(
      root,
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
    );
    expect(container.querySelector(".kanban-checkpoint-marker")?.getAttribute("aria-label")).toContain("구현 시작 전 확인");
    await cleanup();
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
      leaseExpiresAt: null
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs: [queuedRun],
        }}
        onMoveRun={onMoveRun}
      />,
    );
    const card = container.querySelector<HTMLElement>(".kanban-card");
    const backlogColumn = container.querySelector<HTMLElement>('[aria-label="백로그"]');
    expect(card?.getAttribute("draggable")).toBe("false");
    expect(backlogColumn).not.toBeNull();
    const firePointer = (target: EventTarget | null, type: string, clientX: number, clientY: number) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true
      });
      Object.defineProperties(event, {
        button: {
          value: 0
        },
        clientX: {
          value: clientX
        },
        clientY: {
          value: clientY
        },
        isPrimary: {
          value: true
        },
        pointerId: {
          value: 1
        },
        pointerType: {
          value: "mouse"
        }
      });
      target?.dispatchEvent(event);
      return event;
    };
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => backlogColumn)
    });
    await act(async () => {
      firePointer(card, "pointerdown", 120, 120);
      firePointer(card, "pointermove", 140, 120);
    });
    expect(card?.className).toContain("dragging");
    expect(document.body.querySelector(".kanban-card-drag-preview")).not.toBeNull();
    await act(async () => {
      firePointer(card, "pointermove", 160, 120);
    });
    expect(container.querySelector('[aria-label="백로그"]')?.className).toContain("drag-over");
    await act(async () => {
      firePointer(card, "pointerup", 160, 120);
    });
    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    expect(onMoveRun).toHaveBeenCalledWith(queuedRun.id, {
      status: "backlog",
      workflowStage: null
    });
    expect(document.body.querySelector(".kanban-card-drag-preview")).toBeNull();

    // Drop should not open the issue detail page.
    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.click();
    });
    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();
    await cleanup();
  });
  it("shows recovery errors from failed status moves on the board", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <ToastProvider>
        <HuntDashboard
          {...dashboardProps}
          dashboard={demoDashboard}
          recoveryError="상태 이동에 실패했습니다."
        />
      </ToastProvider>,
    );
    expect(container.querySelector(".error-banner")).toBeNull();
    expect(document.body.querySelector('[data-testid="app-toast"].error')?.textContent).toContain("상태 이동에 실패했습니다.");
    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.click();
    });
    expect(container.querySelector(".run-page")).not.toBeNull();
    expect(document.body.querySelectorAll('[data-testid="app-toast"].error')).toHaveLength(1);
    await cleanup();
  });
  it("uses the regular status and execution flows for a created channel issue", async () => {
    const channelRun: HuntRun = {
      ...demoDashboard.runs[0],
      status: "backlog",
      workflowStage: null,
      context: {
        origin: "briar-channel"
      }
    };
    const onMoveRun = vi.fn(async () => undefined);
    const onProcessIssueNow = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await act(async () => {
      root.render(<HuntDashboard {...dashboardProps} dashboard={{
        ...demoDashboard,
        runs: [channelRun]
      }} onMoveRun={onMoveRun} onProcessIssueNow={onProcessIssueNow} requestedRunId={channelRun.id} />);
      await Promise.resolve();
    });
    const statusTrigger = container.querySelector<HTMLButtonElement>(".run-page-property-select.status .select-menu-trigger");
    await act(async () => statusTrigger?.click());
    const todoOption = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.includes("대기"));
    await act(async () => todoOption?.click());
    expect(onMoveRun).toHaveBeenCalledWith(channelRun.id, {
      status: "queued",
      workflowStage: null
    });
    expect(onProcessIssueNow).not.toHaveBeenCalled();
    const queuedChannelRun: HuntRun = {
      ...channelRun,
      status: "queued"
    };
    await act(async () => {
      root.render(<HuntDashboard {...dashboardProps} dashboard={{
        ...demoDashboard,
        runs: [queuedChannelRun]
      }} onMoveRun={onMoveRun} onProcessIssueNow={onProcessIssueNow} requestedRunId={queuedChannelRun.id} />);
      await Promise.resolve();
    });
    const processNow = container.querySelector<HTMLButtonElement>(".run-page-titlebar-actions .run-page-process-now");
    expect(processNow?.disabled).toBe(false);
    await act(async () => processNow?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedChannelRun);
    await cleanup();
  });
  it("restores the Kanban scroll position through internal issue navigation", async () => {
    const run = demoDashboard.runs[0];
    const dashboard = {
      ...demoDashboard,
      runs: [run]
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(root, <HuntDashboard {...dashboardProps} dashboard={dashboard} />);
    const board = container.querySelector<HTMLDivElement>(".kanban-board");
    expect(board).not.toBeNull();
    if (board) board.scrollLeft = 248;
    await act(async () => container.querySelector<HTMLElement>(".kanban-card")?.click());
    expect(container.querySelector(".run-page-shell")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".run-page-titlebar-back")?.click());
    expect(container.querySelector<HTMLDivElement>(".kanban-board")?.scrollLeft).toBe(248);
    await cleanup();
  });
});
