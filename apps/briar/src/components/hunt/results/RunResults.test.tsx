/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../../../test/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "@/types";
import { demoDashboard, demoRunEvents } from "@/lib/demo-data";
import * as api from "@/lib/api";
import * as channelRealtime from "@/lib/channel-realtime";
import * as issueActivityHook from "@/hooks/use-issue-agent-activity";
import type { ExecutionWorker, HuntRun, IssueMessage, IssueMessageSendResult, ProjectAgent, RunEvidence, UpdateIssueInput } from "@/types";
import { HuntDashboard } from "@/components/hunt/HuntDashboard";
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
describe("RunResults", () => {
  it("loads collected evidence in the issue evidence tab", async () => {
    const observedAt = "2026-07-28T04:30:00.000Z";
    const evidence: RunEvidence[] = [{
      key: "BRIAR-12:analyzing:repository_findings",
      attempt: 1,
      revision: 1,
      stage: "analyzing",
      type: "repository_findings",
      status: "passed",
      detail: "증빙 조회 경로와 화면 연결 지점을 확인했습니다.",
      command: "bun run test src/components/HuntDashboard.test.tsx",
      url: "https://example.com/evidence/1",
      metadata: {
        suite: "dashboard"
      },
      actor: "briar-workflow",
      observedAt,
      recordedAt: observedAt,
      requiredRevision: 1,
      canonical: true
    }];
    const onLoadRunEvidence = vi.fn(async () => evidence);
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
            stages: demoDashboard.runs[0].workflow.stages.map(stage =>
              stage.id === "analyzing"
                ? {
                  ...stage,
                  evidence: ["repository_findings"],
                }
                : stage.id === "local_qa"
                ? {
                  ...stage,
                  evidence: ["local_ci_result"],
                }
                : stage
            ),
          },
        }}
      />,
    );
    const evidenceTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent?.includes("증빙"));
    await act(async () => evidenceTab?.click());
    expect(onLoadRunEvidence).toHaveBeenCalledOnce();
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain("repository_findings");
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain("증빙 조회 경로와 화면 연결 지점을 확인했습니다.");
    expect(container.querySelector(".run-evidence-command code")?.textContent).toContain("HuntDashboard.test.tsx");
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain("local_ci_result");
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain("기록 안 됨");
    await cleanup();
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
      url: "/projects/project-1/runs/run-1/evidence/images/image-1"
    };
    const staleImage = {
      ...image,
      id: "image-stale",
      filename: "stale-dashboard.png",
      url: "/projects/project-1/runs/run-1/evidence/images/image-stale"
    };
    const failedImage = {
      ...image,
      id: "image-failed",
      filename: "failed-dashboard.png",
      url: "/projects/project-1/runs/run-1/evidence/images/image-failed"
    };
    const evidence: RunEvidence[] = [{
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
      canonical: true
    }, {
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
      canonical: false
    }, {
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
      canonical: true
    }];
    const onLoadImage = vi.fn(async () => new Blob(["image"], {
      type: "image/png"
    }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:result-screenshot")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
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
    expect(onLoadImage).toHaveBeenCalledTimes(1);
    expect(onLoadImage).toHaveBeenCalledWith(image);
    expect(onLoadImage).not.toHaveBeenCalledWith(staleImage);
    expect(onLoadImage).not.toHaveBeenCalledWith(failedImage);
    expect(container.querySelector(".run-result-screenshots .run-evidence-image img")?.getAttribute("src")).toBe("blob:result-screenshot");
    expect(container.querySelectorAll(".run-result-screenshots .run-evidence-image")).toHaveLength(1);
    expect(container.querySelector(".run-result-screenshots")?.textContent).toContain("결과 화면");
    expect(container.querySelector(".completed-issue-card")?.contains(container.querySelector(".run-result-screenshots"))).toBe(true);
    const enlargeButton = container.querySelector<HTMLButtonElement>('.run-result-screenshots [aria-label="finished-dashboard.png 크게 보기"]');
    expect(enlargeButton).not.toBeNull();
    expect(container.querySelector(".run-result-screenshots .run-evidence-image a")).toBeNull();
    await act(async () => enlargeButton?.click());
    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe("blob:result-screenshot");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("finished-dashboard.png");
    const download = document.querySelector<HTMLAnchorElement>('[role="dialog"] .image-lightbox-download');
    expect(download?.download).toBe("finished-dashboard.png");
    expect(download?.getAttribute("href")).toBe("blob:result-screenshot");
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const evidenceTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent?.includes("증빙"));
    await act(async () => evidenceTab?.click());
    expect(onLoadImage).toHaveBeenCalledWith(image);
    expect(onLoadImage).toHaveBeenCalledWith(staleImage);
    expect(onLoadImage).toHaveBeenCalledWith(failedImage);
    expect(container.querySelector(".run-evidence-image img")?.getAttribute("src")).toBe("blob:result-screenshot");
    expect(container.querySelector(".run-evidence-images")?.textContent).toContain("결과 화면");
    await cleanup();
  });
  it("reloads result screenshots when the open issue changes", async () => {
    const observedAt = "2026-07-28T04:30:00.000Z";
    const firstRun = {
      ...demoDashboard.runs[0],
      id: "run-result-first",
      sourceKey: "BRIAR-101",
      status: "completed" as const,
      resultSummary: "첫 번째 이슈 결과입니다."
    };
    const secondRun = {
      ...firstRun,
      id: "run-result-second",
      sourceKey: "BRIAR-102",
      resultSummary: "두 번째 이슈 결과입니다."
    };
    const evidenceFor = (run: HuntRun): RunEvidence[] => [{
      key: `${run.sourceKey}:local_qa:ui_result`,
      attempt: 1,
      revision: 1,
      stage: "local_qa",
      type: "ui_result",
      status: "passed",
      detail: `${run.sourceKey} 화면입니다.`,
      command: null,
      url: null,
      metadata: null,
      actor: "briar-workflow",
      observedAt,
      recordedAt: observedAt,
      images: [{
        id: `image-${run.id}`,
        filename: `${run.id}.png`,
        contentType: "image/png",
        byteSize: 1024,
        sha256: run.id,
        position: 0,
        url: `/projects/project-1/runs/${run.id}/evidence/images/image-${run.id}`
      }],
      requiredRevision: 1,
      canonical: true
    }];
    const evidenceLoads: string[] = [];
    const onLoadImage = vi.fn(async () => new Blob(["image"], {
      type: "image/png"
    }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValueOnce("blob:first-result-screenshot").mockReturnValueOnce("blob:second-result-screenshot")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renderPage = (run: HuntRun) => <RunPage isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={async () => []} onLoadRunEvidence={async () => {
      evidenceLoads.push(run.id);
      return evidenceFor(run);
    }} onLoadRunEvidenceImage={onLoadImage} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
      throw new Error("not implemented in this test");
    }} run={run} />;
    await renderReactTestRoot(root, renderPage(firstRun));
    expect(container.querySelector(".run-result-screenshots .run-evidence-image img")?.getAttribute("src")).toBe("blob:first-result-screenshot");
    await renderReactTestRoot(root, renderPage(secondRun));
    expect(evidenceLoads).toEqual([firstRun.id, secondRun.id]);
    expect(container.textContent).not.toContain(`${firstRun.id}.png`);
    expect(container.textContent).toContain(`${secondRun.id}.png`);
    expect(container.querySelector(".run-result-screenshots .run-evidence-image img")?.getAttribute("src")).toBe("blob:second-result-screenshot");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first-result-screenshot");
    await cleanup();
  });
  it("shows result reviewers in the result and properties panels and records the current member", async () => {
    const onCompleteResultReview = vi.fn(async () => undefined);
    const completedRun = {
      ...demoDashboard.runs[0],
      status: "completed" as const,
      resultSummary: "검수할 작업 결과입니다.",
      resultReviews: [{
        userId: "reviewer-1",
        name: "민지 김",
        username: "minji",
        image: "https://example.com/minji.png",
        completedAt: "2026-08-02T01:00:00.000Z"
      }]
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
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
    );
    expect(container.querySelector(".run-result-review")?.textContent).toContain("@minji");
    expect(container.querySelector(".completed-issue-card-heading .status-pill.reviewed")).not.toBeNull();
    expect(container.querySelector(".completed-issue-card-heading .status-pill-review-icon")).not.toBeNull();
    expect(container.querySelector(".run-page-property-select.reviewed")).not.toBeNull();
    const reviewButton = container.querySelector<HTMLButtonElement>(".run-result-review-complete");
    expect(reviewButton?.textContent).toContain("검수 완료");
    await act(async () => reviewButton?.click());
    expect(onCompleteResultReview).toHaveBeenCalledOnce();
    await act(async () => container.querySelector<HTMLButtonElement>(".run-page-properties-toggle")?.click());
    const reviewProperty = container.querySelector(".run-result-review-property");
    expect(reviewProperty?.getAttribute("aria-label")).toContain("@minji");
    expect(reviewProperty?.querySelector("img")?.getAttribute("src")).toBe("https://example.com/minji.png");
    await cleanup();
  });
});
