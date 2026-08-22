import { describe, expect, it } from "vitest";
import { buildStatusTrayItems } from "./status-tray";
import type { StatusTrayRun } from "../types";

function run(
  partial: Partial<StatusTrayRun> & Pick<StatusTrayRun, "id" | "title">,
): StatusTrayRun {
  return {
    projectId: "project-1",
    projectName: "Briar",
    status: "running",
    workflowStage: partial.workflowStage ?? "implementing",
    workflowStageLabel: partial.workflowStageLabel ?? "구현",
    startedAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T01:00:00.000Z",
    lastEventAt: "2026-08-03T01:00:00.000Z",
    ...partial,
  };
}

describe("status tray snapshot builders", () => {
  it("sorts running issue projections by most recent activity", () => {
    const items = buildStatusTrayItems([
      run({
        id: "older",
        title: "Older running",
        updatedAt: "2026-08-03T01:00:00.000Z",
      }),
      run({
        id: "newer",
        title: "Newer running",
        workflowStage: "analyzing",
        workflowStageLabel: "분석",
        updatedAt: "2026-08-03T02:00:00.000Z",
      }),
    ]);

    expect(items.map((item) => item.runId)).toEqual(["newer", "older"]);
    expect(items[0]).toMatchObject({
      projectId: "project-1",
      projectName: "Briar",
      title: "Newer running",
      statusLabel: "분석",
    });
  });

  it("includes running issues from every project and keeps project groups separate", () => {
    const items = buildStatusTrayItems([
      run({ id: "briar-run", title: "Briar issue" }),
      run({
        id: "crane-run",
        title: "Crane issue",
        projectId: "project-2",
        projectName: "Crane",
      }),
    ]);

    expect(
      items.map(({ projectId, projectName, runId }) => ({
        projectId,
        projectName,
        runId,
      })),
    ).toEqual([
      { projectId: "project-1", projectName: "Briar", runId: "briar-run" },
      { projectId: "project-2", projectName: "Crane", runId: "crane-run" },
    ]);
  });

});
