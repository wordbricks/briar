import {
  type AutoHuntQaStatus,
  type AutoHuntPersistedRunStatus,
  type AutoHuntSource,
  type DashboardStage,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";

import {
  type ModelEffort,
  type ProjectAgentProvider,
} from "./project-agent-model";
import type { IssueDifficulty } from "../../src/lib/issue-difficulty";

export type HuntRunRow = {
  id: string;
  run_number: number;
  source: AutoHuntSource;
  source_key: string;
  title: string;
  stage: DashboardStage;
  status: AutoHuntPersistedRunStatus;
  workflow_stage: AutoHuntWorkflowStageId | null;
  workflow_snapshot_json: string;
  issue_checkpoints_json: string;
  detail: string | null;
  priority: number | null;
  difficulty: IssueDifficulty | null;
  assignee_user_id: string | null;
  created_by_user_id?: string | null;
  subscribers_json?: string;
  repository: string;
  branch: string | null;
  commit_sha: string | null;
  tracker_provider: string | null;
  tracker_issue_id: string | null;
  tracker_issue_identifier: string | null;
  tracker_issue_url: string | null;
  tracker_issue_state: string | null;
  issue_description: string | null;
  result_summary: string | null;
  structured_result_json: string | null;
  execution_metrics_json: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  source_created_at: string | null;
  staging_qa_status: AutoHuntQaStatus | null;
  production_qa_status: AutoHuntQaStatus | null;
  staging_qa_detail: string | null;
  production_qa_detail: string | null;
  context_json: string | null;
  current_attempt: number;
  current_revision: number;
  claim_token_hash: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  claim_attempts: number;
  planned_update_resume: number;
  last_execution_id: string | null;
  paused_at: string | null;
  resume_requested_at: string | null;
  waiting_checkpoint_key: string | null;
  waiting_checkpoint_revision: number | null;
  agent_id: string | null;
  preferred_agent_provider: ProjectAgentProvider | null;
  preferred_agent_model: string | null;
  preferred_agent_effort: ModelEffort | null;
  requested_agent_provider: ProjectAgentProvider | null;
  requested_agent_model: string | null;
  requested_agent_effort: ModelEffort | null;
  requested_worker_id: string | null;
  requested_by_user_id: string | null;
  dispatch_mode: "any" | "specific" | null;
  dispatch_request_id: string | null;
  dispatched_at: string | null;
  worker_id: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_event_at: string;
  event_count: number;
};

export const statusForDashboardStage = (
  stage: DashboardStage,
): AutoHuntPersistedRunStatus => {
  if (stage === "queued") return "queued";
  if (["blocked", "failed", "completed", "cancelled"].includes(stage)) {
    return stage as AutoHuntPersistedRunStatus;
  }
  return "running";
};

export const workflowStageForDashboardStage = (
  stage: DashboardStage,
): AutoHuntWorkflowStageId | null => {
  if (
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(stage)
  ) {
    return stage as AutoHuntWorkflowStageId;
  }
  return null;
};

export const dashboardStageFor = (
  status: AutoHuntPersistedRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
): DashboardStage => {
  if (status === "backlog") return "queued";
  if (status !== "running") return status;
  return workflowStage &&
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(workflowStage)
    ? (workflowStage as DashboardStage)
    : "implementing";
};
