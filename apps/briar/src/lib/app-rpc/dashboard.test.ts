import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DashboardRun_Source,
  DashboardRunSchema,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { describe, expect, it } from "vitest";
import { dashboardRunFromProto } from "./dashboard";
import { workflowToProto } from "./project-configuration-mappers";

describe("Dashboard Connect DTO mapping", () => {
  it("keeps Team and planning Project identity on dashboard runs", () => {
    const occurredAt = timestampFromDate(new Date("2026-09-02T12:00:00.000Z"));
    const run = dashboardRunFromProto(create(DashboardRunSchema, {
      id: "run-1",
      workspaceId: "workspace-1",
      teamId: "team-1",
      planningProjectId: "planning-1",
      planningProjectName: "General",
      runNumber: 12,
      currentAttempt: 1,
      currentRevision: 1,
      source: DashboardRun_Source.ISSUE,
      sourceKey: "briar-issue:run-1",
      title: "Restore issue identity",
      status: RunStatus.QUEUED,
      workflow: workflowToProto({
        version: 2,
        requirements: [],
        stages: [{ id: "analyzing", label: "Analyze", required: true }],
        execution: { checkpoints: [] },
        completion: { requiredStages: ["analyzing"] },
      }),
      progress: 5,
      repository: "wordbricks/briar",
      startedAt: occurredAt,
      updatedAt: occurredAt,
      lastEventAt: occurredAt,
      eventCount: 1,
    }));

    expect(run).toMatchObject({
      id: "run-1",
      workspaceId: "workspace-1",
      teamId: "team-1",
      projectId: "planning-1",
      projectName: "General",
    });
  });
});
