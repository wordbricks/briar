/** @vitest-environment jsdom */

import { act } from "react";
import { BoardHarness } from "../../../test/board-harness";
import { createReactTestRoot, renderReactTestRoot } from "../../../test/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "@/types";
import { demoDashboard, demoRunEvents } from "@/lib/demo-data";
import { defaultAgentProviderModelCatalog } from "@/lib/team-llm";
import * as api from "@/lib/api";
import * as channelRealtime from "@/lib/channel-realtime";
import * as issueActivityHook from "@/hooks/use-issue-agent-activity";
import type { ExecutionWorker, HuntRun, IssueMessage, IssueMessageSendResult, PlanningProject, ProjectAgent, RunEvidence, UpdateIssueInput } from "@/types";
import { IssueAgentActivityPanel } from "@/components/hunt/detail/IssueAgentActivityPanel";
import { RunPage } from "@/components/hunt/detail/RunPage";
import { CreateIssueDialog } from "@/components/hunt/editor/CreateIssueDialog";
import { EditIssueDialog } from "@/components/hunt/editor/EditIssueDialog";
import { runMatchesIssuePropertyFilters, type IssuePropertyFilters } from "@/state/board/filters";
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
const emptyIssueMessageContract: Pick<
  IssueMessage,
  | "attachments"
  | "proposedAction"
  | "executionProposal"
  | "skillExecutionProposal"
