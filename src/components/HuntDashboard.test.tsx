import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import { CreateIssueDialog, HuntDashboard } from "./HuntDashboard";

describe("HuntDashboard", () => {
  it("offers issue creation from the work queue", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        dashboard={null}
        demoMode={false}
        error={null}
        isCreatingIssue={false}
        isSidebarOpen
        onCreateIssue={async () => undefined}
        onRefresh={() => undefined}
        onSidebarOpen={() => undefined}
      />,
    );

    expect(markup).toContain("이슈 만들기");
  });

  it("uses Jelly Select for issue priority", () => {
    const markup = renderToStaticMarkup(
      <CreateIssueDialog
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={async () => undefined}
      />,
    );

    expect(markup).toContain('<jelly-select class="issue-priority-select" label="우선순위"');
    expect(markup).not.toContain("<select");
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
        dashboard={claimedDashboard}
        demoMode={false}
        error={null}
        isCreatingIssue={false}
        isSidebarOpen
        onCreateIssue={async () => undefined}
        onRefresh={() => undefined}
        onSidebarOpen={() => undefined}
      />,
    );

    expect(markup).toContain("briar-auto-hunt 할당");
  });
});
