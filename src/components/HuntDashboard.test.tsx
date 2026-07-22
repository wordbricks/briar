import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { AutoHuntHealth } from "../lib/project-connection";
import {
  ConnectionHealth,
  CreateIssueDialog,
  HuntDashboard,
  RunDialog,
} from "./HuntDashboard";

const dashboardProps = {
  demoMode: false,
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
  onReconnect: () => undefined,
  onRetryRun: async () => undefined,
  onCancelRun: async () => undefined,
  onRepair: () => undefined,
  onRefresh: () => undefined,
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
          stage: "queued" as const,
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

  it("shows local Auto Hunt health and repair actions", () => {
    const markup = renderToStaticMarkup(
      <ConnectionHealth
        error={null}
        health={{
          ...healthyHealth,
          healthy: false,
          cliCurrent: false,
          cliVersion: "0.0.9",
          issues: ["Briar CLI 버전이 앱 번들과 다릅니다."],
        }}
        loading={false}
        onReconnect={() => undefined}
        onRefresh={() => undefined}
        onRepair={() => undefined}
      />,
    );

    expect(markup).toContain("Auto Hunt 연결 상태");
    expect(markup).toContain("CLI·스킬 복구");
    expect(markup).toContain("v0.0.9");
    expect(markup).toContain("Briar CLI 버전이 앱 번들과 다릅니다.");
  });

  it("shows attempt-aware recovery actions for failed runs", () => {
    const failedRun = {
      ...demoDashboard.runs[0],
      stage: "failed" as const,
      currentAttempt: 2,
      detail: "Worker deployment timed out",
      events: [
        {
          ...demoDashboard.runs[0].events[0],
          stage: "failed" as const,
          attempt: 2,
          detail: "Worker deployment timed out",
        },
        ...demoDashboard.runs[0].events,
      ],
    };
    const markup = renderToStaticMarkup(
      <RunDialog
        error={null}
        isRecovering={false}
        onCancel={async () => undefined}
        onClose={() => undefined}
        onLoadAttachment={async () => new Blob()}
        onRetry={async () => undefined}
        run={failedRun}
      />,
    );

    expect(markup).toContain("실행이 실패했습니다");
    expect(markup).toContain("3번 시도로 새 작업이 시작됩니다");
    expect(markup).toContain("재시도");
    expect(markup).toContain("작업 취소");
    expect(markup).toContain("시도 2");
  });
});
