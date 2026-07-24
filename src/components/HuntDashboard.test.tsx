/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { AutoHuntHealth } from "../lib/project-connection";
import {
  CreateIssueDialog,
  HuntDashboard,
  RunPage,
} from "./HuntDashboard";

const dashboardProps = {
  error: null,
  health: null,
  healthError: null,
  healthLoading: false,
  isCreatingIssue: false,
  recoveringRunId: null,
  recoveryError: null,
  isSidebarOpen: true,
  onCreateIssue: async () => undefined,
  onHealthRefresh: () => undefined,
  onLoadAttachment: async () => new Blob(),
  onMoveRun: async () => undefined,
  onReconnect: () => undefined,
  onRetryRun: async () => undefined,
  onCancelRun: async () => undefined,
  onRepair: () => undefined,
  onSidebarOpen: () => undefined,
};

const healthyHealth: AutoHuntHealth = {
  projectId: "project-1",
  healthy: true,
  repositoryPath: "/Users/jay/git/briar",
  repositoryRemote: "https://github.com/wordbricks/briar.git",
  repositoryHealthy: true,
  cliPath: "/Users/jay/.local/bin/briar",
  cliInstalled: true,
  cliVersion: "0.2.0",
  cliExpectedVersion: "0.2.0",
  cliCurrent: true,
  skillPath: "/Users/jay/.codex/skills/briar-auto-hunt",
  skillInstalled: true,
  skillVersion: "0.2.0",
  skillExpectedVersion: "0.2.0",
  skillCurrent: true,
  velenOrg: "wordbricks",
  velenAuthenticated: true,
  velenEmail: "jay@example.com",
  velenHealthy: true,
  issues: [],
};

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

  it("uses the kanban as the full dashboard surface", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    );

    expect(markup).not.toContain("queue-panel");
    expect(markup).toContain('class="dashboard-scroll"><div class="queue-header"');
    expect(markup).toContain('class="kanban-board"');
    expect(markup).not.toContain('class="page-heading"');
    expect(markup).not.toContain('class="metric-grid"');
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
    expect(markup).toContain('class="companion-bottom-nav"');
    expect(markup).toContain('class="companion-fab"');
    expect(markup).toContain("<strong>Inbox</strong>");
    expect(markup).not.toContain('class="companion-search-trigger"');
    expect(markup).not.toContain('class="status-tabs"');
  });

  it("uses Jelly Select for issue priority and accepts image or video files", () => {
    const markup = renderToStaticMarkup(
      <CreateIssueDialog
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={async () => undefined}
      />,
    );

    expect(markup).toContain('<jelly-select class="issue-priority-select" label="우선순위"');
    expect(markup).not.toContain("<select");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('aria-label="이미지 또는 영상 첨부"');
    expect(markup).toContain("video/quicktime");
    expect(markup).toContain("이미지는 ⌘V");
    expect(markup).toContain("생성 즉시 작업 큐");
  });

  it("shows an active queue claim", () => {
    const claimedDashboard = {
      ...demoDashboard,
      runs: [
        {
          ...demoDashboard.runs[0],
          status: "queued" as const,
          workflowStage: null,
          claimedBy: "briar-auto-hunt",
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

    expect(markup).toContain("briar-auto-hunt 할당");
  });

  it("renders workflow stages as kanban columns", () => {
    const customWorkflow = {
      version: 1 as const,
      preset: "custom" as const,
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "security_review", label: "Security review", required: true },
      ],
      completion: { requiredStages: ["analyzing", "security_review"] },
      release: { enabled: false },
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
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain('aria-label="차단"');
    expect(markup).toContain('aria-label="실패"');
    expect(markup).toContain('aria-label="취소"');
  });

  it("opens issue details as a page and returns to the kanban", async () => {
    const container = document.createElement("div");
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

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-back")?.click();
    });

    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("shows Auto Hunt health as a compact topbar status trigger", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={null}
        health={healthyHealth}
      />,
    );

    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain("Auto Hunt 연결 상태: 실행 준비 완료");
    expect(markup).not.toContain("D1 연결됨");
    expect(markup).not.toContain("health-panel");
    expect(markup).not.toContain("Briar CLI");
  });

  it("shows attempt-aware recovery actions for failed runs", () => {
    const failedRun = {
      ...demoDashboard.runs[0],
      status: "failed" as const,
      currentAttempt: 2,
      detail: "Worker deployment timed out",
      events: [
        {
          ...demoDashboard.runs[0].events[0],
          status: "failed" as const,
          attempt: 2,
          detail: "Worker deployment timed out",
        },
        ...demoDashboard.runs[0].events,
      ],
    };
    const markup = renderToStaticMarkup(
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSidebarOpen={() => undefined}
        run={failedRun}
      />,
    );

    expect(markup).toContain("실행이 실패했습니다");
    expect(markup).toContain("3번 시도로 새 작업이 시작됩니다");
    expect(markup).toContain("재시도");
    expect(markup).toContain("작업 취소");
    expect(markup).toContain("시도 2");
    expect(markup).toContain('<label class="run-status-control">');
    expect(markup).toContain('<option value="status:queued">대기</option>');
    expect(markup).toContain('<option value="status:completed">완료</option>');
  });
});
