import {
  autoHuntPersistedRunStatuses,
  autoHuntQaStatuses,
  dashboardStages,
  type AutoHuntQaStatus,
  type AutoHuntPersistedRunStatus,
  type AutoHuntSource,
  type DashboardStage,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import type { StructuredAgentResult } from "../../src/lib/agent-result";
import type { IssueDifficulty } from "../../src/lib/issue-difficulty";
import * as Schema from "effect/Schema";

import {
  type ModelEffort,
  type ProjectAgentProvider,
} from "./project-agent-model";

export const HuntEventRow = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  run_id: Schema.mutableKey(Schema.String),
  event_key: Schema.mutableKey(Schema.String),
  attempt: Schema.mutableKey(Schema.Int),
  revision: Schema.mutableKey(Schema.Int),
  stage: Schema.mutableKey(Schema.Literals(dashboardStages)),
  status: Schema.mutableKey(Schema.Literals(autoHuntPersistedRunStatuses)),
  workflow_stage: Schema.mutableKey(Schema.NullOr(Schema.String)),
  detail: Schema.mutableKey(Schema.NullOr(Schema.String)),
  actor: Schema.mutableKey(Schema.String),
  branch: Schema.mutableKey(Schema.NullOr(Schema.String)),
  commit_sha: Schema.mutableKey(Schema.NullOr(Schema.String)),
  qa_status: Schema.mutableKey(
    Schema.NullOr(Schema.Literals(autoHuntQaStatuses)),
  ),
  tracker_issue_state: Schema.mutableKey(Schema.NullOr(Schema.String)),
  pull_request_urls: Schema.mutableKey(Schema.String),
  target_sha: Schema.mutableKey(Schema.NullOr(Schema.String)),
  occurred_at: Schema.mutableKey(Schema.String),
  recorded_at: Schema.mutableKey(Schema.String),
});
export type HuntEventRow = typeof HuntEventRow.Type;

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
  difficulty?: IssueDifficulty | null;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerInput;
  issueDescription: string | null;
  assigneeUserId?: string | null;
  issueCheckpoints?: AutoHuntWorkflowCheckpoint[];
  fullAuto?: boolean;
  requiresClaimToken?: boolean;
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
