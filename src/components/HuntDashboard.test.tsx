import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
