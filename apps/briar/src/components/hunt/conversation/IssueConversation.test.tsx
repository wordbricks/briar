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
describe("IssueConversation", () => {
  it("highlights and focuses the reply selected from Inbox", async () => {
    const run = demoDashboard.runs[0];
    const rootMessage: IssueMessage = {
      id: "issue-root-message",
      runId: run.id,
      parentMessageId: null,
      body: "원본 메시지",
      author: {
        id: "jay",
        name: "Jay",
        image: null,
        provider: null,
      },
      replyCount: 1,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    const replyMessage: IssueMessage = {
      ...rootMessage,
      id: "issue-reply-message",
      parentMessageId: rootMessage.id,
      body: "Inbox에서 연 답글",
      createdAt: "2026-08-15T00:01:00.000Z",
      updatedAt: "2026-08-15T00:01:00.000Z",
      replyCount: 0,
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <RunPage
        error={null}
        highlightedMessageId={replyMessage.id}
        initialDetailTab="conversation"
        isRecovering={false}
        isSidebarOpen
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => [rootMessage, replyMessage]}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={run}
      />,
    );

    const highlighted = container.querySelector<HTMLElement>(
      '[data-inbox-highlighted="true"]',
    );
    expect(highlighted?.dataset.issueMessageId).toBe(replyMessage.id);
    expect(highlighted?.getAttribute("aria-current")).toBe("true");
    expect(highlighted?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(highlighted);

    await cleanup();
  });

  it("keeps loaded messages visible when the run snapshot refreshes", async () => {
    const createdAt = new Date().toISOString();
    const loadedMessage: IssueMessage = {
      id: "message-loaded",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "계속 보여야 하는 메시지",
      author: {
        id: "jay",
        name: "Jay",
        image: null,
        provider: null
      },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt
    };
    const onLoadIssueMessages = vi.fn<() => Promise<IssueMessage[]>>().mockResolvedValueOnce([loadedMessage]).mockImplementation(() => new Promise(() => undefined));
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renderPage = (run = demoDashboard.runs[0]) => <RunPage isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={() => onLoadIssueMessages()} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
      throw new Error("not implemented in this test");
    }} run={run} />;
    await renderReactTestRoot(root, renderPage());
    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".issue-message-list")?.textContent).toContain(loadedMessage.body);
    await renderReactTestRoot(
      root,
      renderPage({
        ...demoDashboard.runs[0],
        updatedAt: new Date(Date.now() + 15_000).toISOString(),
      }),
    );
    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".issue-message-state")).toBeNull();
    expect(container.querySelector(".issue-message-list")?.textContent).toContain(loadedMessage.body);
    await cleanup();
  });
  it("uses Inbox conversation changes as a delta recovery signal", async () => {
    const run = demoDashboard.runs[0];
    const createdAt = "2026-08-15T00:00:00.000Z";
    const trigger: IssueMessage = {
      id: "message-trigger",
      runId: run.id,
      parentMessageId: null,
      body: "@developer 답변해 줘",
      author: {
        id: "jay",
        name: "Jay",
        image: null,
        provider: null
      },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt
    };
    const reply: IssueMessage = {
      ...trigger,
      id: "message-reply",
      parentMessageId: trigger.id,
      body: "완료된 답변",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      createdAt: "2026-08-15T00:01:00.000Z",
      updatedAt: "2026-08-15T00:01:00.000Z"
    };
    const replyJob = {
      id: "reply-job-1",
      triggerMessageId: trigger.id,
      parentMessageId: trigger.id,
      agentId: "agent-developer",
      agentName: "Developer",
      status: "running" as const,
      attempts: 1,
      workerId: null,
      provider: "codex" as const,
      error: null,
      updatedAt: createdAt
    };
    const reviewerReplyJob = {
      ...replyJob,
      id: "reply-job-2",
      agentId: "agent-reviewer",
      agentName: "Reviewer"
    };
    const loadSnapshot = vi.spyOn(api, "loadIssueConversationSnapshot").mockResolvedValue({
      cursor: 7,
      messages: [trigger],
      agentReplies: [replyJob, reviewerReplyJob]
    });
    const loadDelta = vi.spyOn(api, "loadIssueConversationDelta").mockResolvedValueOnce({
      cursor: 7,
      hasMore: false,
      changed: false
    }).mockResolvedValueOnce({
      cursor: 8,
      hasMore: false,
      changed: true,
      messages: [trigger, reply],
      agentReplies: [replyJob, reviewerReplyJob].map(job => ({
        ...job,
        status: "completed" as const,
        updatedAt: "2026-08-15T00:01:00.000Z"
      }))
    });
    const transport = {
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn())
    };
    const createTransport = vi.spyOn(channelRealtime, "createProjectRealtimeTransport").mockReturnValue(transport);
    const activity = vi.spyOn(issueActivityHook, "useIssueAgentActivity").mockReturnValue(new Map([[replyJob.id, {
      version: 1,
      replyJobId: replyJob.id,
      attempt: 1,
      sequence: 1,
      projectId: demoDashboard.project.id,
      runId: run.id,
      triggerMessageId: trigger.id,
      parentMessageId: trigger.id,
      activity: {
        id: "commentary-1",
        kind: "message",
        headline: "원인을 확인하고 있습니다."
      },
      sentAt: createdAt,
      expiresAt: "2099-01-01T00:00:00.000Z"
    }]]));
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renderPage = (conversationInboxSyncSignal: string) => <RunPage conversationInboxSyncSignal={conversationInboxSyncSignal} error={null} isRecovering={false} isSidebarOpen onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={async () => []} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
      throw new Error("message should not be sent");
    }} organizationId="organization-1" projectId={demoDashboard.project.id} run={run} token="token" />;
    await act(async () => {
      root.render(renderPage("baseline"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(loadDelta).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Developer · 원인을 확인하고 있습니다.");
    expect(container.textContent).not.toContain("Briar · 원인을 확인하고 있습니다.");
    expect(container.textContent).toContain("Reviewer님이 답변을 작성하고 있습니다…");
    await act(async () => {
      root.render(renderPage("conversation:message-reply"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadDelta).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(reply.body);
    expect(container.textContent).not.toContain("Agent가 답변을 작성하고 있습니다");
    await cleanup();
    createTransport.mockRestore();
    activity.mockRestore();
    loadDelta.mockRestore();
    loadSnapshot.mockRestore();
  });
  it("reloads execution proposals when the run execution snapshot changes", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = {
      ...demoDashboard.runs[0],
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
    const createdAt = "2026-08-11T00:00:00.000Z";
    const message: IssueMessage = {
      id: "message-execution-proposal",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "이 이슈의 실행을 제안합니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      executionProposal: {
        id: "40404040-dddd-4ddd-8ddd-dddddddddddd",
        type: "request_issue_execute",
        status: "pending",
        projectId: demoDashboard.project.id,
        runId: targetRun.id,
        title: targetRun.title,
        createdAt,
        acceptedAt: null,
        requestedProvider: null,
        requestedModel: null,
        requestedEffort: null,
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null
      },
      createdAt,
      updatedAt: createdAt
    };
    const onLoadIssueMessages = vi.fn<() => Promise<IssueMessage[]>>().mockResolvedValueOnce([message]).mockResolvedValue([{
      ...message,
      executionProposal: null
    }]);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renderPage = (nextTargetRun: HuntRun) => <RunPage availableRuns={[conversationRun, nextTargetRun]} isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={onLoadIssueMessages} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
      throw new Error("not implemented in this test");
    }} run={conversationRun} />;
    await renderReactTestRoot(root, renderPage(targetRun));
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();
    await act(async () => {
      root.render(renderPage({
        ...targetRun,
        agentId: dashboardAgent.id
      }));
      await Promise.resolve();
    });
    expect(onLoadIssueMessages).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".execution-proposal-card")).toBeNull();
    await cleanup();
  });
  it("uses the shared exact-Worker Skill approval in issue conversations", async () => {
    const run = demoDashboard.runs[0];
    const pending = {
      id: "skill-issue-approval",
      type: "request_agent_skill_execute" as const,
      status: "pending" as const,
      projectId: demoDashboard.project.id,
      agentId: dashboardAgent.id,
      agentName: dashboardAgent.name,
      skillId: "skill-release",
      skillName: "Release",
      request: "Release this project",
      provider: "codex" as const,
      model: null,
      effort: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedWorkerId: null,
      requestedWorkerLabel: null,
      resultSessionId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null
    };
    const message: IssueMessage = {
      id: "message-skill-approval",
      runId: run.id,
      parentMessageId: null,
      body: "I matched the Release Skill.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      skillExecutionProposal: pending,
      createdAt: pending.createdAt,
      updatedAt: pending.createdAt
    };
    const onAccept = vi.fn(async (_proposal, input) => ({
      ...pending,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedWorkerId: input.workerId,
      requestedWorkerLabel: dashboardWorker.label,
      resultSessionId: "session-skill-issue"
    }));
    const skillWorker: ExecutionWorker = {
      ...dashboardWorker,
      readiness: "available",
      activeSessions: 0,
      availableSessions: 1
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await act(async () => {
      root.render(<RunPage availableRuns={[run]} error={null} executionWorkers={[skillWorker]} isRecovering={false} isSidebarOpen onAcceptSkillExecution={onAccept} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={async () => [message]} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
        throw new Error("not implemented in this test");
      }} projectId={demoDashboard.project.id} run={run} />);
      await Promise.resolve();
    });
    expect(container.querySelector(".skill-execution-proposal-card")).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".skill-execution-proposal-card footer button")?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="실행할 정확한 Worker"]')?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[role="option"][data-value="worker-1"]')?.click();
    });
    const approve = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("승인하고 Skill 실행"));
    await act(async () => approve?.click());
    expect(onAccept).toHaveBeenCalledWith(pending, {
      workerId: "worker-1"
    });
    expect(container.textContent).toContain("session-skill-issue");
    await cleanup();
  });
  it("revalidates a newly loaded pending proposal when its target changed during the load", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = {
      ...demoDashboard.runs[0],
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
    const createdAt = "2026-08-11T00:00:00.000Z";
    const message: IssueMessage = {
      id: "message-delayed-execution-proposal",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "늦게 도착한 실행 제안입니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      executionProposal: {
        id: "51515151-dddd-4ddd-8ddd-dddddddddddd",
        type: "request_issue_execute",
        status: "pending",
        projectId: demoDashboard.project.id,
        runId: targetRun.id,
        title: targetRun.title,
        createdAt,
        acceptedAt: null,
        requestedProvider: null,
        requestedModel: null,
        requestedEffort: null,
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null
      },
      createdAt,
      updatedAt: createdAt
    };
    let resolveInitialLoad!: (messages: IssueMessage[]) => void;
    const initialLoad = new Promise<IssueMessage[]>(resolve => {
      resolveInitialLoad = resolve;
    });
    const onLoadIssueMessages = vi.fn<() => Promise<IssueMessage[]>>().mockImplementationOnce(() => initialLoad).mockResolvedValue([{
      ...message,
      executionProposal: null
    }]);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renderPage = (nextTargetRun: HuntRun) => <RunPage availableRuns={[conversationRun, nextTargetRun]} isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={onLoadIssueMessages} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
      throw new Error("not implemented in this test");
    }} run={conversationRun} />;
    await renderReactTestRoot(root, renderPage(targetRun));
    await act(async () => {
      root.render(renderPage({
        ...targetRun,
        status: "queued",
        updatedAt: "2026-08-11T00:01:00.000Z"
      }));
      resolveInitialLoad([message]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onLoadIssueMessages).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".execution-proposal-card")).toBeNull();
    await cleanup();
  });
  it("does not reload accepted proposal history as its target progresses", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = demoDashboard.runs[0];
    const createdAt = "2026-08-11T00:00:00.000Z";
    const message: IssueMessage = {
      id: "message-accepted-execution-proposal",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "승인된 실행 기록입니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      executionProposal: {
        id: "62626262-dddd-4ddd-8ddd-dddddddddddd",
        type: "request_issue_execute",
        status: "accepted",
        projectId: demoDashboard.project.id,
        runId: targetRun.id,
        title: targetRun.title,
        createdAt,
        acceptedAt: "2026-08-11T00:01:00.000Z",
        requestedProvider: "codex",
        requestedModel: "gpt-5.6-sol",
        requestedEffort: "high",
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null
      },
      createdAt,
      updatedAt: createdAt
    };
    const onLoadIssueMessages = vi.fn<() => Promise<IssueMessage[]>>().mockResolvedValue([message]);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renderPage = (nextTargetRun: HuntRun) => <RunPage availableRuns={[conversationRun, nextTargetRun]} isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={onLoadIssueMessages} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
      throw new Error("not implemented in this test");
    }} run={conversationRun} />;
    await renderReactTestRoot(root, renderPage(targetRun));
    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    await act(async () => {
      root.render(renderPage({
        ...targetRun,
        status: "queued",
        updatedAt: "2026-08-11T00:02:00.000Z"
      }));
      await Promise.resolve();
    });
    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();
    expect(container.querySelector(".issue-message-state")).toBeNull();
    await cleanup();
  });
  it("shows an Android/Tauri message without a sending label and restores the draft on failure", async () => {
    let rejectSend: (reason: Error) => void = () => undefined;
    const pendingSend = new Promise<IssueMessageSendResult>((_resolve, reject) => {
      rejectSend = reject;
    });
    const onSendIssueMessage = vi.fn(() => pendingSend);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await act(async () => {
      root.render(<RunPage isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={async () => []} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={onSendIssueMessage} run={demoDashboard.runs[0]} />);
      await Promise.resolve();
    });
    const draft = "안드로이드 대화 초안";
    const textarea = container.querySelector<HTMLTextAreaElement>(".issue-message-composer textarea");
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, draft);
      textarea.dispatchEvent(new Event("input", {
        bubbles: true
      }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".issue-message-composer .issue-message-send")?.click();
      await Promise.resolve();
    });
    expect(onSendIssueMessage).toHaveBeenCalledOnce();
    expect(onSendIssueMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: draft,
      clientMessageId: expect.any(String)
    }));
    expect(textarea?.value).toBe("");
    expect(container.querySelector(".issue-message.is-optimistic")?.textContent).toContain(draft);
    expect(container.querySelector(".conversation-message-sending")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".issue-message-composer .issue-message-send")?.disabled).toBe(true);
    await act(async () => {
      rejectSend(new Error("전송 실패"));
      await pendingSend.catch(() => undefined);
      await Promise.resolve();
    });
    expect(textarea?.value).toBe(draft);
    expect(container.querySelector(".issue-message.is-optimistic")).toBeNull();
    expect(container.querySelector(".issue-composer-error")?.textContent).toContain("전송 실패");
    await cleanup();
  });
  it("pastes an image into the issue conversation and sends it without text", async () => {
    const image = new File(["image"], "clipboard.png", {
      type: "image/png"
    });
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
        url: "blob:stored-image"
      }],
      author: {
        id: "jay",
        name: "Jay",
        image: null,
        provider: null
      },
      replyCount: 0,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z"
    };
    const onSendIssueMessage = vi.fn(async () => ({
      message: sentMessage,
      agentReply: null
    }));
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await act(async () => {
      root.render(<RunPage isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => image} onLoadIssueMessages={async () => []} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={onSendIssueMessage} run={demoDashboard.runs[0]} />);
      await Promise.resolve();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(".issue-conversation > .issue-message-composer textarea");
    const paste = new Event("paste", {
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [image],
        items: [{
          kind: "file",
          getAsFile: () => image
        }],
        types: ["Files"]
      }
    });
    await act(async () => textarea?.dispatchEvent(paste));
    expect(container.querySelector(".issue-composer-attachment")?.textContent).toContain("clipboard.png");
    expect(container.querySelector(".issue-conversation > .issue-message-composer .issue-message-send .lucide-send")).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".issue-conversation > .issue-message-composer .issue-message-send")?.click();
      await Promise.resolve();
    });
    expect(onSendIssueMessage).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [image],
      body: expect.stringContaining("briar-attachment://")
    }));
    await cleanup();
  });
  it("renders replies flat and sends a reply to any message", async () => {
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "원문 메시지",
      author: {
        id: "jay",
        name: "Jay",
        image: null,
        provider: null
      },
      replyCount: 1,
      createdAt: "2026-08-03T10:00:00.000Z",
      updatedAt: "2026-08-03T10:00:00.000Z"
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "기존 답글",
      replyCount: 1,
      createdAt: "2026-08-03T10:01:00.000Z",
      updatedAt: "2026-08-03T10:01:00.000Z"
    };
    const nestedReply: IssueMessage = {
      ...rootMessage,
      id: "message-nested-reply",
      parentMessageId: reply.id,
      body: "기존 대댓글",
      replyCount: 0,
      createdAt: "2026-08-03T10:02:00.000Z",
      updatedAt: "2026-08-03T10:02:00.000Z"
    };
    let sentParentId: string | null | undefined;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
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
        onSendIssueMessage={async input => {
          sentParentId = input.parentMessageId;
          return {
            message: nestedReply,
            agentReply: null,
          };
        }}
        run={demoDashboard.runs[0]}
      />,
    );
    const groupByBody = (body: string) => Array.from(container.querySelectorAll<HTMLElement>(".issue-message-group")).find(group => group.querySelector(":scope > .issue-message > div > .issue-message-body")?.textContent?.includes(body));
    const replyGroup = groupByBody("기존 답글");
    const nestedGroup = groupByBody("기존 대댓글");
    expect(container.querySelectorAll(".issue-message-group")).toHaveLength(3);
    expect(container.querySelector(".issue-message-replies")).toBeNull();
    expect(replyGroup).not.toBeUndefined();
    expect(nestedGroup).not.toBeUndefined();
    expect(replyGroup?.querySelector(".issue-message-parent-quote")?.textContent).toContain("원문 메시지");
    expect(nestedGroup?.querySelector(".issue-message-parent-quote")?.textContent).toContain("기존 답글");
    const nestedReplyButton = nestedGroup?.querySelector<HTMLButtonElement>(".issue-reply-trigger");
    expect(nestedReplyButton?.getAttribute("title")).toBe("답글 작성");
    await act(async () => nestedReplyButton?.click());
    const nestedComposer = nestedGroup?.querySelector<HTMLElement>(".issue-inline-reply-composer .issue-message-composer textarea") as HTMLTextAreaElement | null;
    expect(nestedComposer?.placeholder).toBe("답장 남기기…");
    await act(async () => {
      if (!nestedComposer) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(nestedComposer, "대댓글에 이어서");
      nestedComposer.dispatchEvent(new Event("input", {
        bubbles: true
      }));
      nestedComposer.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter"
      }));
      await Promise.resolve();
    });
    expect(sentParentId).toBe(nestedReply.id);
    await cleanup();
  });
  it("edits and deletes messages the current user authored", async () => {
    const createdAt = "2026-08-03T10:00:00.000Z";
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "수정 전 원문",
      author: {
        id: "jay",
        name: "Jay",
        image: null,
        provider: null
      },
      replyCount: 1,
      createdAt,
      updatedAt: createdAt
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "기존 답글",
      replyCount: 0,
      createdAt: "2026-08-03T10:01:00.000Z",
      updatedAt: "2026-08-03T10:01:00.000Z"
    };
    const onEditIssueMessage = vi.fn(async () => ({
      ...rootMessage,
      body: "수정 후 본문",
      updatedAt: "2026-08-03T10:02:00.000Z"
    }));
    const onDeleteIssueMessage = vi.fn(async () => undefined);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <RunPage
        currentUserId="jay"
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onDeleteIssueMessage={onDeleteIssueMessage}
        onEditIssueMessage={onEditIssueMessage}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => [rootMessage, reply]}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => ({
          message: rootMessage,
          agentReply: null,
        })}
        run={demoDashboard.runs[0]}
      />,
    );
    const groupByBody = (body: string) => Array.from(container.querySelectorAll<HTMLElement>(".issue-message-group")).find(group => group.querySelector(":scope > .issue-message > div > .issue-message-body")?.textContent?.includes(body));
    const rootGroup = groupByBody("수정 전 원문");
    expect(rootGroup).not.toBeUndefined();
    const editButton = rootGroup?.querySelector<HTMLButtonElement>('button[title="메시지 수정"]');
    const deleteButton = rootGroup?.querySelector<HTMLButtonElement>('button[title="메시지 삭제"]');
    expect(editButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();
    await act(async () => editButton?.click());
    const editComposer = rootGroup?.querySelector<HTMLElement>(".issue-inline-reply-composer .issue-message-composer textarea") as HTMLTextAreaElement | null;
    expect(editComposer?.value).toBe("수정 전 원문");
    expect(editComposer?.placeholder).toBe("메시지 수정…");
    await act(async () => {
      if (!editComposer) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editComposer, "수정 후 본문");
      editComposer.dispatchEvent(new Event("input", {
        bubbles: true
      }));
      editComposer.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter"
      }));
      await Promise.resolve();
    });
    expect(onEditIssueMessage).toHaveBeenCalledWith(rootMessage.id, expect.objectContaining({
      body: "수정 후 본문"
    }));
    expect(container.textContent).toContain("수정 후 본문");
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const replyGroup = groupByBody("기존 답글");
    await act(async () => replyGroup?.querySelector<HTMLButtonElement>('button[title="메시지 삭제"]')?.click());
    expect(onDeleteIssueMessage).toHaveBeenCalledWith(reply.id);
    expect(rootGroup?.querySelector(".conversation-reply-summary")).toBeNull();
    await act(async () => deleteButton?.click());
    confirmSpy.mockRestore();
    expect(onDeleteIssueMessage).toHaveBeenCalledWith(rootMessage.id);
    expect(container.querySelector(".issue-message-group")).toBeNull();
    await cleanup();
  });
  it("hides edit and delete actions for messages the current user did not author", async () => {
    const createdAt = "2026-08-03T10:00:00.000Z";
    const agentMessage: IssueMessage = {
      id: "message-agent",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "Developer의 답변",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex"
      },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <RunPage
        currentUserId="jay"
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => [agentMessage]}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => ({
          message: agentMessage,
          agentReply: null,
        })}
        run={demoDashboard.runs[0]}
      />,
    );
    expect(container.querySelector('button[title="메시지 수정"]')).toBeNull();
    expect(container.querySelector('button[title="메시지 삭제"]')).toBeNull();
    await cleanup();
  });
  it("keeps the conversation error alert when an agent reply fails", async () => {
    const createdAt = new Date().toISOString();
    const userMessage: IssueMessage = {
      id: "message-reply-failed",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "@developer 실패한 답변",
      author: {
        id: "jay",
        name: "Jay",
        image: null,
        provider: null
      },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt
    };
    let rejectAgentReply: (error: Error) => void = () => undefined;
    const pendingAgentReply = new Promise<IssueMessage>((_, reject) => {
      rejectAgentReply = reject;
    });
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
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
        onSendIssueMessage={async () => ({
          message: userMessage,
          agentReply: pendingAgentReply,
        })}
        run={demoDashboard.runs[0]}
      />,
    );
    const textarea = container.querySelector<HTMLTextAreaElement>(".issue-message-composer textarea");
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, userMessage.body);
      textarea.dispatchEvent(new Event("input", {
        bubbles: true
      }));
    });
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter"
      }));
      await Promise.resolve();
    });
    const userMessageGroup = Array.from(container.querySelectorAll<HTMLElement>(".issue-message-group")).find(group => group.textContent?.includes(userMessage.body));
    expectPendingAgentReplyLoader(userMessageGroup);
    await act(async () => {
      rejectAgentReply(new Error("worker unavailable"));
      await pendingAgentReply.catch(() => undefined);
    });
    const errorState = userMessageGroup?.querySelector(":scope > .issue-agent-reply-state.error");
    expect(errorState?.textContent).toContain("Agent 답변을 생성하지 못했습니다: worker unavailable");
    expect(errorState?.querySelector("[data-testid='loading-state']")).toBeNull();
    expect(errorState?.querySelector(".spin")).toBeNull();
    expect(errorState?.querySelector("svg")).not.toBeNull();
    await cleanup();
  });
  it("sends the selected member id with an issue conversation mention", async () => {
    const createdAt = new Date().toISOString();
    let sentInput: {
      body: string;
      parentMessageId: string | null;
      mentionedUserIds?: string[];
      mentionedAgentIds?: string[];
    } | undefined;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        mentionMembers={[{
          userId: "member-1",
          name: "Member One",
          email: "member@example.com",
          image: null,
          role: "member",
          createdAt,
        }]}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async input => {
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
    const textarea = container.querySelector<HTMLTextAreaElement>(".issue-message-composer textarea");
    await act(async () => {
      textarea?.focus();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "@mem");
      textarea.dispatchEvent(new Event("input", {
        bubbles: true
      }));
    });
    const suggestion = container.querySelector<HTMLButtonElement>('[role="option"]');
    expect(suggestion?.textContent).toContain("@member");
    await act(async () => suggestion?.click());
    expect(textarea?.value).toBe("@member ");
    const composerMention = container.querySelector<HTMLButtonElement>(".issue-composer-field .conversation-mention-button[data-mention-handle='member']");
    expect(composerMention?.textContent).toBe("@member");
    await act(async () => composerMention?.click());
    expect(document.body.querySelector<HTMLElement>(".profile-dialog")?.textContent).toContain("Member One");
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "@member 확인해 주세요");
      textarea.dispatchEvent(new Event("input", {
        bubbles: true
      }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter"
      }));
      await Promise.resolve();
    });
    expect(sentInput).toEqual({
      body: "@member 확인해 주세요",
      clientMessageId: expect.any(String),
      parentMessageId: null,
      mentionedUserIds: ["member-1"],
      mentionedAgentIds: []
    });
    await cleanup();
  });
});
