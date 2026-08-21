import {
  type AutoHuntQaStatus,
  type AutoHuntPersistedRunStatus,
  type AutoHuntSource,
  type DashboardStage,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import type { StructuredAgentResult } from "../../src/lib/agent-result";
import {
  type ModelEffort,
  type ProjectAgentProvider,
} from "./project-agent-model";


export type HuntEventRow = {
  id: string;
  run_id: string;
  event_key: string;
  attempt: number;
  revision: number;
  stage: DashboardStage;
  status: AutoHuntPersistedRunStatus;
  workflow_stage: AutoHuntWorkflowStageId | null;
  detail: string | null;
  actor: string;
  branch: string | null;
  commit_sha: string | null;
  qa_status: AutoHuntQaStatus | null;
  tracker_issue_state: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  occurred_at: string;
  recorded_at: string;
};

export type TrackerInput = {
  provider: string;
  issueId: string | null;
  identifier: string | null;
  url: string | null;
  state: string | null;
} | null;

export type HuntEventInput = {
  source: AutoHuntSource;
  sourceKey: string;
  title: string;
  stage: DashboardStage;
  status?: AutoHuntPersistedRunStatus;
  workflowStage?: AutoHuntWorkflowStageId | null;
  eventKey: string;
  occurredAt: string;
  actor: string;
  repository: string;
  detail: string | null;
  priority: number | null;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerInput;
  issueDescription: string | null;
  assigneeUserId?: string | null;
  issueCheckpoints?: AutoHuntWorkflowCheckpoint[];
  fullAuto?: boolean;
  resultSummary: string | null;
  structuredResult: StructuredAgentResult | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  sourceCreatedAt: string | null;
  qaStatus: "pending" | null;
  stagingQaDetail: string | null;
  productionQaDetail: string | null;
  context: Record<string, unknown> | null;
  postInsertIssueDescription?: string | null;
  createdByUserId?: string | null;
  preferredAgentProvider?: ProjectAgentProvider | null;
  preferredAgentModel?: string | null;
  preferredAgentEffort?: ModelEffort | null;
};