> = {
  attachments: [],
  proposedAction: null,
  executionProposal: null,
  skillExecutionProposal: null,
};
const dashboardAgent: ProjectAgent = {
  id: "agent-1",
  teamId: demoDashboard.team.id,
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
const propertiesProject: PlanningProject = {
  id: "planning-project-1",
  workspaceId: "workspace-1",
  workspaceName: "Workspace",
  teamId: demoDashboard.team.id,
  teamName: demoDashboard.team.name,
  name: "GetGPT",
  description: "",
  status: "active",
  leadUserId: null,
  leadName: null,
  startDate: null,
  targetDate: null,
  icon: null,
  color: null,
  sortOrder: 0,
  isDefault: true,
  role: "owner",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z"
};
const secondaryPropertiesProject: PlanningProject = {
  ...propertiesProject,
  id: "planning-project-2",
  name: "Briar mobile",
  isDefault: false,
  sortOrder: 1
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
  capabilities: {
    providerCapabilities: {
      ...defaultAgentProviderModelCatalog,
      codex: {
        models: [{
          id: "gpt-5.6-sol",
          label: "GPT-5.6 Sol",
          efforts: [{ id: "xhigh", label: "xhigh" }],
        }],
        defaultEfforts: [],
        allowCustomModels: false,
        error: null,
      },
    },
  },
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
    projectId: demoDashboard.team.id,
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
    updatedAt: status === "running" ? "2026-07-29T00:00:00.000Z" : "2026-07-29T00:10:00.000Z",
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
  expect(pending?.querySelector(".animate-spin")).toBeNull();
  return pending;
}
describe("RunPage", () => {
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
      executionReadiness: "ready" as const
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <BoardHarness
        {...dashboardProps}
        dashboard={{
          ...demoDashboard,
          runs: [queuedRun],
        }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });
    const processNow = container.querySelector<HTMLButtonElement>(".run-page-titlebar-actions .run-page-process-now");
    expect(processNow).not.toBeNull();
    expect(processNow?.disabled).toBe(false);
    expect(processNow?.getAttribute("aria-label")).toContain("바로 처리하기");
    await act(async () => processNow?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);
    await cleanup();
  });
  it("lets users change status and priority from compact property badges", async () => {
    const onMove = vi.fn(async () => undefined);
    const onUpdateIssue = vi.fn(async () => undefined);
    const run = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      priority: 4
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
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
          onMove={onMove}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          onUpdateIssue={onUpdateIssue}
          run={run}
        />
      </TooltipProvider>,
    );
    const statusTrigger = container.querySelector<HTMLButtonElement>(".run-page-property-select.status .select-menu-trigger");
    const priorityTrigger = container.querySelector<HTMLButtonElement>(".run-page-property-select.priority .select-menu-trigger");
    expect(statusTrigger?.textContent).toContain("대기");
    expect(priorityTrigger?.textContent).toContain("P4");
    await act(async () => statusTrigger?.click());
    const backlogOption = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.includes("백로그"));
    expect(backlogOption).not.toBeUndefined();
    await act(async () => backlogOption?.click());
    expect(onMove).toHaveBeenCalledWith({
      status: "backlog",
      workflowStage: null
    });
    await act(async () => priorityTrigger?.click());
    const highPriority = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.includes("P1"));
    expect(highPriority).not.toBeUndefined();
    await act(async () => highPriority?.click());
    expect(onUpdateIssue).toHaveBeenCalledWith({
      title: run.title,
      description: run.issueDescription,
      priority: 1,
      difficulty: run.difficulty,
      attachments: []
    });
    await cleanup();
  });
  it("renders compact titlebar assignee, worker, and action controls together", async () => {
    const member = {
      ...demoDashboard.members![0]!,
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    };
    const run = {
      ...demoDashboard.runs[0],
      assigneeUserId: member.userId,
      workerId: dashboardWorker.id,
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <TooltipProvider>
        <RunPage
          assignedWorker={dashboardWorker}
          error={null}
          isRecovering={false}
          isSidebarOpen
          mentionMembers={[member]}
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
          run={run}
        />
      </TooltipProvider>,
    );
    const actions = container.querySelector(".run-page-titlebar-actions");
    expect(actions).not.toBeNull();
    const badges = actions?.querySelector(".run-page-property-badges");
    expect(badges?.querySelectorAll(".run-page-property-select.select-menu")).toHaveLength(2);
    const assignee = badges?.querySelector<HTMLImageElement>(".run-page-property-badge.assignee .issue-assignee-avatar");
    expect(assignee?.tagName).toBe("IMG");
    expect(assignee?.getAttribute("src")).toBe(member.image);
    expect(badges?.querySelector(".run-page-property-badge.worker .worker-icon")?.textContent).toContain("🍋");
    expect(actions?.querySelector(".run-page-titlebar-divider")).not.toBeNull();
    const tools = actions?.querySelector(".run-page-titlebar-tools");
    expect(tools?.querySelector(".run-page-process-now")).not.toBeNull();
    expect(tools?.querySelector(".run-page-properties-toggle")).not.toBeNull();
    expect(tools?.querySelector(".run-page-actions-trigger")).not.toBeNull();
    await cleanup();
  });
  it("lets users edit every mutable issue property from the properties panel", async () => {
    const currentMember = {
      ...demoDashboard.members![0]!,
      userId: "member-1",
      name: "Jay Nam"
    };
    const nextMember = {
      ...currentMember,
      userId: "member-2",
      name: "Min Park"
    };
    const onUpdateIssue = vi.fn(async () => undefined);
    const onMoveIssueProject = vi.fn(async () => undefined);
    const run = {
      ...demoDashboard.runs[0],
      assigneeUserId: currentMember.userId,
      difficulty: "normal" as const,
      projectId: propertiesProject.id,
      projectName: propertiesProject.name,
      teamId: propertiesProject.teamId
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          issueProjects={[propertiesProject, secondaryPropertiesProject]}
          mentionMembers={[currentMember, nextMember]}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onMoveIssueProject={onMoveIssueProject}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          onUpdateIssue={onUpdateIssue}
          run={run}
        />
      </TooltipProvider>,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-properties-toggle")?.click();
    });
    expect(container.querySelector(".run-properties")?.textContent)
      .toContain("GetGPT");

    const assigneeTrigger = container.querySelector<HTMLButtonElement>(".run-assignee-select .select-menu-trigger");
    await act(async () => assigneeTrigger?.click());
    const nextAssignee = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.includes(nextMember.name));
    await act(async () => nextAssignee?.click());
    expect(onUpdateIssue).toHaveBeenLastCalledWith({
      title: run.title,
      description: run.issueDescription,
      priority: run.priority,
      difficulty: run.difficulty,
      assigneeUserId: nextMember.userId,
      attachments: []
    });

    const difficultyTrigger = container.querySelector<HTMLButtonElement>(".run-difficulty-select .select-menu-trigger");
    await act(async () => difficultyTrigger?.click());
    const hardDifficulty = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.includes("어려움"));
    await act(async () => hardDifficulty?.click());
    expect(onUpdateIssue).toHaveBeenLastCalledWith({
      title: run.title,
      description: run.issueDescription,
      priority: run.priority,
      difficulty: "hard",
      attachments: []
    });

    const projectTrigger = container.querySelector<HTMLButtonElement>(".run-project-select .select-menu-trigger");
    await act(async () => projectTrigger?.click());
    const nextProject = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.includes(secondaryPropertiesProject.name));
    await act(async () => nextProject?.click());
    expect(onMoveIssueProject).toHaveBeenCalledWith(secondaryPropertiesProject.id);
    await cleanup();
  });
  it("opens issue details as a page and returns to the kanban", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(root, <BoardHarness {...dashboardProps} dashboard={demoDashboard} />);
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
    expect(container.querySelector(".run-page-window-number")?.textContent).toBe(`AH-${demoDashboard.runs[0].runNumber}`);
    const windowTitle = container.querySelector(".run-page-window-title");
    expect((windowTitle as HTMLInputElement | null)?.value).toBe(demoDashboard.runs[0].title);
    expect(windowTitle?.getAttribute("title")).toBe(demoDashboard.runs[0].title);
    expect(container.querySelector(".run-page-shell > .topbar")?.getAttribute("data-tauri-drag-region")).toBe("deep");
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
    expect(workflowProgress?.querySelector("ol")?.getAttribute("aria-label")).toBe("전체 진행률");
    const workflowStages = workflowProgress?.querySelectorAll("li") ?? [];
    expect(workflowStages).toHaveLength(demoDashboard.runs[0].workflow.stages.length);
    expect(workflowStages[0]?.getAttribute("data-state")).toBe("complete");
    expect(workflowStages[1]?.getAttribute("data-state")).toBe("active");
    expect(workflowStages[1]?.getAttribute("aria-current")).toBe("step");
    expect(workflowStages[2]?.getAttribute("data-state")).toBe("upcoming");
    expect(workflowStages[0]?.getAttribute("aria-label")).toContain("완료");
    expect(workflowStages[1]?.getAttribute("aria-label")).toContain("진행 중");
    expect(workflowStages[2]?.getAttribute("aria-label")).toContain("대기");
    expect(container.querySelectorAll(".run-page-property-select")).toHaveLength(2);
    expect(container.querySelectorAll(".run-page-property-badge")).toHaveLength(0);
    expect(container.querySelector(".run-page-property-select.status .select-menu-trigger")).not.toBeNull();
    expect(container.querySelector(".run-page-property-select.priority .select-menu-trigger")).not.toBeNull();
    const propertiesToggle = container.querySelector<HTMLButtonElement>(".run-page-properties-toggle");
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => propertiesToggle?.click());
    const properties = container.querySelector(".run-properties");
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(properties).not.toBeNull();
    expect(properties?.textContent).toContain("속성");
    expect(properties?.textContent).toContain("저장소");
    expect(properties?.textContent).toContain("시도");
    expect(properties?.textContent).toContain("리비전");
    expect(properties?.querySelector('[aria-label="등록자: Jay"]')).not.toBeNull();
    expect(properties?.querySelector('.run-priority-select [aria-label="우선순위"]')).not.toBeNull();
    expect(properties?.querySelectorAll(".run-property-copy small")).toHaveLength(0);
    expect(properties?.querySelector(".run-status-control")).not.toBeNull();
    expect(properties?.textContent).not.toContain("전체 진행률");
    expect(properties?.querySelector(".run-property.progress")).toBeNull();
    const propertiesLayer = container.querySelector<HTMLElement>(".run-properties-layer");
    await act(async () => properties?.dispatchEvent(new MouseEvent("click", {
      bubbles: true
    })));
    expect(container.querySelector(".run-properties")).not.toBeNull();
    await act(async () => propertiesLayer?.click());
    expect(container.querySelector(".run-properties")).toBeNull();
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("로컬 저장소 열기");
    expect(container.textContent).not.toContain("이슈 처리 실행 증거를 실시간으로 표시합니다.");
    expect(container.querySelector(".issue-status-history-panel")).toBeNull();
    const statusHistoryTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent === "상태");
    expect(statusHistoryTab).not.toBeNull();
    await act(async () => statusHistoryTab?.click());
    const statusHistoryPanel = container.querySelector(".issue-status-history-panel");
    expect(statusHistoryPanel?.getAttribute("role")).toBe("tabpanel");
    expect(statusHistoryPanel?.textContent).toContain(demoRunEvents[demoDashboard.runs[0].id][0].detail ?? "");
    expect(statusHistoryPanel?.textContent).toContain("Jay");
    expect(statusHistoryPanel?.textContent).not.toContain("briar-app:demo-user");
    expect(statusHistoryPanel?.querySelectorAll(".timeline-event")).toHaveLength(demoRunEvents[demoDashboard.runs[0].id].length);
    expect(container.querySelector(".issue-activity-dialog")).toBeNull();
    const descriptionTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent === "이슈");
    await act(async () => descriptionTab?.click());
    expect(container.querySelector(".issue-status-history-panel")).toBeNull();
    const descriptionPane = container.querySelector(".issue-description-pane");
    expect(descriptionPane).not.toBeNull();
    expect(descriptionPane?.querySelector(":scope > header")).toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-markdown")).toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-inline-editor")).not.toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-empty")).toBeNull();
    expect(descriptionPane?.textContent).not.toContain(demoDashboard.runs[0].detail);
    expect(container.querySelector(".issue-content-divider")).toBeNull();
    const conversation = container.querySelector(".issue-conversation");
    expect(conversation).not.toBeNull();
    expect(conversation?.getAttribute("aria-label")).toBe("대화");
    expect(conversation?.querySelector(":scope > header")?.textContent).toContain("대화");
    const conversationResizer = container.querySelector(".run-page-conversation-resizer");
    expect(conversationResizer?.getAttribute("role")).toBe("separator");
    expect(conversationResizer?.getAttribute("aria-orientation")).toBe("vertical");
    expect(conversationResizer?.getAttribute("aria-valuemin")).toBe("30");
    expect(conversationResizer?.getAttribute("aria-valuemax")).toBe("65");
    expect(conversationResizer?.getAttribute("aria-valuenow")).toBe("38");
    expect(container.querySelector(".run-page-main")?.nextElementSibling).toBe(conversationResizer);
    expect(conversationResizer?.nextElementSibling).toBe(conversation);
    expect(conversation?.querySelector(".conversation-scroll-region + .issue-message-composer")).not.toBeNull();
    expect(container.querySelector(".run-page-composer-dock")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-titlebar-back")?.click();
    });
    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();
    await cleanup();
  });
  it("shows subscriber avatars and toggles the current member subscription", async () => {
    const member = demoDashboard.members![0]!;
    const onUpdateIssueSubscription = vi.fn(async () => undefined);
    const run = {
      ...demoDashboard.runs[0],
      assigneeUserId: null,
      subscribers: [{
        userId: member.userId,
        subscribedAt: "2026-08-12T00:00:00.000Z"
      }]
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <RunPage
        currentUserId={member.userId}
        error={null}
        isRecovering={false}
        isSidebarOpen
        mentionMembers={[member]}
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
        onUpdateIssueSubscription={onUpdateIssueSubscription}
        run={run}
      />,
    );
    expect(container.querySelectorAll(".issue-subscriber-avatar")).toHaveLength(1);
    const subscribe = container.querySelector<HTMLButtonElement>(".issue-subscribe-button");
    expect(subscribe?.textContent).toContain("구독 중");
    expect(subscribe?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => subscribe?.click());
    expect(onUpdateIssueSubscription).toHaveBeenCalledWith(false);
    await cleanup();
  });
  it("keeps an assignee subscribed", async () => {
    const member = demoDashboard.members![0]!;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <RunPage
        currentUserId={member.userId}
        error={null}
        isRecovering={false}
        isSidebarOpen
        mentionMembers={[member]}
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
        onUpdateIssueSubscription={async () => undefined}
        run={{
          ...demoDashboard.runs[0],
          assigneeUserId: member.userId,
        }}
      />,
    );
    const subscribe = container.querySelector<HTMLButtonElement>(".issue-subscribe-button");
    expect(subscribe?.disabled).toBe(true);
    expect(subscribe?.title).toBe("담당자는 이 이슈를 항상 구독합니다.");
    await cleanup();
  });
  it("moves the conversation into a tab when the issue page becomes narrow", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const onViewingIssueConversationChange = vi.fn();
    await renderReactTestRoot(
      root,
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
        onViewingIssueConversationChange={onViewingIssueConversationChange}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={demoDashboard.runs[0]}
      />,
    );
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(demoDashboard.runs[0].id);
    const layout = container.querySelector<HTMLElement>(".run-page-layout")!;
    const emitResize = async (width: number) => {
      await act(async () => {
        resizeCallback?.([{
          contentRect: {
            width
          } as DOMRectReadOnly,
          target: layout
        } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      });
    };
    await emitResize(959);
    const conversationTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.textContent === "대화");
    const conversationPanel = container.querySelector<HTMLElement>(".issue-conversation-tab-panel");
    expect(layout.classList.contains("is-conversation-tabbed")).toBe(true);
    expect(conversationTab).not.toBeNull();
    expect(conversationPanel?.hidden).toBe(true);
    expect(container.querySelector(".run-page-conversation-resizer")).toBeNull();
    expect(container.querySelectorAll(".issue-conversation")).toHaveLength(1);
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(null);
    await act(async () => conversationTab?.click());
    expect(conversationTab?.getAttribute("aria-selected")).toBe("true");
    expect(conversationPanel?.hidden).toBe(false);
    expect(conversationPanel?.querySelector(".issue-conversation")).not.toBeNull();
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(demoDashboard.runs[0].id);
    await emitResize(960);
    expect(layout.classList.contains("is-conversation-tabbed")).toBe(false);
    expect(Array.from(container.querySelectorAll('[role="tab"]')).some(tab => tab.textContent === "대화")).toBe(false);
    expect(container.querySelector(".issue-conversation-tab-panel")).toBeNull();
    expect(container.querySelector(".run-page-conversation-resizer")).not.toBeNull();
    expect(container.querySelector<HTMLElement>(".issue-description-pane")?.hidden).toBe(false);
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(demoDashboard.runs[0].id);
    await cleanup();
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(null);
    vi.unstubAllGlobals();
  });
  it("selects the conversation tab when a narrow issue opens from an Inbox reply", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <RunPage
        error={null}
        initialDetailTab="conversation"
        isRecovering={false}
        isSidebarOpen
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
        run={demoDashboard.runs[0]}
      />,
    );
    const layout = container.querySelector<HTMLElement>(".run-page-layout")!;
    await act(async () => {
      resizeCallback?.([{
        contentRect: {
          width: 959
        } as DOMRectReadOnly,
        target: layout
      } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });
    const conversationTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.textContent === "대화");
    const conversationPanel = container.querySelector<HTMLElement>(".issue-conversation-tab-panel");
    expect(layout.classList.contains("is-conversation-tabbed")).toBe(true);
    expect(conversationTab?.getAttribute("aria-selected")).toBe("true");
    expect(conversationPanel?.hidden).toBe(false);
    expect(conversationPanel?.querySelector(".issue-conversation")).not.toBeNull();
    expect(container.querySelector(".run-page-conversation-resizer")).toBeNull();
    await act(async () => {
      resizeCallback?.([{
        contentRect: {
          width: 960
        } as DOMRectReadOnly,
        target: layout
      } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(layout.classList.contains("is-conversation-tabbed")).toBe(false);
    expect(container.querySelector(".issue-conversation-tab-panel")).toBeNull();
    expect(container.querySelector<HTMLElement>(".issue-description-pane")?.hidden).toBe(false);
    await cleanup();
    vi.unstubAllGlobals();
  });
  it("marks an open issue viewed again when its inbox version changes", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const onIssueViewed = vi.fn();
    await renderReactTestRoot(
      root,
      <BoardHarness {...dashboardProps} dashboard={demoDashboard} onIssueViewed={onIssueViewed} />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });
    const viewedRun = demoDashboard.runs[0];
    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    const callsAfterOpening = onIssueViewed.mock.calls.length;
    const updatedDashboard = {
      ...demoDashboard,
      runs: demoDashboard.runs.map(run => run.id === viewedRun.id ? {
        ...run,
        eventCount: run.eventCount + 1,
        lastEventAt: "2026-08-06T03:00:00.000Z"
      } : run)
    };
    await renderReactTestRoot(
      root,
      <BoardHarness {...dashboardProps} dashboard={updatedDashboard} onIssueViewed={onIssueViewed} />,
    );
    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    expect(onIssueViewed).toHaveBeenCalledTimes(callsAfterOpening + 1);
    const callsAfterIssueUpdate = onIssueViewed.mock.calls.length;
    await renderReactTestRoot(
      root,
      <BoardHarness
        {...dashboardProps}
        dashboard={{
          ...updatedDashboard,
          conversationNotifications: [{
            id: "new-reply",
            runId: viewedRun.id,
            runTitle: viewedRun.title,
            rootMessageId: "root-message",
            body: "I added the requested answer.",
            author: {
              id: "reply-author",
              name: "Reply author",
              image: null,
              provider: null,
            },
            reason: "thread_reply",
            createdAt: "2026-08-06T03:01:00.000Z",
          }],
        }}
        onIssueViewed={onIssueViewed}
      />,
    );
    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    expect(onIssueViewed).toHaveBeenCalledTimes(callsAfterIssueUpdate + 1);
    await cleanup();
  });
  it("refreshes status history when the open issue records a new event", async () => {
    const run = demoDashboard.runs[0];
    const events = demoRunEvents[run.id];
    const queuedEvent = events.at(-1)!;
    const onLoadRunEvents = vi.fn<() => Promise<typeof events>>().mockResolvedValueOnce([queuedEvent]).mockResolvedValueOnce(events);
    const initialDashboard = {
      ...demoDashboard,
      runs: [{
        ...run,
        eventCount: 1
      }, ...demoDashboard.runs.slice(1)]
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <BoardHarness
        {...dashboardProps}
        dashboard={initialDashboard}
        onLoadRunEvents={onLoadRunEvents}
        requestedRunId={run.id}
      />,
    );
    expect(onLoadRunEvents).toHaveBeenCalledTimes(1);
    const statusHistoryTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent === "상태");
    await act(async () => statusHistoryTab?.click());
    expect(container.querySelectorAll(".issue-status-history-panel .timeline-event")).toHaveLength(1);
    await renderReactTestRoot(
      root,
      <BoardHarness
        {...dashboardProps}
        dashboard={demoDashboard}
        onLoadRunEvents={onLoadRunEvents}
        requestedRunId={run.id}
      />,
    );
    expect(onLoadRunEvents).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".issue-status-history-panel .timeline-event")).toHaveLength(events.length);
    await cleanup();
  });
  it("adds a checkpoint from an unstarted issue progress chart", async () => {
    const onUpdateIssueCheckpoints = vi.fn(async () => undefined);
    const run: HuntRun = {
      ...demoDashboard.runs[0],
      status: "queued",
      workflowStage: null,
      claimedAt: null,
      leaseExpiresAt: null,
      issueCheckpoints: [],
      workflow: {
        ...demoDashboard.runs[0].workflow,
        execution: {
          checkpoints: []
        }
      }
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
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
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        onUpdateIssueCheckpoints={onUpdateIssueCheckpoints}
        run={run}
      />,
    );
    const checkpoint = container.querySelector<HTMLButtonElement>('.issue-workflow-checkpoint[data-position="after"]');
    expect(checkpoint?.disabled).toBe(false);
    await act(async () => checkpoint?.click());
    expect(onUpdateIssueCheckpoints).toHaveBeenCalledWith([expect.objectContaining({
      key: expect.stringMatching(/^issue-after-/u),
      position: "after"
    })]);
    await cleanup();
  });
  it("opens the requested issue conversation in the conversation tab", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <BoardHarness
        {...dashboardProps}
        companionMode
        dashboard={demoDashboard}
        requestedRunId={demoDashboard.runs[0].id}
        requestedRunInitialTab="conversation"
      />,
    );
    const conversationTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.textContent === "대화");
    const conversationPanel = container.querySelector<HTMLElement>(".issue-conversation-tab-panel");
    expect(conversationTab?.getAttribute("aria-selected")).toBe("true");
    expect(conversationPanel?.hidden).toBe(false);
    await cleanup();
  });
  it("separates hierarchy, related issues, and execution dependencies", async () => {
    const prerequisite = demoDashboard.runs[1];
    const dependent = demoDashboard.runs[0];
    const parent = demoDashboard.runs[2];
    const subIssue = demoDashboard.runs[3];
    const addDependency = vi.fn(async () => undefined);
    const setParent = vi.fn(async () => undefined);
    const removeRelated = vi.fn(async () => undefined);
    const openRelatedMessage = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <TooltipProvider>
        <RunPage
          availableRuns={demoDashboard.runs}
          isSidebarOpen
          error={null}
          isRecovering={false}
          onAddDependency={addDependency}
          onAddRelated={async () => undefined}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRelatedMessageOpen={openRelatedMessage}
          onRemoveDependency={async () => undefined}
          onRemoveRelated={removeRelated}
          onSetParent={setParent}
          onLinkSubIssue={async () => undefined}
          onUnlinkSubIssue={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{
            ...dependent,
            prerequisites: [{
              id: prerequisite.id,
              runNumber: prerequisite.runNumber,
              title: prerequisite.title,
              status: prerequisite.status,
            }],
            parent: {
              id: parent.id,
              runNumber: parent.runNumber,
              title: parent.title,
              status: parent.status,
            },
            subIssues: [{
              id: subIssue.id,
              runNumber: subIssue.runNumber,
              title: subIssue.title,
              status: "completed",
            }],
            relatedIssues: [{
              id: parent.id,
              runNumber: parent.runNumber,
              title: parent.title,
              status: parent.status,
            }],
            dependents: [],
            relatedMessage: {
              organizationId: "11111111-1111-4111-8111-111111111111",
              channelId: "22222222-2222-4222-8222-222222222222",
              messageId: "33333333-3333-4333-8333-333333333333",
              rootMessageId: "44444444-4444-4444-8444-444444444444",
            },
          }}
        />
      </TooltipProvider>,
    );
    expect(container.querySelector(".issue-description-scroll .issue-dependencies")).toBeNull();
    expect(container.querySelector(".issue-dependencies")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-properties-toggle")?.click();
    });
    const properties = container.querySelector(".run-properties");
    const dependencies = container.querySelector(".run-properties .issue-dependencies");
    expect(dependencies).not.toBeNull();
    expect(dependencies?.textContent).toContain("계층");
    expect(dependencies?.textContent).toContain("1/1 완료");
    expect(dependencies?.textContent).toContain("관련 이슈");
    expect(dependencies?.textContent).toContain("실행 의존성");
    expect(dependencies?.textContent).toContain("선행 이슈");
    expect(dependencies?.textContent).toContain(`AH-${prerequisite.runNumber}`);
    expect(dependencies?.textContent).toContain(prerequisite.title);
    expect(dependencies?.textContent).toContain("후속 이슈");
    expect(dependencies?.querySelector('[aria-label*="연결 제거"]')).not.toBeNull();
    const relatedMessageButton = properties?.querySelector<HTMLButtonElement>(".run-related-message-property");
    expect(relatedMessageButton?.textContent).toContain("관련 메시지");
    expect(relatedMessageButton?.textContent).toContain("관련 메시지로 돌아가기");
    await act(async () => relatedMessageButton?.click());
    expect(openRelatedMessage).toHaveBeenCalledWith({
      organizationId: "11111111-1111-4111-8111-111111111111",
      channelId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
      rootMessageId: "44444444-4444-4444-8444-444444444444",
    });
    const executionGroup = Array.from(
      dependencies?.querySelectorAll<HTMLElement>(".issue-dependency-group") ?? [],
    ).find(group => group.textContent?.includes("실행 의존성"));
    await act(async () => executionGroup
      ?.querySelector<HTMLButtonElement>(".issue-dependency-add-button")?.click());
    const picker = document.querySelector('[role="dialog"]');
    expect(picker?.textContent).toContain("선행 이슈 추가");
    expect(picker?.querySelector('[aria-label="연결할 이슈 검색"]')).not.toBeNull();
    const candidateButton = picker?.querySelector<HTMLButtonElement>(".issue-dependency-picker-item");
    expect(candidateButton).not.toBeNull();
    await act(async () => candidateButton?.click());
    expect(addDependency).toHaveBeenCalledWith(expect.not.stringMatching(prerequisite.id));
    await act(async () => {
      Array.from(picker?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(button => button.textContent?.trim() === "닫기")?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await cleanup();
  });
  it("clears the resume spinner when the run reaches another paused checkpoint", async () => {
    const onResume = vi.fn(async () => undefined);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const pausedRun: HuntRun = {
      ...demoDashboard.runs[1],
      status: "paused"
    };
    const renderRun = (run: HuntRun) => <TooltipProvider>
        <RunPage isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={async () => []} onLoadRunEvidence={async () => []} onMove={async () => undefined} onResume={onResume} onRetry={async () => undefined} onSendIssueMessage={async () => {
        throw new Error("not implemented in this test");
      }} run={run} />
      </TooltipProvider>;
    await renderReactTestRoot(root, renderRun(pausedRun));
    const resumeButton = container.querySelector<HTMLButtonElement>(".paused-result-resume");
    expect(resumeButton?.disabled).toBe(false);
    expect(resumeButton?.querySelector(".animate-spin")).toBeNull();
    await act(async () => {
      resumeButton?.click();
      await Promise.resolve();
    });
    expect(onResume).toHaveBeenCalledOnce();
    expect(resumeButton?.disabled).toBe(true);
    expect(resumeButton?.querySelector(".animate-spin")).not.toBeNull();
    await renderReactTestRoot(
      root,
      renderRun({
        ...pausedRun,
        checkpoint: pausedRun.checkpoint
          ? {
            ...pausedRun.checkpoint,
            key: "project-after-pr_open",
            stage: "pr_open",
            stageLabel: "Pull request",
            terminalReviewOnly: false,
          }
          : null,
        workflowStage: "pr_open",
      }),
    );
    const nextCheckpointButton = container.querySelector<HTMLButtonElement>(".paused-result-resume");
    expect(nextCheckpointButton?.disabled).toBe(false);
    expect(nextCheckpointButton?.querySelector(".animate-spin")).toBeNull();
    await cleanup();
  });
  it("shows that an approved resume is still waiting for a Worker", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const awaitingWorker: HuntRun = {
      ...demoDashboard.runs[1],
      status: "paused",
      resumeRequestedAt: "2026-09-04T18:28:03.460Z",
      workerId: null,
      requestedWorkerId: null,
    };
    await renderReactTestRoot(root, <TooltipProvider>
        <RunPage isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={async () => []} onLoadRunEvidence={async () => []} onMove={async () => undefined} onResume={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
        throw new Error("not implemented in this test");
      }} run={awaitingWorker} />
      </TooltipProvider>);
    const resumeButton = container.querySelector<HTMLButtonElement>(".paused-result-resume");
    expect(resumeButton?.disabled).toBe(true);
    expect(resumeButton?.querySelector(".animate-spin")).not.toBeNull();
    const hint = container.querySelector(".paused-result-resume-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("Worker");
    await cleanup();
  });

  it("submits paused review feedback as an explicit rework request", async () => {
    const onRework = vi.fn(async () => undefined);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
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
          run={{
            ...demoDashboard.runs[1],
            status: "paused" as const,
          }}
        />
      </TooltipProvider>,
    );
    const openButton = container.querySelector<HTMLButtonElement>(".paused-result-rework");
    expect(openButton?.textContent).toContain("수정 요청");
    await act(async () => openButton?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>(".paused-rework-form textarea");
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "결과 요약을 더 짧게 만들고 모바일 화면도 다시 확인해 주세요.");
      textarea.dispatchEvent(new Event("input", {
        bubbles: true
      }));
    });
    const form = container.querySelector<HTMLFormElement>(".paused-rework-form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true
      }));
      await Promise.resolve();
    });
    expect(onRework).toHaveBeenCalledWith({
      workflowStage: "local_qa",
      reason: "결과 요약을 더 짧게 만들고 모바일 화면도 다시 확인해 주세요."
    });
    await cleanup();
  });
  it("requires the user to accept a Project Agent rework proposal before revision", async () => {
    const proposalId = "abababab-abab-4bab-8bab-abababababab";
    const message: IssueMessage = {
      ...emptyIssueMessageContract,
      id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      runId: demoDashboard.runs[1].id,
      parentMessageId: null,
      body: "D를 D′로 바꾸는 개정을 제안했습니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      proposedAction: {
        id: proposalId,
        type: "request_issue_rework",
        workflowStage: "local_qa",
        reason: "D를 D′로 변경하고 영향받는 QA를 다시 확인합니다.",
        status: "pending",
        acceptedAt: null,
        appliedRevision: null
      },
      createdAt: "2026-08-05T01:00:00.000Z",
      updatedAt: "2026-08-05T01:00:00.000Z"
    };
    const onAccept = vi.fn(async () => ({
      ...message.proposedAction!,
      status: "accepted" as const,
      acceptedAt: "2026-08-05T01:01:00.000Z",
      appliedRevision: 2
    }));
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          onAcceptIssueAction={onAccept}
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
          run={{
            ...demoDashboard.runs[1],
            status: "completed" as const,
          }}
        />
      </TooltipProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const acceptButton = container.querySelector<HTMLButtonElement>(".issue-rework-proposal-accept");
    expect(acceptButton?.textContent).toContain("수락하고 개정 시작");
    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      acceptButton?.click();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledWith(message.proposedAction);
    expect(container.textContent).toContain("리비전 2 개정이 시작되었습니다.");
    await cleanup();
  });
  it("requires acceptance before a Project Agent-created issue is persisted", async () => {
    const createdRunId = "30303030-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const message: IssueMessage = {
      ...emptyIssueMessageContract,
      id: "10101010-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: demoDashboard.runs[1].id,
      parentMessageId: null,
      body: "후속 QA 이슈 생성을 제안했습니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      proposedAction: {
        id: "20202020-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "request_issue_create",
        issue: {
          title: "후속 QA",
          description: "모바일 승인 흐름을 확인합니다.",
          priority: 2
        },
        status: "pending",
        acceptedAt: null,
        resultRunId: null
      },
      createdAt: "2026-08-06T01:00:00.000Z",
      updatedAt: "2026-08-06T01:00:00.000Z"
    };
    const onAccept = vi.fn(async () => ({
      ...message.proposedAction!,
      status: "accepted" as const,
      acceptedAt: "2026-08-06T01:01:00.000Z",
      resultRunId: createdRunId
    }));
    const onIssueOpen = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          onAcceptIssueAction={onAccept}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onDependencyOpen={onIssueOpen}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [message]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented");
          }}
          run={demoDashboard.runs[1]}
        />
      </TooltipProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const acceptButton = container.querySelector<HTMLButtonElement>(".issue-rework-proposal-accept");
    const proposalCard = container.querySelector<HTMLElement>(".issue-rework-proposal");
    expect(container.textContent).toContain("후속 QA");
    expect(proposalCard?.textContent).toContain("백로그에만 생성");
    expect(proposalCard?.textContent).toContain("별도 승인 필요");
    expect(acceptButton?.textContent).toContain("수락하고 이슈 만들기");
    expect(acceptButton?.querySelector(".lucide-plus")).not.toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      acceptButton?.click();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledWith(message.proposedAction);
    expect(container.textContent).toContain("새 이슈가 생성되었습니다.");
    const viewButton = container.querySelector<HTMLButtonElement>(".issue-rework-proposal-view");
    expect(viewButton?.textContent).toContain("이슈 보기");
    expect(onIssueOpen).not.toHaveBeenCalled();
    await act(async () => {
      viewButton?.click();
    });
    expect(onIssueOpen).toHaveBeenCalledWith(createdRunId);
    await cleanup();
  });
  it("keeps create evidence while approving its distinct follow-up run", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = {
      ...demoDashboard.runs[0],
      id: "30303030-cccc-4ccc-8ccc-cccccccccccc",
      title: "후속 QA 실행",
      status: "backlog" as const,
      workflowStage: null,
      executionReadiness: "ready" as const,
      claimedBy: null,
      claimedAt: null,
      workerId: null,
      dispatchedAt: null,
      requestedByUserId: null,
      dispatchMode: null
    };
    const executionProposal = {
      id: "40404040-cccc-4ccc-8ccc-cccccccccccc",
      type: "request_issue_execute" as const,
      status: "pending" as const,
      projectId: demoDashboard.team.id,
      runId: targetRun.id,
      title: targetRun.title,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedProvider: null,
      requestedModel: null,
      requestedEffort: null,
      requestedWorkerId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null
    };
    const message: IssueMessage = {
      ...emptyIssueMessageContract,
      id: "10101010-cccc-4ccc-8ccc-cccccccccccc",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "후속 QA 이슈 생성과 실행을 제안합니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      proposedAction: {
        id: "20202020-cccc-4ccc-8ccc-cccccccccccc",
        type: "request_issue_create",
        issue: {
          title: targetRun.title,
          description: "생성과 실행 경계를 분리합니다.",
          priority: 2
        },
        executeAfterCreate: true,
        status: "pending",
        acceptedAt: null,
        resultRunId: null
      },
      executionProposal: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:01:00.000Z"
    };
    const acceptedCreate = {
      ...message.proposedAction!,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      resultRunId: targetRun.id
    };
    const materializedMessage: IssueMessage = {
      ...emptyIssueMessageContract,
      ...message,
      proposedAction: acceptedCreate,
      executionProposal
    };
    const onLoadMessages = vi.fn().mockResolvedValueOnce([message]).mockResolvedValue([materializedMessage]);
    const onAcceptCreate = vi.fn(async () => acceptedCreate);
    const onAcceptExecution = vi.fn(async (_proposal, input) => ({
      ...executionProposal,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:02:00.000Z",
      requestedProvider: input.provider,
      requestedModel: input.model,
      requestedEffort: input.effort,
      requestedWorkerId: input.workerId
    }));
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <TooltipProvider>
        <RunPage
          availableRuns={[conversationRun, targetRun]}
          error={null}
          executionWorkers={[{
            ...dashboardWorker,
            readiness: "available",
            activeSessions: 0,
            availableSessions: 1,
          }]}
          isRecovering={false}
          isSidebarOpen
          onAcceptIssueAction={onAcceptCreate}
          onAcceptIssueExecution={onAcceptExecution}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={onLoadMessages}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented");
          }}
          run={conversationRun}
        />
      </TooltipProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("새 이슈가 생성되었습니다");
    expect(container.textContent).not.toContain("이슈 실행 제안");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".issue-rework-proposal-accept")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onAcceptCreate).toHaveBeenCalledWith(message.proposedAction);
    expect(onLoadMessages).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("새 이슈가 생성되었습니다");
    expect(container.textContent).toContain("이슈 실행 제안");
    expect(onAcceptExecution).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".execution-proposal-approve")?.click();
    });
    expect(document.body.textContent).toContain("후속 QA 실행");
    expect(document.body.textContent).toContain("이슈 실행 승인");
    const finalApprove = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("승인하고 실행"));
    await act(async () => finalApprove?.click());
    expect(onAcceptExecution).toHaveBeenCalledWith(executionProposal, {
      provider: "codex",
      model: targetRun.preferredModel,
      effort: targetRun.preferredEffort,
      workerId: null
    });
    expect(container.textContent).toContain("새 이슈가 생성되었습니다");
    expect(container.textContent).toContain("실행이 명시적으로 승인");
    await cleanup();
  });
});
