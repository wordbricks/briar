import { describe, expect, it } from "vitest";
import type {
  HuntRunRow,
  IssueHierarchyRow,
  IssueRelationRow,
} from "./db";
import { dashboardRunJson } from "./dashboard-json";

const run = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  planning_project_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  run_number: 3,
  current_attempt: 1,
  current_revision: 1,
  source: "issue",
  source_key: "briar-issue:test",
  title: "Current issue",
  status: "backlog",
  workflow_stage: null,
  workflow_snapshot_json: JSON.stringify({
    version: 2,
    requirements: [],
    stages: [{ id: "implementing", label: "Implement", required: true }],
    execution: { checkpoints: [] },
    completion: { requiredStages: ["implementing"] },
  }),
  issue_checkpoints_json: "[]",
  context_json: null,
  paused_at: null,
  resume_requested_at: null,
  waiting_checkpoint_key: null,
  waiting_checkpoint_revision: null,
  subscribers_json: "[]",
  pull_request_urls: "[]",
  structured_result_json: null,
  execution_metrics_json: null,
} as unknown as HuntRunRow;

const hierarchy = [{
  parent_run_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  child_run_id: run.id,
  parent_run_number: 1,
  parent_title: "Parent",
  parent_status: "running",
  parent_paused_at: null,
  child_run_number: run.run_number,
  child_title: run.title,
  child_status: run.status,
  child_paused_at: null,
}, {
  parent_run_id: run.id,
  child_run_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  parent_run_number: run.run_number,
  parent_title: run.title,
  parent_status: run.status,
  parent_paused_at: null,
  child_run_number: 4,
  child_title: "Sub issue",
  child_status: "completed",
  child_paused_at: null,
}] as IssueHierarchyRow[];

const relations = [{
  first_run_id: run.id,
  second_run_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  first_run_number: run.run_number,
  first_title: run.title,
  first_status: run.status,
  first_paused_at: null,
  second_run_number: 8,
  second_title: "Related issue",
  second_status: "blocked",
  second_paused_at: null,
}] as IssueRelationRow[];

describe("dashboard relationship projection", () => {
  it("projects hierarchy and related issues without changing execution readiness", () => {
    const projected = dashboardRunJson(
      run,
      [],
      [],
      [],
      hierarchy,
      relations,
    );

    expect(projected).toMatchObject({
      parent: { title: "Parent", status: "running" },
      subIssues: [{ title: "Sub issue", status: "completed" }],
      relatedIssues: [{ title: "Related issue", status: "blocked" }],
      prerequisites: [],
      executionReadiness: "ready",
      waitingOnPrerequisiteCount: 0,
    });
  });
});
