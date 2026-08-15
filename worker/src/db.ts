import {
  isTerminalTrackerState,
  additionalWorkflowCheckpoints,
  isRepositoryWorkflowPending,
  canonicalizeCheckpointSet,
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  requiredWorkflowStages,
  repositoryWorkflowBootstrap,
  workflowCheckpointAt,
  workflowWithAdditionalCheckpoints,
  type AutoHuntQaStatus,
  type AutoHuntPersistedRunStatus,
  type AutoHuntRunStatus,
  type AutoHuntSource,
  type DashboardStage,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowCheckpointPosition,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import type { StructuredAgentResult } from "../../src/lib/agent-result";
import { inboxSessionMessageVersion } from "../../src/lib/inbox-session-version";
import type { AgentExecutionCostRecord } from "../../src/lib/agent-execution-cost";
import type {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "../../src/lib/agent-execution-metrics";
import {
  defaultProjectAgentCalendarColor,
  defaultProjectAgentCopy,
  projectAgentSkill,
  type ProjectAgentLocale,
} from "../../src/lib/project-agent";
import {
  nextProjectAgentScheduleRunAt,
  parseProjectAgentScheduleDays,
  serializeProjectAgentScheduleDays,
  type ProjectAgentScheduleIntervalUnit,
  type ProjectAgentScheduleNotificationLevel,
  type ProjectAgentScheduleRecurrence,
} from "../../src/lib/project-agent-schedule";
import {
  assertAgentSkillReplacementAllowed,
  hydrateAgentSkills,
  insertAgentSkillStatement,
  listAgentSkills,
  normalizedAgentSkillRows,
  replaceAgentSkillStatements,
  soleAgentSkillRowFromLegacy,
  type AgentSkillEffort,
  type AgentSkillInput,
  type AgentSkillKind,
  type AgentSkillProvider,
  type AgentSkillRow,
} from "./agent-skills";
import { workflowSnapshotForRun } from "./workflow-policy";

type ProjectAgentProvider = AgentSkillProvider;
type ModelEffort = AgentSkillEffort;

export type ProjectRow = {
  id: string;
  name: string;
  issue_key_prefix: string;
  icon: string | null;
  organization_id: string;
  organization_name: string;
  member_role: OrganizationRole;
  created_at: string;
};

export type OrganizationRole = "owner" | "admin" | "member";
export type OrganizationRow = {
  id: string;
  name: string;
  handle: string;
  logo: string | null;
  role: OrganizationRole;
  created_at: string;
};
export type OrganizationMemberRow = {
  user_id: string;
  name: string;
  email: string;
  image: string | null;
  role: OrganizationRole;
  created_at: string;
};

export type OrganizationInvitationRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  initial_project_id: string;
  initial_project_name: string;
  email_normalized: string;
  role: Exclude<OrganizationRole, "owner">;
  invited_by_user_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountDeletionPlan = {
  blockedOrganizations: Array<{ id: string; name: string }>;
  organizationIds: string[];
  projectIds: string[];
};

export type SlackInstallationRow = {
  team_id: string;
  team_name: string;
  organization_id: string;
  default_project_id: string | null;
  default_project_name: string | null;
  bot_user_id: string;
  encrypted_bot_token: string;
  token_iv: string;
  installed_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type SlackRevocationQueueRow = {
  id: string;
  team_id: string;
  encrypted_bot_token: string;
  token_iv: string;
  queued_at: string;
  next_attempt_at: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  dead_lettered_at: string | null;
  dead_letter_reason: string | null;
};

export type SlackOAuthStateRow = {
  state_hash: string;
  organization_id: string;
  default_project_id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

export type GithubConnectionStatus = "connected" | "disconnected";

export type GithubConnectionRow = {
  installation_id: number;
  organization_id: string;
  installation_account_id: number;
  account_login: string;
  account_avatar_url: string;
  authorized_github_user_id: number;
  authorized_github_user_login: string;
  connected_by_user_id: string | null;
  status: GithubConnectionStatus;
  connected_at: string;
  disconnected_at: string | null;
  updated_at: string;
};

export type GithubConnectionRepositoryRow = {
  installation_id: number;
  repository_id: number;
  owner: string;
  name: string;
  full_name: string;
  created_at: string;
  updated_at: string;
};

export type GithubOAuthStateRow = {
  state_hash: string;
  organization_id: string;
  user_id: string;
  pkce_verifier: string;
  installation_id: number | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type GithubPullRequestState = "unknown" | "open" | "closed" | "merged";

export type RunPullRequestRow = {
  project_id: string;
  run_id: string;
  attempt: number;
  revision: number;
  revision_started_at: string;
  url: string;
  installation_id: number | null;
  repository_id: number;
  repository: string;
  pull_request_id: number;
  pull_request_node_id: string;
  pull_request_number: number;
  state: GithubPullRequestState;
  draft: number | null;
  head_sha: string | null;
  base_sha: string | null;
  merge_commit_sha: string | null;
  opened_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  provider_updated_at: string | null;
  last_delivery_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GithubPullRequestSyncInput = {
  deliveryId: string;
  installationId: number | null;
  repositoryId: number;
  repository: string;
  pullRequestId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
  url: string;
  state: Exclude<GithubPullRequestState, "unknown">;
  draft: boolean;
  headSha: string;
  baseSha: string;
  mergeCommitSha: string | null;
  openedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  providerUpdatedAt: string;
  linkedIssues: Array<{ projectId: string; runId: string }>;
  actor: string;
  observedAt: string;
  /** Restricts a connected installation to runs in its Briar organization. */
  organizationId?: string | null;
};

export type ProjectSettingsRow = {
  project_id: string;
  velen_org: string | null;
  data_source: string | null;
  linear_enabled: number;
  linear_source: string | null;
  linear_team_key: string | null;
  github_repository: string | null;
  workflow_json: string;
  mandatory_checkpoints_json: string | null;
  checkpoint_policy_revision: number;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentRow = {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  avatar: string | null;
  avatar_pet_json: string | null;
  avatar_spritesheet_object_key: string | null;
  provider: ProjectAgentProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  responsibility: string;
  skill_markdown: string;
  calendar_color: string;
  created_at: string;
  updated_at: string;
  skills?: AgentSkillRow[];
};

export type ProjectAgentSessionRow = {
  project_id: string;
  id: string;
  agent_id: string | null;
  status: "running" | "completed" | "failed" | "skipped" | "interrupted";
  session_type: "task" | "dispatch";
  payload_json: string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type ProjectAgentSessionSummaryRow = {
  project_id: string;
  session_id: string;
  summary_json: string;
  updated_at: string;
  archived: number;
};

export type ProjectAgentSessionChangeRow = {
  version: number;
  session_id: string;
  operation: "upsert" | "delete";
};

export type ProjectAgentSessionChangesPage = {
  currentVersion: number;
  changes: ProjectAgentSessionChangeRow[];
  hasMore: boolean;
  nextCursor: number;
  expired: boolean;
};

export type ProjectAgentTaskJobRow = {
  id: string;
  project_id: string;
  agent_id: string;
  skill_id: string | null;
  request: string;
  request_id: string;
  status: "queued" | "running" | "completed" | "failed";
  preferred_worker_id: string;
  claimed_worker_id: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  skill_execution_proposal_id?: string | null;
  result_summary?: string | null;
  result_conversation_id?: string | null;
};

export type ProjectAgentTaskCompletionReceiptRow = {
  id: string;
  organization_id: string;
  project_id: string;
  task_id: string;
  skill_execution_proposal_id: string | null;
  worker_id: string;
  claim_token_hash: string;
  outcome_status: "queued" | "completed" | "failed";
  summary: string | null;
  conversation_id: string | null;
  error: string | null;
  completed_at: string;
  created_at: string;
};

export type ProjectAgentTaskCompletionResult = {
  job: ProjectAgentTaskJobRow | null;
  receipt: ProjectAgentTaskCompletionReceiptRow | null;
  replayed: boolean;
};

export type ClaimedProjectAgentTaskRow = ProjectAgentTaskJobRow & {
  agent_name: string;
  agent_provider: ProjectAgentProvider;
  agent_model: string | null;
  agent_effort: AgentSkillEffort | null;
  agent_responsibility: string;
  agent_skill: string;
  selected_skill_id: string;
  selected_skill_name: string;
  selected_skill_instructions: string;
  agent_skills: AgentSkillRow[];
};

export type ProjectAgentScheduleRow = {
  id: string;
  project_id: string;
  agent_id: string;
  agent_name: string;
  agent_provider: ProjectAgentProvider;
  name: string;
  recurrence: ProjectAgentScheduleRecurrence;
  frequency: ProjectAgentScheduleRecurrence | null;
  time_of_day: string;
  day_of_week: number | null;
  interval_value: number;
  interval_unit: ProjectAgentScheduleIntervalUnit;
  days_of_week: string | null;
  notification_level: ProjectAgentScheduleNotificationLevel;
  time_zone: string;
  enabled: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentScheduleRunStatus = "running" | "completed" | "failed";

export type ProjectAgentScheduleRunRow = {
  id: string;
  project_id: string;
  schedule_id: string;
  schedule_name: string;
  agent_id: string;
  agent_name: string;
  agent_provider: ProjectAgentProvider;
  agent_model: string | null;
  agent_effort: string | null;
  agent_responsibility: string;
  agent_skill_markdown: string;
  agent_skills: AgentSkillRow[];
  workflow_json: string;
  status: ProjectAgentScheduleRunStatus;
  scheduled_for: string;
  lease_expires_at: string | null;
  started_at: string;
  completed_at: string | null;
  result_summary: string | null;
  structured_result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

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

export type OrganizationStatusTrayRunRow = Pick<
  HuntRunRow,
  | "id"
  | "title"
  | "status"
  | "workflow_stage"
  | "workflow_snapshot_json"
  | "started_at"
  | "updated_at"
  | "last_event_at"
> & {
  project_id: string;
  project_name: string;
};

export type OrganizationUsageRunRow = {
  id: string;
  project_id: string;
  status: AutoHuntPersistedRunStatus;
  paused_at: string | null;
  execution_metrics_json: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_attempts: number;
  worker_id: string | null;
  preferred_agent_provider: ProjectAgentProvider | null;
  preferred_agent_model: string | null;
  requested_agent_provider: ProjectAgentProvider | null;
  requested_agent_model: string | null;
  execution_provider: ProjectAgentProvider | null;
  execution_model: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  has_usage_ledger?: number;
  source_created_at?: string | null;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
};

export type RunExecutionAttemptRow = {
  id: string;
  organization_id: string;
  project_id: string;
  run_id: string;
  run_attempt: number;
  claim_attempt: number;
  worker_id: string | null;
  claimed_by: string | null;
  claimed_at: string;
  recorded_at: string;
};

export type OrganizationUsageRecordRow = {
  execution_id: string;
  run_id: string;
  project_id: string;
  run_attempt: number;
  claim_attempt: number;
  worker_id: string | null;
  claimed_at: string;
  usage_key: string;
  session_id: string | null;
  turn_id: string | null;
  scope_id: string | null;
  agent_provider: ProjectAgentProvider;
  model_provider: string | null;
  model: string | null;
  canonical_model: string | null;
  model_source: AgentExecutionUsageRecord["modelSource"];
  source: string;
  uncached_input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  total_tokens: number | null;
  observed_at: string;
  recorded_at: string;
};

export type ProjectUsageTotalRow = {
  run_id: string;
  total_tokens: number;
  usage_records: number;
  observed_at: string;
};

export type OrganizationCostRecordRow = {
  execution_id: string;
  run_id: string;
  project_id: string;
  run_attempt: number;
  claim_attempt: number;
  worker_id: string | null;
  claimed_at: string;
  cost_key: string;
  usage_key: string | null;
  session_id: string | null;
  turn_id: string | null;
  scope_id: string | null;
  agent_provider: ProjectAgentProvider;
  model_provider: string | null;
  model: string | null;
  canonical_model: string | null;
  model_source: AgentExecutionCostRecord["modelSource"];
  source: string;
  amount_usd_ticks: number;
  observed_at: string;
  recorded_at: string;
};

export type IssueResultReviewRow = {
  run_id: string;
  user_id: string;
  name: string;
  username: string | null;
  image: string | null;
  completed_at: string;
};

export type IssueDependencyRow = {
  project_id: string;
  prerequisite_run_id: string;
  dependent_run_id: string;
  created_by_user_id: string | null;
  created_at: string;
  prerequisite_run_number: number;
  prerequisite_title: string;
  prerequisite_status: AutoHuntRunStatus;
  prerequisite_paused_at: string | null;
  dependent_run_number: number;
  dependent_title: string;
  dependent_status: AutoHuntRunStatus;
  dependent_paused_at: string | null;
};

export type IssueDependencyMutationOutcome =
  | "created"
  | "already_exists"
  | "cycle"
  | "ineligible"
  | "not_found";

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

export type RunEvidenceRow = {
  id: string;
  run_id: string;
  attempt: number;
  revision: number;
  evidence_key: string;
  workflow_stage: string;
  evidence_type: string;
  status: "pending" | "passed" | "failed" | "skipped";
  detail: string | null;
  command: string | null;
  url: string | null;
  metadata_json: string | null;
  actor: string;
  observed_at: string;
  recorded_at: string;
  github_association_started_at?: string | null;
};

export type WorkflowStageProgressState =
  | "pending"
  | "running"
  | "completed"
  | "skipped";

export type WorkflowCheckpointProgressState =
  | "pending"
  | "waiting"
  | "approved"
  | "invalidated";

export type WorkflowStageProgressRow = {
  run_id: string;
  attempt: number;
  revision: number;
  stage_id: AutoHuntWorkflowStageId;
  state: WorkflowStageProgressState;
  started_at: string | null;
  finished_at: string | null;
};

export type WorkflowCheckpointProgressRow = {
  run_id: string;
  attempt: number;
  revision: number;
  checkpoint_key: string;
  stage_id: AutoHuntWorkflowStageId;
  position: AutoHuntWorkflowCheckpointPosition;
  state: WorkflowCheckpointProgressState;
  reached_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_request_id: string | null;
};

export type WorkflowProgress = {
  runId: string;
  attempt: number;
  revision: number;
  stages: WorkflowStageProgressRow[];
  checkpoints: WorkflowCheckpointProgressRow[];
  waitingCheckpoint: WorkflowCheckpointProgressRow | null;
};

export type RunEvidenceImageRow = {
  id: string;
  project_id: string;
  run_id: string;
  evidence_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  position: number;
  created_at: string;
};

export type RunEvidenceImageInput = Omit<
  RunEvidenceImageRow,
  "project_id" | "run_id" | "evidence_id" | "created_at"
>;

export type IssueMessageRow = {
  id: string;
  run_id: string;
  parent_message_id: string | null;
  author_user_id: string | null;
  author_agent_provider: ProjectAgentProvider | null;
  author_name: string | null;
  author_image: string | null;
  body: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
};

export type IssueAgentReplyJobRow = {
  id: string;
  project_id: string;
  run_id: string;
  trigger_message_id: string;
  parent_message_id: string;
  reply_message_id: string;
  status: "queued" | "running" | "completed" | "failed";
  preferred_worker_id: string | null;
  claimed_worker_id: string | null;
  preferred_provider: ProjectAgentProvider | null;
  agent_provider: ProjectAgentProvider | null;
  skill_id?: string | null;
  selected_skill_id_snapshot?: string | null;
  selected_agent_name_snapshot?: string | null;
  selected_agent_responsibility_snapshot?: string | null;
  selected_skill_name_snapshot?: string | null;
  selected_skill_instructions_snapshot?: string | null;
  selected_skill_kind_snapshot?: AgentSkillKind | null;
  selected_skill_provider_snapshot?: ProjectAgentProvider | null;
  selected_skill_model_snapshot?: string | null;
  selected_skill_effort_snapshot?: ModelEffort | null;
  skill_execution_request_snapshot?: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type IssueReworkProposalRow = {
  id: string;
  project_id: string;
  run_id: string;
  trigger_message_id: string;
  reply_message_id: string;
  workflow_stage: string;
  reason: string;
  expected_attempt: number;
  expected_revision: number;
  status: "pending" | "accepted";
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  applied_revision: number | null;
  created_at: string;
  updated_at: string;
};

export type IssueActionProposalRow = {
  id: string;
  project_id: string;
  conversation_run_id: string;
  trigger_message_id: string;
  reply_message_id: string;
  action_type: "request_issue_update" | "request_issue_create";
  payload_json: string;
  expected_run_updated_at: string | null;
  status: "pending" | "accepted";
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  approval_reserved_by_user_id: string | null;
  approval_reserved_at: string | null;
  issue_source_key: string | null;
  execute_after_create: number;
  execution_proposal_id: string | null;
  result_run_id: string | null;
  created_at: string;
  updated_at: string;
};

export type IssueExecutionProposalRow = {
  id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  target_run_id: string;
  target_title: string;
  target_run_updated_at: string;
  proposed_by_agent_id: string | null;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  origin_create_proposal_id: string | null;
  generation: number;
  status: "pending" | "accepted" | "invalidated";
  approval_reserved_by_user_id: string | null;
  approval_reserved_at: string | null;
  requested_provider: ProjectAgentProvider | null;
  requested_model: string | null;
  requested_effort: ModelEffort | null;
  requested_worker_id: string | null;
  dispatch_request_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentSkillExecutionProposalRow = {
  id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  source_reply_job_id: string;
  delegated_by_reply_job_id: string | null;
  agent_id: string;
  agent_name: string;
  agent_responsibility: string;
  skill_id: string;
  skill_name: string;
  skill_instructions: string;
  skill_kind: AgentSkillKind;
  provider: ProjectAgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  request: string;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  generation: number;
  status: "pending" | "accepted" | "invalidated";
  requested_worker_id: string | null;
  requested_worker_label: string | null;
  result_session_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentSkillExecutionApprovalAuditRow = {
  id: string;
  proposal_id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  source_reply_job_id: string;
  delegated_by_reply_job_id: string | null;
  agent_id: string;
  agent_name: string;
  agent_responsibility: string;
  skill_id: string;
  skill_name: string;
  skill_instructions: string;
  skill_kind: AgentSkillKind;
  provider: ProjectAgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  request: string;
  worker_id: string;
  worker_label: string;
  result_session_id: string;
  approved_by_user_id: string | null;
  approved_at: string;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  created_at: string;
};

export type FreshBacklogExecutionTargetRow = {
  id: string;
  run_number: number;
  source_key: string;
  title: string;
  status: "backlog";
};

export type IssueConversationNotificationRow = IssueMessageRow & {
  run_title: string;
  root_message_id: string;
  notification_reason: "mention" | "thread_reply" | "subscription";
};

export type IssueSubscriptionRow = {
  run_id: string;
  organization_id: string;
  user_id: string;
  created_at: string;
};

export type ChannelConversationNotificationRow = {
  id: string;
  channel_id: string;
  channel_name: string;
  parent_message_id: string | null;
  author_user_id: string | null;
  author_agent_provider: ProjectAgentProvider | null;
  author_name: string | null;
  author_image: string | null;
  body: string;
  created_at: string;
  root_message_id: string;
  notification_reason: "mention" | "thread_reply";
};

export type DashboardChangeRow = {
  version: number;
  entity_type: "run" | "worker" | "notifications" | "metadata";
  entity_id: string | null;
  operation: "upsert" | "delete" | "replace";
};

export type DashboardChangesPage = {
  currentVersion: number;
  oldestVersion: number | null;
  changes: DashboardChangeRow[];
  hasMore: boolean;
  nextCursor: number;
  expired: boolean;
};

export type IssueAttachmentRow = {
  id: string;
  run_id: string;
  project_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

export type IssueAttachmentInput = Omit<
  IssueAttachmentRow,
  "run_id" | "project_id" | "created_at"
>;

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
  createdByUserId?: string | null;
  preferredAgentProvider?: ProjectAgentProvider | null;
  preferredAgentModel?: string | null;
  preferredAgentEffort?: ModelEffort | null;
};

export type ProjectSettingsInput = {
  velenOrg: string | null;
  dataSource: string | null;
  linear: {
    enabled: boolean;
    source: string | null;
    teamKey: string | null;
  };
  githubRepository: string | null;
  workflow: AutoHuntWorkflow;
};

export class EventKeyConflictError extends Error {
  constructor() {
    super("Event key was reused with different run data");
  }
}
export class HuntTransitionError extends Error {}
export class HuntClaimError extends Error {}

const DASHBOARD_CHANGE_PAGE_SIZE = 500;
const DASHBOARD_CHANGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_DASHBOARD_CHANGE_PRUNE_BATCH_SIZE = 25_000;

export type DashboardChangePruneResult = {
  cutoff: string;
  deleted: number;
  reachedBatchLimit: boolean;
};

export async function pruneExpiredDashboardChanges(
  db: D1Database,
  observedAt: string,
  batchSize = DEFAULT_DASHBOARD_CHANGE_PRUNE_BATCH_SIZE,
): Promise<DashboardChangePruneResult> {
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    throw new TypeError("Dashboard change prune time must be a valid timestamp");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError("Dashboard change prune batch size must be positive");
  }
  const cutoff = new Date(observedAtMs - DASHBOARD_CHANGE_RETENTION_MS)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const result = await db
    .prepare(
      `delete from briar_dashboard_changes
       where version in (
         select version from briar_dashboard_changes
         where created_at < ?
         order by created_at
         limit ?
       )`,
    )
    .bind(cutoff, batchSize)
    .run();
  const deleted = result.meta.changes ?? 0;
  return {
    cutoff,
    deleted,
    reachedBatchLimit: deleted === batchSize,
  };
}

export async function getDashboardSyncCursor(
  db: D1Database,
  projectId: string,
) {
  const state = await db
    .prepare(
      `select current_version from briar_dashboard_sync_state
       where project_id = ?`,
    )
    .bind(projectId)
    .first<{ current_version: number }>();
  return state?.current_version ?? 0;
}

export async function listDashboardChanges(
  db: D1Database,
  projectId: string,
  cursor: number,
): Promise<DashboardChangesPage> {
  const currentVersion = await getDashboardSyncCursor(db, projectId);
  const oldest = await db
    .prepare(
      `select min(version) as oldest_version
       from briar_dashboard_changes where project_id = ?`,
    )
    .bind(projectId)
    .first<{ oldest_version: number | null }>();
  const oldestVersion = oldest?.oldest_version ?? null;
  const expired =
    cursor < 0 ||
    cursor > currentVersion ||
    (cursor < currentVersion &&
      (oldestVersion === null || cursor < oldestVersion - 1));
  if (expired) {
    return {
      currentVersion,
      oldestVersion,
      changes: [],
      hasMore: false,
      nextCursor: currentVersion,
      expired: true,
    };
  }

  const result = await db
    .prepare(
      `select version, entity_type, entity_id, operation
       from briar_dashboard_changes
       where project_id = ? and version > ? and version <= ?
       order by version
       limit ?`,
    )
    .bind(projectId, cursor, currentVersion, DASHBOARD_CHANGE_PAGE_SIZE + 1)
    .all<DashboardChangeRow>();
  const hasMore = result.results.length > DASHBOARD_CHANGE_PAGE_SIZE;
  const changes = result.results.slice(0, DASHBOARD_CHANGE_PAGE_SIZE);
  return {
    currentVersion,
    oldestVersion,
    changes,
    hasMore,
    nextCursor: hasMore
      ? (changes.at(-1)?.version ?? cursor)
      : currentVersion,
    expired: false,
  };
}

const stableJson = (value: unknown) => JSON.stringify(value);
const parseWorkflow = (value: string | null | undefined) => {
  if (!value) return cloneAutoHuntWorkflow();
  return normalizeAutoHuntWorkflow(JSON.parse(value) as AutoHuntWorkflow);
};
const normalizedUrls = (urls: string[]) => [...new Set(urls)].sort();
const parseUrls = (value: string | null | undefined) => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
};

type WorkflowProgressIdentity = {
  attempt?: number;
  revision?: number;
};

type WorkflowProgressInput = WorkflowProgressIdentity & {
  runId: string;
};

const resolveWorkflowProgressIdentity = (
  run: HuntRunRow,
  input: WorkflowProgressIdentity,
) => {
  const attempt = input.attempt ?? run.current_attempt;
  const revision = input.revision ?? run.current_revision;
  if (attempt !== run.current_attempt || revision !== run.current_revision) {
    throw new HuntTransitionError(
      `Workflow progress identity is stale (current attempt ${run.current_attempt}, revision ${run.current_revision})`,
    );
  }
  return { attempt, revision };
};

const workflowProgressRows = async (
  db: D1Database,
  run: HuntRunRow,
  attempt: number,
  revision: number,
) => {
  const [stageResult, checkpointResult] = await Promise.all([
    db
      .prepare(
        `select run_id, attempt, revision, stage_id, state, started_at, finished_at
         from briar_run_stage_progress
         where run_id = ? and attempt = ? and revision = ?`,
      )
      .bind(run.id, attempt, revision)
      .all<WorkflowStageProgressRow>(),
    db
      .prepare(
        `select run_id, attempt, revision, checkpoint_key, stage_id, position,
                state, reached_at, approved_at, approved_by, approved_request_id
         from briar_run_checkpoint_progress
         where run_id = ? and attempt = ? and revision = ?`,
      )
      .bind(run.id, attempt, revision)
      .all<WorkflowCheckpointProgressRow>(),
  ]);
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const stageOrder = new Map(workflow.stages.map((stage, index) => [stage.id, index]));
  const checkpointOrder = new Map(
    workflow.execution.checkpoints.map((checkpoint, index) => [checkpoint.key, index]),
  );
  const stages = [...stageResult.results].sort(
    (left, right) =>
      (stageOrder.get(left.stage_id) ?? Number.MAX_SAFE_INTEGER) -
      (stageOrder.get(right.stage_id) ?? Number.MAX_SAFE_INTEGER),
  );
  const checkpoints = [...checkpointResult.results].sort(
    (left, right) =>
      (checkpointOrder.get(left.checkpoint_key) ?? Number.MAX_SAFE_INTEGER) -
      (checkpointOrder.get(right.checkpoint_key) ?? Number.MAX_SAFE_INTEGER),
  );
  return { stages, checkpoints };
};

const ensureWorkflowProgress = async (
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput,
) => {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return null;
  const { attempt, revision } = resolveWorkflowProgressIdentity(run, input);
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const targetRank = run.workflow_stage
    ? workflowStageRank(workflow, run.workflow_stage)
    : -1;
  let previousRevision: number | null = null;
  if (revision > 1 && targetRank >= 0) {
    const previous = await db
      .prepare(
        `select max(revision) as revision
         from briar_run_stage_progress
         where run_id = ? and attempt = ? and revision < ?`,
      )
      .bind(run.id, attempt, revision)
      .first<{ revision: number | null }>();
    previousRevision = previous?.revision ?? null;
  }
  const statements = [
    ...(previousRevision === null
      ? []
      : workflow.stages
          .slice(0, targetRank)
          .map((stage) =>
            db
              .prepare(
                `insert into briar_run_stage_progress (
                   run_id, attempt, revision, stage_id, state, started_at, finished_at
                 )
                 select run_id, attempt, ?, stage_id, state, started_at, finished_at
                 from briar_run_stage_progress
                 where run_id = ? and attempt = ? and revision = ?
                   and stage_id = ? and state in ('completed', 'skipped')
                 on conflict(run_id, attempt, revision, stage_id) do nothing`,
              )
              .bind(revision, run.id, attempt, previousRevision, stage.id),
          )),
    ...workflow.stages.map((stage) =>
      db
        .prepare(
          `insert into briar_run_stage_progress (
             run_id, attempt, revision, stage_id, state, started_at, finished_at
           ) values (?, ?, ?, ?, 'pending', null, null)
           on conflict(run_id, attempt, revision, stage_id) do nothing`,
        )
        .bind(run.id, attempt, revision, stage.id),
    ),
    ...workflow.execution.checkpoints.map((checkpoint) =>
      db
        .prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id, position,
             state, reached_at, approved_at, approved_by, approved_request_id
           ) values (?, ?, ?, ?, ?, ?, ?, null, null, null, null)
           on conflict(run_id, attempt, revision, checkpoint_key) do nothing`,
        )
        .bind(
          run.id,
          attempt,
          revision,
          checkpoint.key,
          checkpoint.stage,
          checkpoint.position,
          targetRank >= 0 && workflowStageRank(workflow, checkpoint.stage) < targetRank
            ? "invalidated"
            : "pending",
        ),
    ),
  ];
  if (statements.length > 0) await db.batch(statements);
  return { run, workflow, attempt, revision };
};

export async function initializeWorkflowProgress(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput,
) {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return null;
  return getWorkflowProgress(db, projectId, input.runId, {
    attempt: initialized.attempt,
    revision: initialized.revision,
  });
}

export async function getWorkflowProgress(
  db: D1Database,
  projectId: string,
  runId: string,
  identity: WorkflowProgressIdentity = {},
): Promise<WorkflowProgress | null> {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const { attempt, revision } = resolveWorkflowProgressIdentity(run, identity);
  const rows = await workflowProgressRows(db, run, attempt, revision);
  return {
    runId: run.id,
    attempt,
    revision,
    stages: rows.stages,
    checkpoints: rows.checkpoints,
    waitingCheckpoint:
      rows.checkpoints.find((checkpoint) => checkpoint.state === "waiting") ?? null,
  };
}

const workflowStageRow = (
  progress: WorkflowProgress,
  stageId: AutoHuntWorkflowStageId,
) => progress.stages.find((stage) => stage.stage_id === stageId) ?? null;

const workflowCheckpointRow = (
  progress: WorkflowProgress,
  checkpointKey: string,
) => progress.checkpoints.find((checkpoint) => checkpoint.checkpoint_key === checkpointKey) ?? null;

const workflowStageRank = (
  workflow: AutoHuntWorkflow,
  stageId: AutoHuntWorkflowStageId,
) => workflow.stages.findIndex((stage) => stage.id === stageId);

const assertStageBeforeCheckpointApproved = (
  progress: WorkflowProgress,
  workflow: AutoHuntWorkflow,
  stageId: AutoHuntWorkflowStageId,
) => {
  const checkpoint = workflowCheckpointAt(workflow, stageId, "before");
  if (!checkpoint) return;
  const row = workflowCheckpointRow(progress, checkpoint.key);
  if (!row || row.state !== "approved") {
    throw new HuntTransitionError(
      `Stage ${stageId} is waiting for before checkpoint ${checkpoint.key}`,
    );
  }
};

const assertEarlierWorkflowCheckpointsResolved = (
  progress: WorkflowProgress,
  workflow: AutoHuntWorkflow,
  stageId: AutoHuntWorkflowStageId,
) => {
  const stageRank = workflowStageRank(workflow, stageId);
  const unresolved = progress.checkpoints.find((checkpoint) => {
    const checkpointRank = workflowStageRank(workflow, checkpoint.stage_id);
    const isBeforeCurrentStage =
      checkpointRank < stageRank ||
      (checkpointRank === stageRank && checkpoint.position === "before");
    return isBeforeCurrentStage &&
      checkpoint.state !== "approved" &&
      checkpoint.state !== "invalidated";
  });
  if (unresolved) {
    throw new HuntTransitionError(
      `Stage ${stageId} is blocked by checkpoint ${unresolved.checkpoint_key}`,
    );
  }
};

export type WorkflowStageTransitionOutcome =
  | "started"
  | "already_running"
  | "completed"
  | "skipped"
  | "not_found";

export async function startWorkflowStage(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    startedAt: string;
    actor?: string;
  },
): Promise<{
  outcome: WorkflowStageTransitionOutcome;
  stage: WorkflowStageProgressRow | null;
}> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return { outcome: "not_found", stage: null };
  const { run, workflow, attempt, revision } = initialized;
  const rank = workflowStageRank(workflow, input.stageId);
  if (rank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.stageId}`,
    );
  }
  const progress = await getWorkflowProgress(db, projectId, run.id, {
    attempt,
    revision,
  });
  if (!progress) return { outcome: "not_found", stage: null };
  const row = workflowStageRow(progress, input.stageId);
  if (!row) throw new HuntTransitionError(`Missing stage progress: ${input.stageId}`);
  if (row.state === "completed") return { outcome: "completed", stage: row };
  if (row.state === "skipped") return { outcome: "skipped", stage: row };
  if (row.state === "running") return { outcome: "already_running", stage: row };
  const currentRank = run.workflow_stage
    ? workflowStageRank(workflow, run.workflow_stage)
    : -1;
  if (currentRank > rank) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot start after the run moved to a later stage`,
    );
  }
  if (progress.waitingCheckpoint) {
    throw new HuntTransitionError(
      `Run is waiting for checkpoint ${progress.waitingCheckpoint.checkpoint_key}`,
    );
  }
  if (run.paused_at) {
    throw new HuntTransitionError("Run is paused; resume it before starting a stage");
  }
  assertStageBeforeCheckpointApproved(progress, workflow, input.stageId);
  assertEarlierWorkflowCheckpointsResolved(progress, workflow, input.stageId);

  const previousStages = progress.stages.filter(
    (stage) => workflowStageRank(workflow, stage.stage_id) < rank,
  );
  const hasIncompletePreviousStage = previousStages.some(
    (stage) => stage.state !== "completed" && stage.state !== "skipped",
  );
  // A reworked run is deliberately positioned at its target stage by
  // reworkHuntRun. It must not revisit earlier stage/checkpoint boundaries.
  if (hasIncompletePreviousStage) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot start before earlier stages are complete`,
    );
  }
  const eventId = crypto.randomUUID();
  const eventKey = `workflow:stage-start:${attempt}:${revision}:${input.stageId}`;
  const stageLabel = workflow.stages[rank]?.label ?? input.stageId;
  const recordedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `update briar_run_stage_progress
         set state = 'running', started_at = ?, finished_at = null
         where run_id = ? and attempt = ? and revision = ? and stage_id = ?
           and state = 'pending'`,
      )
      .bind(input.startedAt, run.id, attempt, revision, input.stageId),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, 'running', ?, ?, ?, branch, commit_sha,
                null, tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and paused_at is null
           and exists (
             select 1 from briar_run_stage_progress
             where run_id = briar_hunt_runs.id and attempt = ? and revision = ?
               and stage_id = ? and state = 'running'
           )
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        attempt,
        revision,
        dashboardStageFor("running", input.stageId),
        input.stageId,
        `${stageLabel} 단계를 시작했습니다.`,
        input.actor ?? "briar-workflow",
        input.startedAt,
        recordedAt,
        run.id,
        projectId,
        attempt,
        revision,
        attempt,
        revision,
        input.stageId,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = 'running', workflow_stage = ?,
             resume_requested_at = null, last_event_at = max(last_event_at, ?),
             updated_at = max(updated_at, ?)
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and paused_at is null`,
      )
      .bind(
        dashboardStageFor("running", input.stageId),
        input.stageId,
        input.startedAt,
        input.startedAt,
        run.id,
        projectId,
        attempt,
        revision,
      ),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    const current = await getWorkflowProgress(db, projectId, run.id, {
      attempt,
      revision,
    });
    const currentRow = current ? workflowStageRow(current, input.stageId) : null;
    if (currentRow?.state === "running") return { outcome: "already_running", stage: currentRow };
    if (currentRow?.state === "completed") return { outcome: "completed", stage: currentRow };
    throw new HuntTransitionError("Stage progress changed while starting the stage");
  }
  if ((results[2]?.meta.changes ?? 0) === 0) {
    throw new HuntTransitionError("Run changed while starting the stage");
  }
  const updated = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  return {
    outcome: "started",
    stage: updated ? workflowStageRow(updated, input.stageId) : null,
  };
}

export async function completeWorkflowStage(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    finishedAt: string;
  },
): Promise<{
  outcome: WorkflowStageTransitionOutcome;
  stage: WorkflowStageProgressRow | null;
}> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return { outcome: "not_found", stage: null };
  const { run, workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const row = progress ? workflowStageRow(progress, input.stageId) : null;
  if (!row) throw new HuntTransitionError(`Missing stage progress: ${input.stageId}`);
  if (row.state === "completed") return { outcome: "completed", stage: row };
  const rank = workflowStageRank(workflow, input.stageId);
  if (rank < 0) throw new HuntTransitionError(`Missing stage: ${input.stageId}`);
  const currentRank = run.workflow_stage
    ? workflowStageRank(workflow, run.workflow_stage)
    : -1;
  if (currentRank > rank) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot complete after the run moved to a later stage`,
    );
  }
  assertStageBeforeCheckpointApproved(progress, workflow, input.stageId);
  assertEarlierWorkflowCheckpointsResolved(progress, workflow, input.stageId);
  const previousStages = progress.stages.filter(
    (stage) => workflowStageRank(workflow, stage.stage_id) < rank,
  );
  if (previousStages.some((stage) => stage.state !== "completed" && stage.state !== "skipped")) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} cannot complete before earlier stages are complete`,
    );
  }
  if (row.state !== "running") {
    throw new HuntTransitionError(
      `Stage ${input.stageId} must be running before it can complete`,
    );
  }
  const result = await db
    .prepare(
      `update briar_run_stage_progress
       set state = 'completed', finished_at = ?
       where run_id = ? and attempt = ? and revision = ? and stage_id = ?
         and state = 'running'`,
    )
    .bind(input.finishedAt, run.id, attempt, revision, input.stageId)
    .run();
  if (result.meta.changes === 0) {
    throw new HuntTransitionError("Stage progress changed while completing the stage");
  }
  const updated = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  return {
    outcome: "completed",
    stage: updated ? workflowStageRow(updated, input.stageId) : null,
  };
}

export type WorkflowStageLifecycleCheckpoint = {
  key: string;
  stage: AutoHuntWorkflowStageId;
  position: AutoHuntWorkflowCheckpointPosition;
  revision: number;
};

export type WorkflowStageLifecycleResult = {
  outcome:
    | "started"
    | "completed"
    | "already_started"
    | "already_completed"
    | "paused"
    | "not_found";
  attempt: number | null;
  revision: number | null;
  stage: AutoHuntWorkflowStageId;
  checkpoint: WorkflowStageLifecycleCheckpoint | null;
};

const lifecycleCheckpoint = (
  checkpoint: AutoHuntWorkflowCheckpoint,
  revision: number,
): WorkflowStageLifecycleCheckpoint => ({
  key: checkpoint.key,
  stage: checkpoint.stage,
  position: checkpoint.position,
  revision,
});

const pauseAtWorkflowCheckpoint = async (
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    checkpoint: AutoHuntWorkflowCheckpoint;
    reachedAt: string;
  },
) => {
  const reached = await reachWorkflowCheckpoint(db, projectId, {
    runId: input.runId,
    attempt: input.attempt,
    revision: input.revision,
    checkpointKey: input.checkpoint.key,
    reachedAt: input.reachedAt,
  });
  if (!["waiting", "already_waiting"].includes(reached.outcome)) {
    throw new HuntTransitionError(
      `Checkpoint ${input.checkpoint.key} changed while pausing the workflow`,
    );
  }
  return lifecycleCheckpoint(input.checkpoint, reached.revision!);
};

export async function assertWorkflowStageEvidence(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & { stageId: AutoHuntWorkflowStageId },
) {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) throw new HuntTransitionError("Run does not exist");
  const { run, workflow, attempt, revision } = initialized;
  const stage = workflow.stages.find((candidate) => candidate.id === input.stageId);
  if (!stage) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.stageId}`,
    );
  }
  const requiredEvidence = stage.evidence ?? [];
  if (requiredEvidence.length === 0) return;
  const requirement = await db
    .prepare(
      `select required_revision from briar_run_stage_revisions
       where run_id = ? and attempt = ? and workflow_stage = ?`,
    )
    .bind(run.id, attempt, input.stageId)
    .first<{ required_revision: number }>();
  const minimumRevision = requirement?.required_revision ?? 1;
  const result = await db
    .prepare(
      `select evidence_type from briar_run_evidence
       where run_id = ? and attempt = ? and workflow_stage = ?
         and revision >= ? and revision <= ?
         and status in ('passed', 'skipped')`,
    )
    .bind(run.id, attempt, input.stageId, minimumRevision, revision)
    .all<{ evidence_type: string }>();
  const accepted = new Set(result.results.map((item) => item.evidence_type));
  const missing = requiredEvidence.filter((type) => !accepted.has(type));
  if (missing.length > 0) {
    throw new HuntTransitionError(
      `Stage ${input.stageId} requires evidence: ${missing.join(", ")}`,
    );
  }
}

export async function startWorkflowStageLifecycle(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    startedAt: string;
    actor?: string;
  },
): Promise<WorkflowStageLifecycleResult> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) {
    return {
      outcome: "not_found",
      attempt: null,
      revision: null,
      stage: input.stageId,
      checkpoint: null,
    };
  }
  const { workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, input.runId, {
    attempt,
    revision,
  });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const stageRank = workflowStageRank(workflow, input.stageId);
  const blockingCheckpoint = workflow.execution.checkpoints.find((checkpoint) => {
    const row = workflowCheckpointRow(progress, checkpoint.key);
    const checkpointRank = workflowStageRank(workflow, checkpoint.stage);
    return row && ["pending", "waiting"].includes(row.state) &&
      (checkpointRank < stageRank ||
        (checkpointRank === stageRank && checkpoint.position === "before"));
  });
  const blockingProgress = blockingCheckpoint
    ? workflowCheckpointRow(progress, blockingCheckpoint.key)
    : null;
  if (blockingCheckpoint && blockingProgress) {
    const checkpoint = blockingProgress.state === "waiting"
      ? lifecycleCheckpoint(blockingCheckpoint, revision)
      : await pauseAtWorkflowCheckpoint(db, projectId, {
          runId: input.runId,
          attempt,
          revision,
          checkpoint: blockingCheckpoint,
          reachedAt: input.startedAt,
        });
    return {
      outcome: "paused",
      attempt,
      revision,
      stage: input.stageId,
      checkpoint,
    };
  }
  const prior = workflowStageRow(progress, input.stageId);
  const started = await startWorkflowStage(db, projectId, {
    ...input,
    attempt,
    revision,
  });
  return {
    outcome: prior?.state === "completed" || prior?.state === "skipped"
      ? "already_completed"
      : started.outcome === "already_running"
        ? "already_started"
        : started.outcome === "not_found"
          ? "not_found"
          : "started",
    attempt,
    revision,
    stage: input.stageId,
    checkpoint: null,
  };
}

export async function completeWorkflowStageLifecycle(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    stageId: AutoHuntWorkflowStageId;
    finishedAt: string;
  },
): Promise<WorkflowStageLifecycleResult> {
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) {
    return {
      outcome: "not_found",
      attempt: null,
      revision: null,
      stage: input.stageId,
      checkpoint: null,
    };
  }
  const { workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, input.runId, {
    attempt,
    revision,
  });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const prior = workflowStageRow(progress, input.stageId);
  if (prior?.state !== "completed" && prior?.state !== "skipped") {
    await assertWorkflowStageEvidence(db, projectId, {
      runId: input.runId,
      attempt,
      revision,
      stageId: input.stageId,
    });
  }
  const completed = await completeWorkflowStage(db, projectId, {
    ...input,
    attempt,
    revision,
  });
  const updated = await getWorkflowProgress(db, projectId, input.runId, {
    attempt,
    revision,
  });
  const after = workflowCheckpointAt(workflow, input.stageId, "after");
  const afterProgress = after && updated
    ? workflowCheckpointRow(updated, after.key)
    : null;
  if (after && afterProgress && ["pending", "waiting"].includes(afterProgress.state)) {
    const checkpoint = afterProgress.state === "waiting"
      ? lifecycleCheckpoint(after, revision)
      : await pauseAtWorkflowCheckpoint(db, projectId, {
          runId: input.runId,
          attempt,
          revision,
          checkpoint: after,
          reachedAt: input.finishedAt,
        });
    return {
      outcome: "paused",
      attempt,
      revision,
      stage: input.stageId,
      checkpoint,
    };
  }
  return {
    outcome: prior?.state === "completed" || prior?.state === "skipped"
      ? "already_completed"
      : completed.outcome === "not_found"
        ? "not_found"
        : "completed",
    attempt,
    revision,
    stage: input.stageId,
    checkpoint: null,
  };
}

export type WorkflowCheckpointTransitionOutcome =
  | "waiting"
  | "already_waiting"
  | "approved"
  | "already_approved"
  | "invalidated"
  | "conflict"
  | "not_found";

const checkpointTransitionConflict = (
  checkpointKey: string,
  attempt: number,
  revision: number,
): { outcome: "conflict"; checkpointKey: string; attempt: number; revision: number } => ({
  outcome: "conflict",
  checkpointKey,
  attempt,
  revision,
});

export async function reachWorkflowCheckpoint(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    checkpointKey: string;
    reachedAt: string;
  },
): Promise<{
  outcome: WorkflowCheckpointTransitionOutcome;
  checkpointKey: string;
  attempt: number | null;
  revision: number | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return { outcome: "not_found", checkpointKey: input.checkpointKey, attempt: null, revision: null };
  }
  if (
    (input.attempt !== undefined && input.attempt !== run.current_attempt) ||
    (input.revision !== undefined && input.revision !== run.current_revision)
  ) {
    return checkpointTransitionConflict(input.checkpointKey, run.current_attempt, run.current_revision);
  }
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) return { outcome: "not_found", checkpointKey: input.checkpointKey, attempt: null, revision: null };
  const { workflow, attempt, revision } = initialized;
  const configured = workflow.execution.checkpoints.find(
    (checkpoint) => checkpoint.key === input.checkpointKey,
  );
  if (!configured) throw new HuntTransitionError(`Unknown checkpoint: ${input.checkpointKey}`);
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  const current = workflowCheckpointRow(progress, input.checkpointKey);
  if (!current) throw new HuntTransitionError(`Missing checkpoint progress: ${input.checkpointKey}`);
  if (current.state === "waiting") {
    return { outcome: "already_waiting", checkpointKey: current.checkpoint_key, attempt, revision };
  }
  if (current.state === "approved") {
    return { outcome: "already_approved", checkpointKey: current.checkpoint_key, attempt, revision };
  }
  if (current.state === "invalidated") {
    return checkpointTransitionConflict(input.checkpointKey, attempt, revision);
  }
  if (progress.waitingCheckpoint) {
    return checkpointTransitionConflict(
      progress.waitingCheckpoint.checkpoint_key,
      attempt,
      revision,
    );
  }
  const stage = workflowStageRow(progress, configured.stage);
  if (!stage) throw new HuntTransitionError(`Missing stage progress: ${configured.stage}`);
  if (configured.position === "before" && stage.state !== "pending") {
    throw new HuntTransitionError(
      `Before checkpoint ${configured.key} requires stage ${configured.stage} to be pending`,
    );
  }
  if (configured.position === "after" && stage.state !== "completed") {
    throw new HuntTransitionError(
      `After checkpoint ${configured.key} requires stage ${configured.stage} to be completed`,
    );
  }
  const checkpointIndex = workflow.execution.checkpoints.findIndex(
    (checkpoint) => checkpoint.key === configured.key,
  );
  const unresolvedEarlier = progress.checkpoints
    .slice(0, checkpointIndex)
    .some((checkpoint) => checkpoint.state !== "approved" && checkpoint.state !== "invalidated");
  if (unresolvedEarlier) {
    throw new HuntTransitionError(
      `Checkpoint ${configured.key} cannot be reached before earlier checkpoints are approved`,
    );
  }
  try {
    const results = await db.batch([
      db
        .prepare(
          `update briar_run_checkpoint_progress
           set state = 'waiting', reached_at = ?, approved_at = null,
               approved_by = null, approved_request_id = null
           where run_id = ? and attempt = ? and revision = ?
             and checkpoint_key = ? and state = 'pending'`,
        )
        .bind(input.reachedAt, run.id, attempt, revision, configured.key),
      db
      .prepare(
        `update briar_hunt_runs
           set paused_at = ?, workflow_stage = ?, stage = ?,
               waiting_checkpoint_key = ?,
               waiting_checkpoint_revision = ?, resume_requested_at = null,
               claim_token_hash = null,
               claimed_by = null, claimed_at = null, lease_expires_at = null,
               updated_at = max(updated_at, ?)
           where id = ? and project_id = ? and current_attempt = ?
             and current_revision = ? and paused_at is null
             and waiting_checkpoint_key is null`,
        )
        .bind(
          input.reachedAt,
          configured.stage,
          dashboardStageFor("running", configured.stage),
          configured.key,
          revision,
          input.reachedAt,
          run.id,
          projectId,
          attempt,
          revision,
        ),
    ]);
    if ((results[0]?.meta.changes ?? 0) === 0 || (results[1]?.meta.changes ?? 0) === 0) {
      return checkpointTransitionConflict(configured.key, attempt, revision);
    }
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      return checkpointTransitionConflict(configured.key, attempt, revision);
    }
    throw error;
  }
  return { outcome: "waiting", checkpointKey: configured.key, attempt, revision };
}

export async function resumeWorkflowCheckpoint(
  db: D1Database,
  projectId: string,
  input: WorkflowProgressInput & {
    checkpointKey: string;
    requestId: string;
    actor: string;
    approvedAt: string;
    requireAllGithubPullRequestsMerged?: boolean;
  },
): Promise<{
  outcome: "approved" | "already_approved" | "conflict" | "not_found";
  checkpointKey: string;
  attempt: number | null;
  revision: number | null;
  nextStage: AutoHuntWorkflowStageId | null;
  terminalReviewOnly: boolean;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return {
      outcome: "not_found",
      checkpointKey: input.checkpointKey,
      attempt: null,
      revision: null,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const priorRequest = await db
    .prepare(
      `select checkpoint_key, attempt, revision, stage_id, position
       from briar_run_checkpoint_progress
       where run_id = ? and approved_request_id = ? limit 1`,
    )
    .bind(run.id, input.requestId)
    .first<WorkflowCheckpointProgressRow>();
  if (priorRequest) {
    const workflow = parseWorkflow(run.workflow_snapshot_json);
    const index = workflow.execution.checkpoints.findIndex(
      (checkpoint) => checkpoint.key === priorRequest.checkpoint_key,
    );
    const configured = index >= 0
      ? workflow.execution.checkpoints[index]
      : null;
    const terminalReviewOnly = configured?.position === "after" &&
      configured.stage === workflow.stages.at(-1)?.id;
    return {
      outcome:
        priorRequest.checkpoint_key === input.checkpointKey
          ? "already_approved"
          : "conflict",
      checkpointKey: priorRequest.checkpoint_key,
      attempt: priorRequest.attempt,
      revision: priorRequest.revision,
      nextStage: terminalReviewOnly
        ? null
        : configured?.position === "before"
          ? configured.stage
          : workflow.stages[workflowStageRank(workflow, priorRequest.stage_id) + 1]?.id ??
            null,
      terminalReviewOnly,
    };
  }
  if (
    input.attempt !== run.current_attempt ||
    input.revision !== run.current_revision
  ) {
    return {
      outcome: "conflict",
      checkpointKey: input.checkpointKey,
      attempt: run.current_attempt,
      revision: run.current_revision,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const initialized = await ensureWorkflowProgress(db, projectId, input);
  if (!initialized) {
    return {
      outcome: "not_found",
      checkpointKey: input.checkpointKey,
      attempt: null,
      revision: null,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const { workflow, attempt, revision } = initialized;
  const configured = workflow.execution.checkpoints.find(
    (checkpoint) => checkpoint.key === input.checkpointKey,
  );
  if (!configured) throw new HuntTransitionError(`Unknown checkpoint: ${input.checkpointKey}`);
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  const current = progress ? workflowCheckpointRow(progress, configured.key) : null;
  if (!current || current.state !== "waiting") {
    return {
      outcome: "conflict",
      checkpointKey: input.checkpointKey,
      attempt,
      revision,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  if (
    run.waiting_checkpoint_key !== configured.key ||
    run.waiting_checkpoint_revision !== revision
  ) {
    return {
      outcome: "conflict",
      checkpointKey: input.checkpointKey,
      attempt,
      revision,
      nextStage: null,
      terminalReviewOnly: false,
    };
  }
  const terminalReviewOnly = configured.position === "after" &&
    configured.stage === workflow.stages.at(-1)?.id;
  const nextStage = terminalReviewOnly
    ? null
    : configured.position === "before"
      ? configured.stage
      : workflow.stages[workflowStageRank(workflow, configured.stage) + 1]?.id ?? null;
  const resumedWorkflowStage = nextStage ?? configured.stage;
  const resumedStage = dashboardStageFor("running", resumedWorkflowStage);
  const githubCheckpointMergeGuard = input.requireAllGithubPullRequestsMerged
    ? `and exists (
         select 1 from briar_run_pull_requests link
         where link.run_id = briar_run_checkpoint_progress.run_id
           and link.attempt = briar_run_checkpoint_progress.attempt
           and link.revision = briar_run_checkpoint_progress.revision
       )
       and not exists (
         select 1 from briar_run_pull_requests link
         where link.run_id = briar_run_checkpoint_progress.run_id
           and link.attempt = briar_run_checkpoint_progress.attempt
           and link.revision = briar_run_checkpoint_progress.revision
           and (link.state <> 'merged' or link.last_delivery_id is null)
       )
       and not exists (
         select 1 from briar_run_evidence evidence
         where evidence.run_id = briar_run_checkpoint_progress.run_id
           and evidence.attempt = briar_run_checkpoint_progress.attempt
           and evidence.revision = briar_run_checkpoint_progress.revision
           and evidence.evidence_type = 'pull_request'
           and evidence.status in ('pending', 'passed')
           and not exists (
             select 1 from briar_run_pull_requests link
             where link.run_id = evidence.run_id
               and link.attempt = evidence.attempt
               and link.revision = evidence.revision
               and link.repository_id = cast(json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.repositoryId'
               ) as integer)
               and link.pull_request_id = cast(json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.pullRequestId'
               ) as integer)
               and link.pull_request_node_id = json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.pullRequestNodeId'
               )
               and link.pull_request_number = cast(json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.pullRequestNumber'
               ) as integer)
           )
       )`
    : "";
  const githubRunMergeGuard = input.requireAllGithubPullRequestsMerged
    ? `and exists (
         select 1 from briar_run_pull_requests link
         where link.project_id = briar_hunt_runs.project_id
           and link.run_id = briar_hunt_runs.id
           and link.attempt = briar_hunt_runs.current_attempt
           and link.revision = briar_hunt_runs.current_revision
       )
       and not exists (
         select 1 from briar_run_pull_requests link
         where link.project_id = briar_hunt_runs.project_id
           and link.run_id = briar_hunt_runs.id
           and link.attempt = briar_hunt_runs.current_attempt
           and link.revision = briar_hunt_runs.current_revision
           and (link.state <> 'merged' or link.last_delivery_id is null)
       )
       and not exists (
         select 1 from briar_run_evidence evidence
         where evidence.project_id = briar_hunt_runs.project_id
           and evidence.run_id = briar_hunt_runs.id
           and evidence.attempt = briar_hunt_runs.current_attempt
           and evidence.revision = briar_hunt_runs.current_revision
           and evidence.evidence_type = 'pull_request'
           and evidence.status in ('pending', 'passed')
           and not exists (
             select 1 from briar_run_pull_requests link
             where link.run_id = evidence.run_id
               and link.attempt = evidence.attempt
               and link.revision = evidence.revision
               and link.repository_id = cast(json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.repositoryId'
               ) as integer)
               and link.pull_request_id = cast(json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.pullRequestId'
               ) as integer)
               and link.pull_request_node_id = json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.pullRequestNodeId'
               )
               and link.pull_request_number = cast(json_extract(
                 evidence.metadata_json,
                 '$.githubPullRequest.pullRequestNumber'
               ) as integer)
           )
       )`
    : "";
  const results = await db.batch([
    db
      .prepare(
        `update briar_run_checkpoint_progress
         set state = 'approved', approved_at = ?, approved_by = ?,
             approved_request_id = ?
         where run_id = ? and attempt = ? and revision = ?
           and checkpoint_key = ? and state = 'waiting'
           ${githubCheckpointMergeGuard}`,
      )
      .bind(
        input.approvedAt,
        input.actor,
        input.requestId,
        run.id,
        attempt,
        revision,
        configured.key,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set status = 'running', stage = ?, workflow_stage = ?,
             resume_requested_at = ?,
             waiting_checkpoint_key = null, waiting_checkpoint_revision = null,
             claim_token_hash = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, completed_at = null,
             updated_at = max(updated_at, ?)
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and waiting_checkpoint_key = ?
           and waiting_checkpoint_revision = ? and paused_at is not null
           and resume_requested_at is null
           ${githubRunMergeGuard}`,
      )
      .bind(
        resumedStage,
        resumedWorkflowStage,
        input.approvedAt,
        input.approvedAt,
        run.id,
        projectId,
        attempt,
        revision,
        configured.key,
        revision,
      ),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0 || (results[1]?.meta.changes ?? 0) === 0) {
    return {
      outcome: "conflict",
      checkpointKey: configured.key,
      attempt,
      revision,
      nextStage,
      terminalReviewOnly,
    };
  }
  return {
    outcome: "approved",
    checkpointKey: configured.key,
    attempt,
    revision,
    nextStage,
    terminalReviewOnly,
  };
}

export async function assertWorkflowRunCompletion(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const initialized = await ensureWorkflowProgress(db, projectId, { runId });
  if (!initialized) throw new HuntTransitionError("Run does not exist");
  const { run, workflow, attempt, revision } = initialized;
  const progress = await getWorkflowProgress(db, projectId, run.id, { attempt, revision });
  if (!progress) throw new HuntTransitionError("Workflow progress is unavailable");
  if (progress.waitingCheckpoint) {
    throw new HuntTransitionError(
      `Run is waiting for checkpoint ${progress.waitingCheckpoint.checkpoint_key}; resume it before completion`,
    );
  }
  const terminal = workflow.stages.at(-1);
  const terminalProgress = terminal ? workflowStageRow(progress, terminal.id) : null;
  if (!terminal || terminalProgress?.state !== "completed") {
    throw new HuntTransitionError(
      `Run completion requires the terminal stage ${terminal?.id ?? "none"} to be completed`,
    );
  }
  const terminalAfterCheckpoint = terminal
    ? workflowCheckpointAt(workflow, terminal.id, "after")
    : null;
  if (terminalAfterCheckpoint) {
    const checkpoint = workflowCheckpointRow(progress, terminalAfterCheckpoint.key);
    if (checkpoint?.state !== "approved") {
      throw new HuntTransitionError(
        `Run completion requires terminal checkpoint ${terminalAfterCheckpoint.key} to be approved`,
      );
    }
  }
  const requiredStages = requiredWorkflowStages(workflow);
  const missingStages = requiredStages.filter(
    (stageId) => workflowStageRow(progress, stageId)?.state !== "completed",
  );
  if (missingStages.length > 0) {
    throw new HuntTransitionError(
      `Run completion requires workflow stages: ${missingStages.join(", ")}`,
    );
  }
  const requiredEvidence = workflow.stages.flatMap((stage) =>
    requiredStages.includes(stage.id)
      ? (stage.evidence ?? []).map((type) => ({ stage: stage.id, type }))
      : [],
  );
  if (requiredEvidence.length > 0) {
    const revisionRequirements = await loadStageRevisionRequirements(db, run);
    const evidence = await db
      .prepare(
        `select workflow_stage, evidence_type, revision
         from briar_run_evidence
         where run_id = ? and attempt = ? and revision <= ?
           and status in ('passed', 'skipped')`,
      )
      .bind(run.id, attempt, revision)
      .all<{ workflow_stage: string; evidence_type: string; revision: number }>();
    const accepted = new Set(
      evidence.results
        .filter((item) =>
          item.revision >= (revisionRequirements.get(item.workflow_stage) ?? 1)
        )
        .map((item) => `${item.workflow_stage}:${item.evidence_type}`),
    );
    const missingEvidence = requiredEvidence
      .filter((item) => !accepted.has(`${item.stage}:${item.type}`))
      .map((item) => `${item.stage}:${item.type}`);
    if (missingEvidence.length > 0) {
      throw new HuntTransitionError(
        `Run completion requires evidence: ${missingEvidence.join(", ")}`,
      );
    }
  }
  return progress;
}

export async function listOrganizations(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `select organization.id, organization.name, organization.handle,
              coalesce(organization.logo_data_url, organization.logo) as logo,
              membership.role,
              organization.created_at
       from briar_organizations organization
       join briar_organization_members membership
         on membership.organization_id = organization.id
       where membership.user_id = ?
       order by organization.created_at, organization.id`,
    )
    .bind(userId)
    .all<OrganizationRow>();
  return result.results;
}

export async function planAccountDeletion(
  db: D1Database,
  userId: string,
): Promise<AccountDeletionPlan> {
  const organizationResult = await db
    .prepare(
      `select organization.id, organization.name, membership.role,
              (select count(*)
               from briar_organization_members peer
               where peer.organization_id = organization.id) as member_count,
              exists(
                select 1 from briar_projects project
                where project.organization_id = organization.id
                  and project.owner_user_id = ?
              ) as owns_project,
              exists(
                select 1 from briar_execution_worker_devices device
                where device.organization_id = organization.id
                  and device.owner_user_id = ?
              ) as owns_worker,
              exists(
                select 1 from briar_slack_installations installation
                where installation.organization_id = organization.id
                  and installation.installed_by_user_id = ?
              ) as owns_slack_installation
       from briar_organization_members membership
       join briar_organizations organization
         on organization.id = membership.organization_id
       where membership.user_id = ?
       order by organization.created_at, organization.id`,
    )
    .bind(userId, userId, userId, userId)
    .all<{
      id: string;
      name: string;
      role: OrganizationRole;
      member_count: number;
      owns_project: number;
      owns_worker: number;
      owns_slack_installation: number;
    }>();
  const organizations = organizationResult.results ?? [];
  const blockedOrganizations = organizations
    .filter(
      (organization) =>
        organization.member_count > 1 &&
        (organization.role === "owner" ||
          organization.owns_project > 0 ||
          organization.owns_worker > 0 ||
          organization.owns_slack_installation > 0),
    )
    .map(({ id, name }) => ({ id, name }));
  const organizationIds = organizations
    .filter((organization) => organization.member_count === 1)
    .map((organization) => organization.id);
  const projectResult = await db
    .prepare(
      `select distinct project.id
       from briar_projects project
       where project.owner_user_id = ?
          or project.organization_id in (
            select membership.organization_id
            from briar_organization_members membership
            where membership.user_id = ?
              and 1 = (
                select count(*)
                from briar_organization_members peer
                where peer.organization_id = membership.organization_id
              )
          )
       order by project.id`,
    )
    .bind(userId, userId)
    .all<{ id: string }>();
  return {
    blockedOrganizations,
    organizationIds,
    projectIds: (projectResult.results ?? []).map((project) => project.id),
  };
}

export async function deleteAccountData(
  db: D1Database,
  input: {
    userId: string;
    email: string;
    observedAt: string;
  },
) {
  const jobId = crypto.randomUUID();
  const cleanupUpsert = `
    on conflict (bucket, object_key) do update set
      project_id = excluded.project_id,
      run_id = excluded.run_id,
      queued_at = excluded.queued_at,
      attempts = 0,
      last_attempt_at = null,
      last_error = null,
      generation = briar_archive_cleanup_queue.generation + 1,
      next_attempt_at = null,
      dead_lettered_at = null,
      alert_state = 'none',
      alert_detail_json = null`;
  const statements: D1PreparedStatement[] = [
    // This authoritative guard deliberately recomputes the current state. A
    // preview plan is useful UI, but it is never permission to erase an
    // organization that gained another member or user-owned resource later.
    db
      .prepare(
        `insert into briar_account_deletion_jobs (
           id, user_id, email, created_at
         )
         select ?, account.id, ?, ?
         from "user" account
         where account.id = ?
           and not exists (
             select 1
             from briar_organization_members membership
             where membership.user_id = account.id
               and membership.role = 'owner'
               and 1 < (
                 select count(*)
                 from briar_organization_members peer
                 where peer.organization_id = membership.organization_id
               )
           )
           and not exists (
             select 1 from briar_projects project
             where project.owner_user_id = account.id
               and not exists (
                 select 1
                 from briar_organization_members membership
                 where membership.organization_id = project.organization_id
                   and membership.user_id = account.id
                   and 1 = (
                     select count(*)
                     from briar_organization_members peer
                     where peer.organization_id = project.organization_id
                   )
               )
           )
           and not exists (
             select 1 from briar_execution_worker_devices device
             where device.owner_user_id = account.id
               and not exists (
                 select 1
                 from briar_organization_members membership
                 where membership.organization_id = device.organization_id
                   and membership.user_id = account.id
                   and 1 = (
                     select count(*)
                     from briar_organization_members peer
                     where peer.organization_id = device.organization_id
                   )
               )
           )
           and not exists (
             select 1 from briar_slack_installations installation
             where installation.installed_by_user_id = account.id
               and not exists (
                 select 1
                 from briar_organization_members membership
                 where membership.organization_id = installation.organization_id
                   and membership.user_id = account.id
                   and 1 = (
                     select count(*)
                     from briar_organization_members peer
                     where peer.organization_id = installation.organization_id
                   )
               )
           )
         returning id`,
      )
      .bind(jobId, input.email, input.observedAt, input.userId),
    db
      .prepare(
        `insert into briar_account_deletion_job_organizations (
           job_id, organization_id
         )
         select job.id, membership.organization_id
         from briar_account_deletion_jobs job
         join briar_organization_members membership
           on membership.user_id = job.user_id
         where job.id = ?
           and 1 = (
             select count(*) from briar_organization_members peer
             where peer.organization_id = membership.organization_id
           )`,
      )
      .bind(jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'archives', archive.object_key,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_log_archives archive
         left join briar_projects stored_project
           on stored_project.id = archive.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = archive.run_id
         left join briar_projects current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', related.value,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_log_archives archive
         join json_each(archive.related_object_keys_json) related
           on related.type = 'text'
         left join briar_projects stored_project
           on stored_project.id = archive.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = archive.run_id
         left join briar_projects current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_issue_attachments attachment
         left join briar_projects stored_project
           on stored_project.id = attachment.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = attachment.run_id
         left join briar_projects current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', image.object_key,
                case when current_scope.organization_id is not null
                     then current_project.id else stored_project.id end,
                null, ?
         from briar_run_evidence_images image
         left join briar_projects stored_project
           on stored_project.id = image.project_id
         left join briar_account_deletion_job_organizations stored_scope
           on stored_scope.job_id = ?
          and stored_scope.organization_id = stored_project.organization_id
         left join briar_hunt_runs run on run.id = image.run_id
         left join briar_projects current_project
           on current_project.id = run.project_id
         left join briar_account_deletion_job_organizations current_scope
           on current_scope.job_id = ?
          and current_scope.organization_id = current_project.organization_id
         where stored_scope.organization_id is not null
            or current_scope.organization_id is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', agent.avatar_spritesheet_object_key,
                'organization:' || agent.organization_id, null, ?
         from briar_project_agents agent
         join briar_account_deletion_job_organizations scope
           on scope.job_id = ?
          and scope.organization_id = agent.organization_id
         where agent.avatar_spritesheet_object_key is not null
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key,
                'organization:' || attachment.organization_id, null, ?
         from briar_channel_message_attachments attachment
         join briar_account_deletion_job_organizations scope
           on scope.job_id = ?
          and scope.organization_id = attachment.organization_id
         ${cleanupUpsert}`,
      )
      .bind(input.observedAt, jobId),
    db
      .prepare(
        `insert into briar_slack_revocation_queue (
           id, team_id, encrypted_bot_token, token_iv, queued_at,
           next_attempt_at
         )
         select lower(hex(randomblob(32))), installation.team_id,
                installation.encrypted_bot_token, installation.token_iv, ?, ?
         from briar_slack_installations installation
         join briar_account_deletion_job_organizations scope
           on scope.job_id = ?
          and scope.organization_id = installation.organization_id`,
      )
      .bind(input.observedAt, input.observedAt, jobId),
  ];
  statements.push(
    db
      .prepare(
        `delete from verification
         where lower(identifier) = lower(?)
           and exists (
             select 1 from briar_account_deletion_jobs where id = ?
           )`,
      )
      .bind(input.email, jobId),
    db
      .prepare(
        `delete from deviceCode
         where userId = ?
           and exists (
             select 1 from briar_account_deletion_jobs where id = ?
           )`,
      )
      .bind(input.userId, jobId),
    // issued_to_user_id is ON DELETE SET NULL, so revoke these credentials
    // before deleting the user while the authoritative job guard still exists.
    db
      .prepare(
        `delete from briar_project_agent_tokens
         where issued_to_user_id = ?
           and exists (
             select 1 from briar_account_deletion_jobs where id = ?
           )`,
      )
      .bind(input.userId, jobId),
  );
  const userDeleteIndex = statements.length;
  statements.push(
    db
      .prepare(
        `delete from "user"
         where id = ? and exists (
           select 1 from briar_account_deletion_jobs where id = ?
         )
         returning id`,
      )
      .bind(input.userId, jobId),
    db
      .prepare(
        `delete from briar_organizations
         where id in (
           select organization_id
           from briar_account_deletion_job_organizations
           where job_id = ?
         )
         and not exists (select 1 from "user" where id = ?)`,
      )
      .bind(jobId, input.userId),
    db.prepare(`delete from briar_account_deletion_jobs where id = ?`).bind(jobId),
    db.prepare(`select 1 as present from "user" where id = ?`).bind(input.userId),
  );
  const results = await db.batch(statements);
  if ((results[userDeleteIndex]?.results?.length ?? 0) > 0) {
    return "deleted" as const;
  }
  return (results.at(-1)?.results?.length ?? 0) > 0
    ? ("blocked" as const)
    : ("not_found" as const);
}

export async function listSlackRevocationQueue(
  db: D1Database,
  observedAt: string,
  limit = 100,
) {
  const result = await db
    .prepare(
      `select id, team_id, encrypted_bot_token, token_iv, queued_at,
              next_attempt_at, attempts, last_attempt_at, last_error,
              dead_lettered_at, dead_letter_reason
       from briar_slack_revocation_queue
       where dead_lettered_at is null and next_attempt_at <= ?
       order by next_attempt_at, queued_at, id
       limit ?`,
    )
    .bind(observedAt, Math.max(1, Math.min(limit, 1_000)))
    .all<SlackRevocationQueueRow>();
  return result.results ?? [];
}

export async function completeSlackRevocation(
  db: D1Database,
  id: string,
) {
  await db
    .prepare(`delete from briar_slack_revocation_queue where id = ?`)
    .bind(id)
    .run();
}

export async function failSlackRevocation(
  db: D1Database,
  id: string,
  observedAt: string,
  nextAttemptAt: string,
  error: string,
) {
  const result = await db
    .prepare(
      `update briar_slack_revocation_queue
       set attempts = attempts + 1, last_attempt_at = ?,
           next_attempt_at = ?, last_error = ?
       where id = ? and dead_lettered_at is null`,
    )
    .bind(observedAt, nextAttemptAt, error.slice(0, 1_000), id)
    .run();
  return result.meta.changes > 0;
}

export async function deadLetterSlackRevocation(
  db: D1Database,
  id: string,
  observedAt: string,
  error: string,
) {
  const reason = error.slice(0, 1_000);
  const result = await db
    .prepare(
      `update briar_slack_revocation_queue
       set attempts = attempts + 1, last_attempt_at = ?, last_error = ?,
           dead_lettered_at = ?, dead_letter_reason = ?
       where id = ? and dead_lettered_at is null`,
    )
    .bind(observedAt, reason, observedAt, reason, id)
    .run();
  return result.meta.changes > 0;
}

export async function createOrganization(
  db: D1Database,
  input: { name: string; handle: string; ownerUserId: string },
) {
  const createdAt = new Date().toISOString();
  const organization: OrganizationRow = {
    id: crypto.randomUUID(),
    name: input.name,
    handle: input.handle,
    logo: null,
    role: "owner",
    created_at: createdAt,
  };
  await db.batch([
    db
      .prepare(
        `insert into briar_organizations
         (id, name, handle, created_at, updated_at)
       values (?, ?, ?, ?, ?)`,
      )
      .bind(
        organization.id,
        organization.name,
        organization.handle,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_organization_members
         (organization_id, user_id, role, created_at, updated_at)
       values (?, ?, 'owner', ?, ?)`,
      )
      .bind(organization.id, input.ownerUserId, createdAt, createdAt),
  ]);
  return organization;
}

export async function updateOrganization(
  db: D1Database,
  organizationId: string,
  name: string,
  role: OrganizationRole,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_organizations
       set name = ?, updated_at = ?
       where id = ?`,
    )
    .bind(name, updatedAt, organizationId)
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, name, handle, coalesce(logo_data_url, logo) as logo, created_at
       from briar_organizations
       where id = ?`,
    )
    .bind(organizationId)
    .first<Omit<OrganizationRow, "role">>()
    .then((organization) => (organization ? { ...organization, role } : null));
}

export async function updateOrganizationLogo(
  db: D1Database,
  organizationId: string,
  logo: string | null,
  role: OrganizationRole,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_organizations
       set logo_data_url = ?, logo = null, updated_at = ?
       where id = ?`,
    )
    .bind(logo, updatedAt, organizationId)
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, name, handle, coalesce(logo_data_url, logo) as logo, created_at
       from briar_organizations
       where id = ?`,
    )
    .bind(organizationId)
    .first<Omit<OrganizationRow, "role">>()
    .then((organization) => (organization ? { ...organization, role } : null));
}

export async function isOrganizationHandleAvailable(
  db: D1Database,
  handle: string,
) {
  const organization = await db
    .prepare(`select 1 as found from briar_organizations where handle = ?`)
    .bind(handle)
    .first<{ found: number }>();
  return organization === null;
}

export async function getOrganizationRole(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const row = await db
    .prepare(
      `select role from briar_organization_members
     where organization_id = ? and user_id = ?`,
    )
    .bind(organizationId, userId)
    .first<{ role: OrganizationRole }>();
  return row?.role ?? null;
}

export async function listOrganizationMembers(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `select member.user_id, user.name, user.email, user.image,
            member.role, member.created_at
     from briar_organization_members member
     join "user" on user.id = member.user_id
     where member.organization_id = ?
     order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end,
              lower(user.name), lower(user.email)`,
    )
    .bind(organizationId)
    .all<OrganizationMemberRow>();
  return result.results;
}

export async function addOrganizationMember(
  db: D1Database,
  organizationId: string,
  email: string,
  role: Exclude<OrganizationRole, "owner">,
) {
  const user = await db
    .prepare(`select id from "user" where lower(email) = lower(?)`)
    .bind(email)
    .first<{ id: string }>();
  if (!user) return null;
  const now = new Date().toISOString();
  await db
    .prepare(
      `insert into briar_organization_members
       (organization_id, user_id, role, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(organization_id, user_id) do update set
       role = excluded.role, updated_at = excluded.updated_at
     where briar_organization_members.role != 'owner'`,
    )
    .bind(organizationId, user.id, role, now, now)
    .run();
  return user.id;
}

const organizationInvitationSelect = `
  select invitation.id, invitation.organization_id,
         organization.name as organization_name,
         invitation.initial_project_id,
         project.name as initial_project_name,
         invitation.email_normalized, invitation.role,
         invitation.invited_by_user_id, invitation.expires_at,
         invitation.accepted_at, invitation.accepted_by_user_id,
         invitation.revoked_at, invitation.created_at, invitation.updated_at
  from briar_organization_invitations invitation
  join briar_organizations organization
    on organization.id = invitation.organization_id
  join briar_projects project
    on project.id = invitation.initial_project_id
   and project.organization_id = invitation.organization_id`;

export async function createOrganizationInvitation(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    initialProjectId: string;
    emailNormalized: string;
    role: Exclude<OrganizationRole, "owner">;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  const [project, existingMember] = await Promise.all([
    db
      .prepare(
        `select id from briar_projects
         where id = ? and organization_id = ?`,
      )
      .bind(input.initialProjectId, input.organizationId)
      .first<{ id: string }>(),
    db
      .prepare(
        `select member.user_id
         from briar_organization_members member
         join "user" on "user".id = member.user_id
         where member.organization_id = ? and lower("user".email) = ?`,
      )
      .bind(input.organizationId, input.emailNormalized)
      .first<{ user_id: string }>(),
  ]);
  if (!project) return { outcome: "project_not_found" as const };
  if (existingMember) return { outcome: "already_member" as const };

  await db.batch([
    db
      .prepare(
        `update briar_organization_invitations
         set revoked_at = ?, updated_at = ?
         where organization_id = ? and email_normalized = ?
           and accepted_at is null and revoked_at is null`,
      )
      .bind(
        input.createdAt,
        input.createdAt,
        input.organizationId,
        input.emailNormalized,
      ),
    db
      .prepare(
        `insert into briar_organization_invitations (
           id, organization_id, initial_project_id, email_normalized, role,
           token_hash, invited_by_user_id, expires_at, accepted_at,
           accepted_by_user_id, revoked_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, null, null, null, ?, ?)`,
      )
      .bind(
        input.id,
        input.organizationId,
        input.initialProjectId,
        input.emailNormalized,
        input.role,
        input.tokenHash,
        input.invitedByUserId,
        input.expiresAt,
        input.createdAt,
        input.createdAt,
      ),
  ]);
  const invitation = await getOrganizationInvitationById(db, input.id);
  return invitation
    ? { outcome: "created" as const, invitation }
    : { outcome: "project_not_found" as const };
}

export async function listOrganizationInvitations(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `${organizationInvitationSelect}
       where invitation.organization_id = ?
         and invitation.accepted_at is null
         and invitation.revoked_at is null
       order by invitation.created_at desc, invitation.id`,
    )
    .bind(organizationId)
    .all<OrganizationInvitationRow>();
  return result.results;
}

export async function getOrganizationInvitationById(
  db: D1Database,
  invitationId: string,
) {
  return db
    .prepare(
      `${organizationInvitationSelect}
       where invitation.id = ?`,
    )
    .bind(invitationId)
    .first<OrganizationInvitationRow>();
}

export async function getOrganizationInvitationByTokenHash(
  db: D1Database,
  tokenHash: string,
) {
  return db
    .prepare(
      `${organizationInvitationSelect}
       where invitation.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<OrganizationInvitationRow>();
}

export async function revokeOrganizationInvitation(
  db: D1Database,
  organizationId: string,
  invitationId: string,
  revokedAt: string,
) {
  const result = await db
    .prepare(
      `update briar_organization_invitations
       set revoked_at = ?, updated_at = ?
       where id = ? and organization_id = ?
         and accepted_at is null and revoked_at is null`,
    )
    .bind(revokedAt, revokedAt, invitationId, organizationId)
    .run();
  return result.meta.changes > 0;
}

export type AcceptOrganizationInvitationOutcome =
  | { outcome: "invalid" }
  | { outcome: "expired" }
  | { outcome: "revoked" }
  | { outcome: "email_mismatch" }
  | {
      outcome: "accepted" | "already_accepted";
      invitation: OrganizationInvitationRow;
    };

export async function acceptOrganizationInvitation(
  db: D1Database,
  input: {
    tokenHash: string;
    userId: string;
    emailNormalized: string;
    acceptedAt: string;
  },
): Promise<AcceptOrganizationInvitationOutcome> {
  const invitation = await getOrganizationInvitationByTokenHash(
    db,
    input.tokenHash,
  );
  if (!invitation) return { outcome: "invalid" };
  if (invitation.revoked_at) return { outcome: "revoked" };
  if (invitation.expires_at <= input.acceptedAt) return { outcome: "expired" };
  if (invitation.email_normalized !== input.emailNormalized) {
    return { outcome: "email_mismatch" };
  }
  if (invitation.accepted_at) {
    return invitation.accepted_by_user_id === input.userId
      ? { outcome: "already_accepted", invitation }
      : { outcome: "invalid" };
  }

  await db.batch([
    db
      .prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, ?, ?, ?)
         on conflict(organization_id, user_id) do update set
           role = excluded.role, updated_at = excluded.updated_at
         where briar_organization_members.role != 'owner'`,
      )
      .bind(
        invitation.organization_id,
        input.userId,
        invitation.role,
        input.acceptedAt,
        input.acceptedAt,
      ),
    db
      .prepare(
        `update briar_organization_invitations
         set accepted_at = ?, accepted_by_user_id = ?, updated_at = ?
         where token_hash = ? and accepted_at is null and revoked_at is null
           and expires_at > ?`,
      )
      .bind(
        input.acceptedAt,
        input.userId,
        input.acceptedAt,
        input.tokenHash,
        input.acceptedAt,
      ),
  ]);
  const accepted = await getOrganizationInvitationByTokenHash(
    db,
    input.tokenHash,
  );
  if (!accepted?.accepted_at || accepted.accepted_by_user_id !== input.userId) {
    return { outcome: "invalid" };
  }
  return { outcome: "accepted", invitation: accepted };
}

export async function updateOrganizationMemberRole(
  db: D1Database,
  organizationId: string,
  userId: string,
  role: Exclude<OrganizationRole, "owner">,
) {
  const result = await db
    .prepare(
      `update briar_organization_members
       set role = ?, updated_at = ?
       where organization_id = ? and user_id = ? and role != 'owner'`,
    )
    .bind(role, new Date().toISOString(), organizationId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function removeOrganizationMember(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const updatedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `update briar_hunt_runs
         set assignee_user_id = null, updated_at = ?
         where assignee_user_id = ?
           and project_id in (
             select id from briar_projects where organization_id = ?
           )
           and exists (
             select 1 from briar_organization_members
             where organization_id = ? and user_id = ? and role != 'owner'
           )`,
      )
      .bind(updatedAt, userId, organizationId, organizationId, userId),
    db
      .prepare(
        `delete from briar_organization_members
         where organization_id = ? and user_id = ? and role != 'owner'`,
      )
      .bind(organizationId, userId),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0;
}

export async function createSlackOAuthState(
  db: D1Database,
  input: {
    stateHash: string;
    organizationId: string;
    defaultProjectId: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.batch([
    db
      .prepare(`delete from briar_slack_oauth_states where expires_at <= ?`)
      .bind(input.createdAt),
    db
      .prepare(
        `insert into briar_slack_oauth_states (
           state_hash, organization_id, default_project_id, user_id,
           expires_at, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.stateHash,
        input.organizationId,
        input.defaultProjectId,
        input.userId,
        input.expiresAt,
        input.createdAt,
      ),
  ]);
}

export async function consumeSlackOAuthState(
  db: D1Database,
  stateHash: string,
  now: string,
) {
  const state = await db
    .prepare(
      `select state_hash, organization_id, default_project_id, user_id,
              expires_at, created_at
       from briar_slack_oauth_states
       where state_hash = ? and expires_at > ?`,
    )
    .bind(stateHash, now)
    .first<SlackOAuthStateRow>();
  if (!state) return null;
  const deleted = await db
    .prepare(`delete from briar_slack_oauth_states where state_hash = ?`)
    .bind(stateHash)
    .run();
  return deleted.meta.changes > 0 ? state : null;
}

export async function createGithubOAuthState(
  db: D1Database,
  input: {
    stateHash: string;
    organizationId: string;
    userId: string;
    pkceVerifier: string;
    installationId?: number | null;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.batch([
    db
      .prepare(`delete from briar_github_oauth_states where expires_at <= ?`)
      .bind(input.createdAt),
    db
      .prepare(
        `insert into briar_github_oauth_states (
           state_hash, organization_id, user_id, pkce_verifier,
           installation_id, expires_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.stateHash,
        input.organizationId,
        input.userId,
        input.pkceVerifier,
        input.installationId ?? null,
        input.expiresAt,
        input.createdAt,
        input.createdAt,
      ),
  ]);
}

export async function consumeGithubInstallState(
  db: D1Database,
  stateHash: string,
  now: string,
) {
  const state = await db
    .prepare(
      `select state_hash, organization_id, user_id, pkce_verifier,
              installation_id, expires_at, created_at, updated_at
       from briar_github_oauth_states
       where state_hash = ? and expires_at > ?
         and installation_id is null`,
    )
    .bind(stateHash, now)
    .first<GithubOAuthStateRow>();
  if (!state) return null;
  const deleted = await db
    .prepare(`delete from briar_github_oauth_states where state_hash = ?`)
    .bind(stateHash)
    .run();
  return (deleted.meta.changes ?? 0) > 0 ? state : null;
}

export async function consumeGithubOAuthState(
  db: D1Database,
  stateHash: string,
  now: string,
) {
  const state = await db
    .prepare(
      `select state_hash, organization_id, user_id, pkce_verifier,
              installation_id, expires_at, created_at, updated_at
       from briar_github_oauth_states
       where state_hash = ? and expires_at > ?
         and installation_id is not null`,
    )
    .bind(stateHash, now)
    .first<GithubOAuthStateRow>();
  if (!state) return null;
  const deleted = await db
    .prepare(`delete from briar_github_oauth_states where state_hash = ?`)
    .bind(stateHash)
    .run();
  return (deleted.meta.changes ?? 0) > 0 ? state : null;
}

export async function getGithubConnectionByInstallation(
  db: D1Database,
  installationId: number,
) {
  return db
    .prepare(
      `select installation_id, organization_id, installation_account_id,
              account_login, account_avatar_url, authorized_github_user_id,
              authorized_github_user_login, connected_by_user_id, status,
              connected_at, disconnected_at, updated_at
       from briar_github_connections
       where installation_id = ?`,
    )
    .bind(installationId)
    .first<GithubConnectionRow>();
}

export async function getGithubConnectionForOrganization(
  db: D1Database,
  organizationId: string,
) {
  return db
    .prepare(
      `select installation_id, organization_id, installation_account_id,
              account_login, account_avatar_url, authorized_github_user_id,
              authorized_github_user_login, connected_by_user_id, status,
              connected_at, disconnected_at, updated_at
       from briar_github_connections
       where organization_id = ? and status = 'connected'
       order by updated_at desc
       limit 1`,
    )
    .bind(organizationId)
    .first<GithubConnectionRow>();
}

export async function listGithubConnectionRepositories(
  db: D1Database,
  installationId: number,
) {
  const result = await db
    .prepare(
      `select installation_id, repository_id, owner, name, full_name,
              created_at, updated_at
       from briar_github_connection_repositories
       where installation_id = ?
       order by lower(full_name), repository_id`,
    )
    .bind(installationId)
    .all<GithubConnectionRepositoryRow>();
  return result.results;
}

export async function syncGithubConnectionRepositories(
  db: D1Database,
  input: {
    installationId: number;
    added: Array<{
      id: number;
      owner: string;
      name: string;
      fullName: string;
    }>;
    removedIds: number[];
    observedAt: string;
  },
) {
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_github_connection_repositories (
           installation_id, repository_id, owner, name, full_name,
           created_at, updated_at
         )
         select ?,
                cast(json_extract(repository.value, '$.id') as integer),
                json_extract(repository.value, '$.owner'),
                json_extract(repository.value, '$.name'),
                json_extract(repository.value, '$.fullName'),
                ?, ?
         from json_each(?) repository
         where exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.status = 'connected'
         )
         on conflict(installation_id, repository_id) do update set
           owner = excluded.owner,
           name = excluded.name,
           full_name = excluded.full_name,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.installationId,
        input.observedAt,
        input.observedAt,
        JSON.stringify(input.added),
        input.installationId,
      ),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ? and repository_id in (
           select cast(value as integer) from json_each(?)
         ) and exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.status = 'connected'
         )`,
      )
      .bind(
        input.installationId,
        JSON.stringify(input.removedIds),
        input.installationId,
      ),
    db
      .prepare(
        `update briar_github_connections set updated_at = ?
         where installation_id = ? and status = 'connected'`,
      )
      .bind(input.observedAt, input.installationId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}

export async function connectGithubInstallation(
  db: D1Database,
  input: {
    organizationId: string;
    installationId: number;
    installationAccountId: number;
    accountLogin: string;
    accountAvatarUrl: string;
    authorizedGithubUserId: number;
    authorizedGithubUserLogin: string;
    connectedByUserId: string;
    repositories: Array<{
      id: number;
      owner: string;
      name: string;
      fullName: string;
    }>;
    observedAt: string;
  },
) {
  const statements = [
    db
      .prepare(
        `insert into briar_github_connections (
           installation_id, organization_id, installation_account_id,
           account_login, account_avatar_url, authorized_github_user_id,
           authorized_github_user_login, connected_by_user_id, status,
           connected_at, disconnected_at, updated_at
         )
         select ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, null, ?
         where not exists (
           select 1 from briar_github_connections active
           where active.organization_id = ? and active.status = 'connected'
             and active.installation_id <> ?
         )
         on conflict(installation_id) do update set
           organization_id = excluded.organization_id,
           installation_account_id = excluded.installation_account_id,
           account_login = excluded.account_login,
           account_avatar_url = excluded.account_avatar_url,
           authorized_github_user_id = excluded.authorized_github_user_id,
           authorized_github_user_login = excluded.authorized_github_user_login,
           connected_by_user_id = excluded.connected_by_user_id,
           status = 'connected',
           connected_at = excluded.connected_at,
           disconnected_at = null,
           updated_at = excluded.updated_at
         where briar_github_connections.status = 'disconnected'
            or briar_github_connections.organization_id = excluded.organization_id`,
      )
      .bind(
        input.installationId,
        input.organizationId,
        input.installationAccountId,
        input.accountLogin,
        input.accountAvatarUrl,
        input.authorizedGithubUserId,
        input.authorizedGithubUserLogin,
        input.connectedByUserId,
        input.observedAt,
        input.observedAt,
        input.organizationId,
        input.installationId,
      ),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ? and exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.organization_id = ?
             and connection.status = 'connected'
             and connection.updated_at = ?
         )`,
      )
      .bind(
        input.installationId,
        input.installationId,
        input.organizationId,
        input.observedAt,
      ),
    db
      .prepare(
        `insert into briar_github_connection_repositories (
           installation_id, repository_id, owner, name, full_name,
           created_at, updated_at
         )
         select ?,
                cast(json_extract(repository.value, '$.id') as integer),
                json_extract(repository.value, '$.owner'),
                json_extract(repository.value, '$.name'),
                json_extract(repository.value, '$.fullName'),
                ?, ?
         from json_each(?) repository
         where exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = ?
             and connection.organization_id = ?
             and connection.status = 'connected'
             and connection.updated_at = ?
         )`,
      )
      .bind(
        input.installationId,
        input.observedAt,
        input.observedAt,
        JSON.stringify(input.repositories),
        input.installationId,
        input.organizationId,
        input.observedAt,
      ),
  ];
  await db.batch(statements);
  const connection = await getGithubConnectionByInstallation(
    db,
    input.installationId,
  );
  if (
    connection?.status === "connected" &&
    connection.organization_id === input.organizationId
  ) {
    return { outcome: "connected" as const };
  }
  if (connection?.status === "connected") {
    return { outcome: "installation_conflict" as const };
  }
  const activeForOrganization = await getGithubConnectionForOrganization(
    db,
    input.organizationId,
  );
  if (
    activeForOrganization &&
    activeForOrganization.installation_id !== input.installationId
  ) {
    return { outcome: "organization_conflict" as const };
  }
  throw new Error("GitHub connection could not be persisted");
}

export async function disconnectGithubInstallation(
  db: D1Database,
  organizationId: string,
  observedAt: string,
) {
  const connection = await getGithubConnectionForOrganization(
    db,
    organizationId,
  );
  if (!connection) return false;
  const results = await db.batch([
    db
      .prepare(
        `update briar_github_connections
         set status = 'disconnected', disconnected_at = ?, updated_at = ?
         where organization_id = ? and installation_id = ?
           and status = 'connected'`,
      )
      .bind(
        observedAt,
        observedAt,
        organizationId,
        connection.installation_id,
      ),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ?`,
      )
      .bind(connection.installation_id),
    db
      .prepare(
        `delete from briar_github_pull_requests where installation_id = ?`,
      )
      .bind(connection.installation_id),
    db
      .prepare(
        `update briar_run_pull_requests
         set state = 'unknown', draft = null, head_sha = null,
             base_sha = null, merge_commit_sha = null, opened_at = null,
             closed_at = null, merged_at = null, provider_updated_at = null,
             last_delivery_id = null, updated_at = ?
         where installation_id = ?`,
      )
      .bind(observedAt, connection.installation_id),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

export async function disconnectGithubInstallationById(
  db: D1Database,
  installationId: number,
  observedAt: string,
) {
  const results = await db.batch([
    db
      .prepare(
        `update briar_github_connections
         set status = 'disconnected', disconnected_at = ?, updated_at = ?
         where installation_id = ? and status = 'connected'`,
      )
      .bind(observedAt, observedAt, installationId),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id = ?`,
      )
      .bind(installationId),
    db
      .prepare(
        `delete from briar_github_pull_requests where installation_id = ?`,
      )
      .bind(installationId),
    db
      .prepare(
        `update briar_run_pull_requests
         set state = 'unknown', draft = null, head_sha = null,
             base_sha = null, merge_commit_sha = null, opened_at = null,
             closed_at = null, merged_at = null, provider_updated_at = null,
             last_delivery_id = null, updated_at = ?
         where installation_id = ?`,
      )
      .bind(observedAt, installationId),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

export async function disconnectGithubInstallationsByAuthorizedUser(
  db: D1Database,
  githubUserId: number,
  observedAt: string,
) {
  const connected = await db
    .prepare(
      `select installation_id
       from briar_github_connections
       where authorized_github_user_id = ? and status = 'connected'`,
    )
    .bind(githubUserId)
    .all<{ installation_id: number }>();
  if (connected.results.length === 0) return 0;
  const installationIds = connected.results.map((row) => row.installation_id);
  const placeholders = installationIds.map(() => "?").join(", ");
  const results = await db.batch([
    db
      .prepare(
        `update briar_github_connections
         set status = 'disconnected', disconnected_at = ?, updated_at = ?
         where authorized_github_user_id = ? and status = 'connected'`,
      )
      .bind(observedAt, observedAt, githubUserId),
    db
      .prepare(
        `delete from briar_github_connection_repositories
         where installation_id in (${placeholders})`,
      )
      .bind(...installationIds),
    db
      .prepare(
        `delete from briar_github_pull_requests
         where installation_id in (${placeholders})`,
      )
      .bind(...installationIds),
    db
      .prepare(
        `update briar_run_pull_requests
         set state = 'unknown', draft = null, head_sha = null,
             base_sha = null, merge_commit_sha = null, opened_at = null,
             closed_at = null, merged_at = null, provider_updated_at = null,
             last_delivery_id = null, updated_at = ?
         where installation_id in (${placeholders})`,
      )
      .bind(observedAt, ...installationIds),
  ]);
  return results[0]?.meta.changes ?? 0;
}

export async function upsertSlackInstallation(
  db: D1Database,
  input: {
    teamId: string;
    teamName: string;
    organizationId: string;
    defaultProjectId: string;
    botUserId: string;
    encryptedBotToken: string;
    tokenIv: string;
    installedByUserId: string;
    observedAt: string;
  },
) {
  await db
    .prepare(
      `insert into briar_slack_installations (
         team_id, team_name, organization_id, default_project_id, bot_user_id,
         encrypted_bot_token, token_iv, installed_by_user_id,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(team_id) do update set
         team_name = excluded.team_name,
         organization_id = excluded.organization_id,
         default_project_id = excluded.default_project_id,
         bot_user_id = excluded.bot_user_id,
         encrypted_bot_token = excluded.encrypted_bot_token,
         token_iv = excluded.token_iv,
         installed_by_user_id = excluded.installed_by_user_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.teamId,
      input.teamName,
      input.organizationId,
      input.defaultProjectId,
      input.botUserId,
      input.encryptedBotToken,
      input.tokenIv,
      input.installedByUserId,
      input.observedAt,
      input.observedAt,
    )
    .run();
}

const slackInstallationSelect = `
  select installation.team_id, installation.team_name,
         installation.organization_id, installation.default_project_id,
         project.name as default_project_name, installation.bot_user_id,
         installation.encrypted_bot_token, installation.token_iv,
         installation.installed_by_user_id, installation.created_at,
         installation.updated_at
  from briar_slack_installations installation
  left join briar_projects project on project.id = installation.default_project_id
`;

export async function getSlackInstallation(
  db: D1Database,
  teamId: string,
) {
  return db
    .prepare(`${slackInstallationSelect} where installation.team_id = ?`)
    .bind(teamId)
    .first<SlackInstallationRow>();
}

export async function listSlackInstallations(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `${slackInstallationSelect}
       where installation.organization_id = ?
       order by installation.created_at`,
    )
    .bind(organizationId)
    .all<SlackInstallationRow>();
  return result.results;
}

export async function updateSlackInstallationProject(
  db: D1Database,
  organizationId: string,
  teamId: string,
  projectId: string,
) {
  const result = await db
    .prepare(
      `update briar_slack_installations
       set default_project_id = ?, updated_at = ?
       where organization_id = ? and team_id = ?
         and exists (
           select 1 from briar_projects
           where id = ? and organization_id = ?
         )`,
    )
    .bind(
      projectId,
      new Date().toISOString(),
      organizationId,
      teamId,
      projectId,
      organizationId,
    )
    .run();
  return result.meta.changes > 0;
}

export async function deleteSlackInstallation(
  db: D1Database,
  input: {
    organizationId: string;
    teamId: string;
    actorUserId: string;
    observedAt: string;
  },
) {
  const queueId = Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_slack_revocation_queue (
           id, team_id, encrypted_bot_token, token_iv, queued_at,
           next_attempt_at
         )
         select ?, installation.team_id, installation.encrypted_bot_token,
                installation.token_iv, ?, ?
         from briar_slack_installations installation
         where installation.organization_id = ?
           and installation.team_id = ?
           and exists (
             select 1 from briar_organization_members membership
             where membership.organization_id = installation.organization_id
               and membership.user_id = ?
               and membership.role in ('owner', 'admin')
           )`,
      )
      .bind(
        queueId,
        input.observedAt,
        input.observedAt,
        input.organizationId,
        input.teamId,
        input.actorUserId,
      ),
    db
      .prepare(
        `delete from briar_slack_installations
         where organization_id = ? and team_id = ?
           and exists (
             select 1 from briar_slack_revocation_queue queue
             where queue.id = ? and queue.team_id = briar_slack_installations.team_id
           )`,
      )
      .bind(input.organizationId, input.teamId, queueId),
    db
      .prepare(
        `select 1 as present from briar_slack_installations
         where organization_id = ? and team_id = ?`,
      )
      .bind(input.organizationId, input.teamId),
  ]);
  if ((results[1]?.meta.changes ?? 0) > 0) return "deleted" as const;
  return (results[2]?.results?.length ?? 0) > 0
    ? ("forbidden" as const)
    : ("not_found" as const);
}

export async function claimSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
  claimedAt: string,
  staleBefore: string,
) {
  const retentionBefore = new Date(
    Date.parse(claimedAt) - 30 * 24 * 60 * 60_000,
  ).toISOString();
  await db
    .prepare(
      `delete from briar_slack_events
       where coalesce(completed_at, claimed_at) < ?`,
    )
    .bind(retentionBefore)
    .run();
  const result = await db
    .prepare(
      `insert into briar_slack_events (
         team_id, event_id, status, claimed_at, completed_at
       ) values (?, ?, 'processing', ?, null)
       on conflict(team_id, event_id) do update set
         status = 'processing', claimed_at = excluded.claimed_at,
         completed_at = null
       where briar_slack_events.status = 'processing'
         and briar_slack_events.claimed_at < ?`,
    )
    .bind(teamId, eventId, claimedAt, staleBefore)
    .run();
  return result.meta.changes > 0;
}

export async function completeSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
  completedAt: string,
) {
  await db
    .prepare(
      `update briar_slack_events
       set status = 'completed', completed_at = ?
       where team_id = ? and event_id = ?`,
    )
    .bind(completedAt, teamId, eventId)
    .run();
}

export async function releaseSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
) {
  await db
    .prepare(
      `delete from briar_slack_events
       where team_id = ? and event_id = ? and status = 'processing'`,
    )
    .bind(teamId, eventId)
    .run();
}

export async function claimGithubDelivery(
  db: D1Database,
  input: {
    deliveryId: string;
    eventName: string;
    action: string | null;
    claimedAt: string;
    staleBefore: string;
  },
) {
  const retentionBefore = new Date(
    Date.parse(input.claimedAt) - 30 * 24 * 60 * 60_000,
  ).toISOString();
  await db
    .prepare(
      `delete from briar_github_deliveries
       where coalesce(completed_at, claimed_at) < ?`,
    )
    .bind(retentionBefore)
    .run();
  const result = await db
    .prepare(
      `insert into briar_github_deliveries (
         delivery_id, event_name, action, status, claimed_at, completed_at
       ) values (?, ?, ?, 'processing', ?, null)
       on conflict(delivery_id) do update set
         event_name = excluded.event_name,
         action = excluded.action,
         status = 'processing',
         claimed_at = excluded.claimed_at,
         completed_at = null
       where briar_github_deliveries.status = 'processing'
         and briar_github_deliveries.claimed_at < ?`,
    )
    .bind(
      input.deliveryId,
      input.eventName,
      input.action,
      input.claimedAt,
      input.staleBefore,
    )
    .run();
  return result.meta.changes > 0;
}

export async function completeGithubDelivery(
  db: D1Database,
  deliveryId: string,
  claimedAt: string,
  completedAt: string,
) {
  const result = await db
    .prepare(
      `update briar_github_deliveries
       set status = 'completed', completed_at = ?
       where delivery_id = ? and status = 'processing' and claimed_at = ?`,
    )
    .bind(completedAt, deliveryId, claimedAt)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function releaseGithubDelivery(
  db: D1Database,
  deliveryId: string,
  claimedAt: string,
) {
  const result = await db
    .prepare(
      `delete from briar_github_deliveries
       where delivery_id = ? and status = 'processing' and claimed_at = ?`,
    )
    .bind(deliveryId, claimedAt)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listProjects(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `select project.id, project.name,
              project.issue_key_prefix,
              coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
              project.organization_id,
              organization.name as organization_name,
              membership.role as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization on organization.id = project.organization_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       order by organization.created_at, project.created_at`,
    )
    .bind(userId)
    .all<ProjectRow>();
  return result.results;
}

export async function listOrganizationProjects(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `select project.id, project.name,
              project.issue_key_prefix,
              coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
              project.organization_id,
              organization.name as organization_name,
              'member' as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization
         on organization.id = project.organization_id
       where project.organization_id = ?
       order by project.created_at`,
    )
    .bind(organizationId)
    .all<ProjectRow>();
  return result.results;
}

export async function listOrganizationInboxProjects(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `select id, name, issue_key_prefix
       from briar_projects
       where organization_id = ?
       order by created_at, id`,
    )
    .bind(organizationId)
    .all<Pick<ProjectRow, "id" | "name" | "issue_key_prefix">>();
  return result.results;
}

export async function getOrganizationInboxSyncVersion(
  db: D1Database,
  organizationId: string,
) {
  const state = await db
    .prepare(
      `select current_version
       from briar_organization_inbox_sync_state
       where organization_id = ?`,
    )
    .bind(organizationId)
    .first<{ current_version: number }>();
  return state?.current_version ?? 0;
}

export type OrganizationInboxRealtimeOutboxRow = {
  organization_id: string;
  version: number;
};

export async function listOrganizationInboxRealtimeOutbox(
  db: D1Database,
  limit = 100,
) {
  const result = await db
    .prepare(
      `select organization_id, version
       from briar_organization_inbox_realtime_outbox
       order by updated_at, organization_id
       limit ?`,
    )
    .bind(Math.max(1, Math.min(limit, 100)))
    .all<OrganizationInboxRealtimeOutboxRow>();
  return result.results;
}

export async function acknowledgeOrganizationInboxRealtimeOutbox(
  db: D1Database,
  organizationId: string,
  version: number,
) {
  await db
    .prepare(
      `delete from briar_organization_inbox_realtime_outbox
       where organization_id = ? and version <= ?`,
    )
    .bind(organizationId, version)
    .run();
}

export async function createProject(
  db: D1Database,
  input: {
    ownerUserId: string;
    organizationId: string;
    name: string;
    agentTokenHash: string;
    locale?: ProjectAgentLocale;
  },
) {
  const createdAt = new Date().toISOString();
  const project: ProjectRow = {
    id: crypto.randomUUID(),
    name: input.name,
    issue_key_prefix: "AH",
    icon: null,
    organization_id: input.organizationId,
    organization_name: "",
    member_role: "owner",
    created_at: createdAt,
  };
  const locale = input.locale ?? "en";
  const defaultAgentCopy = defaultProjectAgentCopy(locale);
  const defaultAgent: ProjectAgentRow = {
    id: crypto.randomUUID(),
    organization_id: input.organizationId,
    project_id: project.id,
    name: defaultAgentCopy.name,
    avatar: null,
    avatar_pet_json: null,
    avatar_spritesheet_object_key: null,
    provider: "codex",
    model: null,
    effort: null,
    responsibility: defaultAgentCopy.responsibility,
    skill_markdown: projectAgentSkill({
      name: defaultAgentCopy.name,
      responsibility: defaultAgentCopy.responsibility,
    }),
    calendar_color: defaultProjectAgentCalendarColor,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const initialWorkflow = cloneAutoHuntWorkflow();
  await db.batch([
        db
          .prepare(
            `insert into briar_projects (
               id, owner_user_id, organization_id, name, agent_token_hash,
               created_at, updated_at
             ) values (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            project.id,
            input.ownerUserId,
            input.organizationId,
            project.name,
            input.agentTokenHash,
            createdAt,
            createdAt,
          ),
        db
          .prepare(
            `insert into briar_project_settings (
               project_id, workflow_json, mandatory_checkpoints_json,
               created_at, updated_at
             ) values (?, ?, ?, ?, ?)`,
          )
          .bind(
            project.id,
            stableJson(initialWorkflow),
            stableJson([]),
            createdAt,
            createdAt,
          ),
        db
          .prepare(
            `insert into briar_project_agents (
               id, organization_id, project_id, name, provider, model,
               responsibility, skill_markdown, calendar_color, created_at,
               updated_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            defaultAgent.id,
            input.organizationId,
            defaultAgent.project_id,
            defaultAgent.name,
            defaultAgent.provider,
            defaultAgent.model,
            defaultAgent.responsibility,
            defaultAgent.skill_markdown,
            defaultAgent.calendar_color,
            defaultAgent.created_at,
            defaultAgent.updated_at,
          ),
      ]);
  return project;
}

export async function getProject(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  return await db
    .prepare(
      `select project.id, project.name,
              project.issue_key_prefix,
              coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
              project.organization_id,
              organization.name as organization_name,
              membership.role as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization on organization.id = project.organization_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       where project.id = ?`,
    )
    .bind(userId, projectId)
    .first<ProjectRow>();
}

export async function updateProjectIcon(
  db: D1Database,
  projectId: string,
  icon: string | null,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_projects
       set icon_data_url_browser = ?, icon_data_url = null, updated_at = ?
       where id = ?`,
    )
    .bind(icon, updatedAt, projectId)
    .run();
  return result.meta.changes > 0;
}

export async function updateProjectIssueKeyPrefix(
  db: D1Database,
  projectId: string,
  issueKeyPrefix: string,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_projects
       set issue_key_prefix = ?, updated_at = ?
       where id = ?`,
    )
    .bind(issueKeyPrefix, updatedAt, projectId)
    .run();
  return result.meta.changes > 0;
}

const archiveCleanupQueueUpsertSql = `
  on conflict (bucket, object_key) do update set
    project_id = excluded.project_id,
    run_id = excluded.run_id,
    queued_at = excluded.queued_at,
    attempts = 0,
    last_attempt_at = null,
    last_error = null,
    generation = briar_archive_cleanup_queue.generation + 1,
    next_attempt_at = null,
    dead_lettered_at = null,
    alert_state = 'none',
    alert_detail_json = null`;

export async function deleteProject(
  db: D1Database,
  projectId: string,
  userId: string,
  observedAt = new Date().toISOString(),
) {
  const authorizedProject = `exists (
    select 1
    from briar_projects target
    join briar_organization_members membership
      on membership.organization_id = target.organization_id
    where target.id = ? and membership.user_id = ?
      and membership.role = 'owner'
  )`;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'archives', archive.object_key, ?, null, ?
         from briar_log_archives archive
         where (
           archive.project_id = ?
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = archive.run_id and run.project_id = ?
           )
         ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', related.value, ?, null, ?
         from briar_log_archives archive,
              json_each(archive.related_object_keys_json) related
         where related.type = 'text'
           and (
             archive.project_id = ?
             or exists (
               select 1 from briar_hunt_runs run
               where run.id = archive.run_id and run.project_id = ?
             )
           ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key, ?, null, ?
         from briar_issue_attachments attachment
         where (
           attachment.project_id = ?
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = attachment.run_id and run.project_id = ?
           )
         ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', image.object_key, ?, null, ?
         from briar_run_evidence_images image
         where (
           image.project_id = ?
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = image.run_id and run.project_id = ?
           )
         ) and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(
        projectId,
        observedAt,
        projectId,
        projectId,
        projectId,
        userId,
      ),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', agent.avatar_spritesheet_object_key, ?, null, ?
         from briar_project_agents agent
         where agent.project_id = ?
           and agent.avatar_spritesheet_object_key is not null
           and ${authorizedProject}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, observedAt, projectId, projectId, userId),
    db
      .prepare(
        `delete from briar_projects
         where id = ? and organization_id in (
           select organization_id from briar_organization_members
           where user_id = ? and role = 'owner'
         )
         returning id`,
      )
      .bind(projectId, userId),
  ]);
  return (results.at(-1)?.results?.length ?? 0) > 0;
}

export async function getProjectRunChildMismatch(
  db: D1Database,
  projectId: string,
) {
  type Mismatch = {
      stale_project_id: string;
      current_project_id: string;
      run_id: string;
      entity_kind: string;
      entity_id: string;
  };
  for (const view of [
    "briar_run_child_storage_a_project_mismatches",
    "briar_run_child_storage_b_project_mismatches",
    "briar_run_child_relation_a_project_mismatches",
    "briar_run_child_relation_b_project_mismatches",
  ]) {
    const mismatch = await db
      .prepare(
        `select stale_project_id, current_project_id, run_id, entity_kind,
                entity_id
         from ${view}
         where stale_project_id = ? or current_project_id = ?
         order by entity_kind, entity_id
         limit 1`,
      )
      .bind(projectId, projectId)
      .first<Mismatch>();
    if (mismatch) return mismatch;
  }
  return null;
}

export async function listProjectAgents(db: D1Database, projectId: string) {
  const result = await db
    .prepare(
      `select id, organization_id, project_id, name, avatar, avatar_pet_json,
              avatar_spritesheet_object_key, provider, model, effort, responsibility, skill_markdown, calendar_color,
              created_at, updated_at
       from briar_project_agents
       where project_id = ?
       order by created_at, id`,
    )
    .bind(projectId)
    .all<ProjectAgentRow>();
  return hydrateAgentSkills(db, result.results);
}

export async function getProjectAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
) {
  const agent = await db
    .prepare(
      `select id, organization_id, project_id, name, avatar, avatar_pet_json,
              avatar_spritesheet_object_key, provider, model, effort, responsibility,
              skill_markdown, calendar_color, created_at, updated_at
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(agentId, projectId)
    .first<ProjectAgentRow>();
  if (!agent) return null;
  return (await hydrateAgentSkills(db, [agent]))[0];
}

const projectAgentSessionChangePageSize = 500;

const projectAgentSessionSummaryJson = (row: ProjectAgentSessionRow) => {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  const status = typeof payload.status === "string"
    ? payload.status
    : row.status;
  const startedAt = typeof payload.startedAt === "string"
    ? payload.startedAt
    : row.started_at;
  const completedAt = typeof payload.completedAt === "string"
    ? payload.completedAt
    : row.completed_at;
  const issues = Array.isArray(payload.issues)
    ? payload.issues.map((value) => {
        const issue = value as Record<string, unknown>;
        return {
          runId: issue.runId,
          runNumber: issue.runNumber,
          sourceKey: issue.sourceKey,
          title: issue.title,
          outcome: issue.outcome,
          summary: null,
        };
      })
    : [];
  return JSON.stringify({
    dispatchGroupId: payload.dispatchGroupId ?? row.id,
    agentId: payload.agentId ?? row.agent_id,
    agentName: payload.agentName ?? null,
    skillId: payload.skillId ?? null,
    sessionType: payload.sessionType ?? row.session_type,
    trigger: payload.trigger ?? null,
    scheduleId: payload.scheduleId ?? null,
    scheduleRunId: payload.scheduleRunId ?? null,
    parentSessionId: payload.parentSessionId ?? null,
    request: typeof payload.request === "string"
      ? payload.request.slice(0, 500)
      : null,
    status,
    issues,
    startedAt,
    completedAt,
    inboxVersion: inboxSessionMessageVersion(
      status,
      completedAt ?? startedAt,
    ),
    requestedWorkerId: payload.requestedWorkerId ?? null,
    workerId: payload.workerId ?? null,
    updatedAt: payload.updatedAt ?? row.updated_at,
  });
};

const upsertProjectAgentSessionSummaryStatement = (
  db: D1Database,
  row: ProjectAgentSessionRow,
  archived: boolean,
) =>
  db.prepare(
    `insert into briar_project_agent_session_summaries (
       project_id, session_id, summary_json, updated_at, archived
     ) values (?, ?, ?, ?, ?)
     on conflict (project_id, session_id) do update set
       summary_json = excluded.summary_json,
       updated_at = excluded.updated_at,
       archived = excluded.archived
     where excluded.updated_at > briar_project_agent_session_summaries.updated_at
        or excluded.archived <> briar_project_agent_session_summaries.archived`,
  ).bind(
    row.project_id,
    row.id,
    projectAgentSessionSummaryJson(row),
    row.updated_at,
    archived ? 1 : 0,
  );

export async function upsertProjectAgentSessionSummary(
  db: D1Database,
  row: ProjectAgentSessionRow,
  archived: boolean,
) {
  return upsertProjectAgentSessionSummaryStatement(db, row, archived).run();
}

export async function listProjectAgentSessionSummaries(
  db: D1Database,
  projectId: string,
  sessionIds?: readonly string[],
) {
  if (sessionIds?.length === 0) return [];
  const idFilter = sessionIds
    ? `and session_id in (${sessionIds.map(() => "?").join(",")})`
    : "";
  const rowLimit = sessionIds ? projectAgentSessionChangePageSize : 200;
  const result = await db
    .prepare(
      `select project_id, session_id, summary_json, updated_at, archived
       from briar_project_agent_session_summaries
       where project_id = ? ${idFilter}
       order by updated_at desc, session_id
       limit ?`,
    )
    .bind(projectId, ...(sessionIds ?? []), rowLimit)
    .all<ProjectAgentSessionSummaryRow>();
  return result.results;
}

export async function getProjectAgentSessionSyncCursor(
  db: D1Database,
  projectId: string,
) {
  const state = await db
    .prepare(
      `select current_version from briar_project_agent_session_sync_state
       where project_id = ?`,
    )
    .bind(projectId)
    .first<{ current_version: number }>();
  return state?.current_version ?? 0;
}

export async function listProjectAgentSessionChanges(
  db: D1Database,
  projectId: string,
  cursor: number,
): Promise<ProjectAgentSessionChangesPage> {
  const currentVersion = await getProjectAgentSessionSyncCursor(db, projectId);
  const oldest = await db
    .prepare(
      `select min(version) as oldest_version
       from briar_project_agent_session_changes where project_id = ?`,
    )
    .bind(projectId)
    .first<{ oldest_version: number | null }>();
  const oldestVersion = oldest?.oldest_version ?? null;
  const expired =
    cursor < 0 ||
    cursor > currentVersion ||
    (cursor < currentVersion &&
      (oldestVersion === null || cursor < oldestVersion - 1));
  if (expired) {
    return {
      currentVersion,
      changes: [],
      hasMore: false,
      nextCursor: currentVersion,
      expired: true,
    };
  }
  const result = await db
    .prepare(
      `select version, session_id, operation
       from briar_project_agent_session_changes
       where project_id = ? and version > ? and version <= ?
       order by version
       limit ?`,
    )
    .bind(
      projectId,
      cursor,
      currentVersion,
      projectAgentSessionChangePageSize + 1,
    )
    .all<ProjectAgentSessionChangeRow>();
  const hasMore = result.results.length > projectAgentSessionChangePageSize;
  const changes = result.results.slice(0, projectAgentSessionChangePageSize);
  return {
    currentVersion,
    changes,
    hasMore,
    nextCursor: hasMore
      ? (changes.at(-1)?.version ?? cursor)
      : currentVersion,
    expired: false,
  };
}

export async function listProjectAgentSessions(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select project_id, id, agent_id, status, session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ?
       order by updated_at desc, id
       limit 200`,
    )
    .bind(projectId)
    .all<ProjectAgentSessionRow>();
  return result.results;
}

export async function getProjectAgentSession(
  db: D1Database,
  projectId: string,
  sessionId: string,
) {
  return db
    .prepare(
      `select project_id, id, agent_id, status, session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ? and id = ?`,
    )
    .bind(projectId, sessionId)
    .first<ProjectAgentSessionRow>();
}

export async function projectAgentSessionIsApprovalOwned(
  db: D1Database,
  projectId: string,
  sessionId: string,
) {
  const row = await db
    .prepare(
      `select 1 as owned
       from briar_agent_skill_execution_approval_audit
       where project_id = ? and result_session_id = ?
       limit 1`,
    )
    .bind(projectId, sessionId)
    .first<{ owned: number }>();
  return row?.owned === 1;
}

export async function upsertProjectAgentSession(
  db: D1Database,
  input: ProjectAgentSessionRow,
  observedAt: string,
) {
  await db.batch([
    db.prepare(
      `insert into briar_project_agent_session_context_membership (
         project_id, session_id, visible_at
       ) values (?, ?, ?)
       on conflict (project_id, session_id) do update set
         visible_at = excluded.visible_at
       where not exists (
         select 1 from briar_project_agent_sessions session
         where session.project_id = excluded.project_id
           and session.id = excluded.session_id
       ) and not exists (
         select 1 from briar_log_archives archive
         where archive.project_id = excluded.project_id
           and archive.scope_id = excluded.session_id
           and archive.archive_kind = 'project_agent_sessions'
           and archive.status in ('verified', 'complete')
       )`,
    ).bind(input.project_id, input.id, observedAt),
    db.prepare(
      `insert into briar_project_agent_sessions (
         project_id, id, agent_id, status, session_type, payload_json,
         started_at, completed_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (project_id, id) do update set
         agent_id = excluded.agent_id,
         status = excluded.status,
         session_type = excluded.session_type,
         payload_json = excluded.payload_json,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at
       where excluded.updated_at > briar_project_agent_sessions.updated_at`,
    )
    .bind(
      input.project_id,
      input.id,
      input.agent_id,
      input.status,
      input.session_type,
      input.payload_json,
      input.started_at,
      input.completed_at,
      input.updated_at,
    ),
    upsertProjectAgentSessionSummaryStatement(db, input, false),
  ]);
  return db
    .prepare(
      `select project_id, id, agent_id, status, session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ? and id = ?`,
    )
    .bind(input.project_id, input.id)
    .first<ProjectAgentSessionRow>();
}

export async function createProjectAgentTaskJob(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    agentId: string;
    skill: Pick<
      AgentSkillRow,
      "id" | "instructions" | "provider" | "model" | "effort"
    >;
    request: string;
    requestId: string;
    workerId: string;
    createdAt: string;
  },
) {
  const inserted = await db
    .prepare(
      `insert into briar_project_agent_task_jobs (
         id, project_id, agent_id, skill_id, request, request_id, status,
         preferred_worker_id, created_at, updated_at
       )
       select ?, ?, ?, skill.id, ?, ?, 'queued', ?, ?, ?
       from briar_agent_skills skill
       where skill.id = ? and skill.agent_id = ?
         and skill.instructions is ?
         and skill.provider is ?
         and skill.model is ?
         and skill.effort is ?`,
    )
    .bind(
      input.id,
      input.projectId,
      input.agentId,
      input.request,
      input.requestId,
      input.workerId,
      input.createdAt,
      input.createdAt,
      input.skill.id,
      input.agentId,
      input.skill.instructions,
      input.skill.provider,
      input.skill.model,
      input.skill.effort,
    )
    .run();
  if ((inserted.meta.changes ?? 0) < 1) return null;
  return getProjectAgentTaskJob(db, input.projectId, input.id);
}

export async function getProjectAgentTaskJob(
  db: D1Database,
  projectId: string,
  jobId: string,
) {
  return db
    .prepare(
      `select * from briar_project_agent_task_jobs
       where project_id = ? and id = ?`,
    )
    .bind(projectId, jobId)
    .first<ProjectAgentTaskJobRow>();
}

export async function getProjectAgentTaskJobByRequest(
  db: D1Database,
  projectId: string,
  requestId: string,
) {
  return db
    .prepare(
      `select * from briar_project_agent_task_jobs
       where project_id = ? and request_id = ?`,
    )
    .bind(projectId, requestId)
    .first<ProjectAgentTaskJobRow>();
}

export async function reapProjectAgentTaskJobs(
  db: D1Database,
  projectId: string,
  input: { observedAt: string; error: string },
) {
  const result = await db
    .prepare(
      `update briar_project_agent_task_jobs
       set status = 'failed',
           error = coalesce(error, ?),
           claim_token_hash = null, claimed_at = null, lease_expires_at = null,
           completed_at = ?, updated_at = ?
       where project_id = ? and status = 'running'
         and attempts >= 3 and lease_expires_at <= ?
       returning *`,
    )
    .bind(
      input.error,
      input.observedAt,
      input.observedAt,
      projectId,
      input.observedAt,
    )
    .all<ProjectAgentTaskJobRow>();
  return result.results ?? [];
}

export async function claimNextProjectAgentTask(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    agentProviders: ProjectAgentProvider[];
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  const providerPlaceholders = input.agentProviders.map(() => "?").join(", ");
  // Migration 0092 is a deployment prerequisite, so this hot path never
  // probes schema metadata or drops the approval guard.
  const skillExecutionEligibility = `and (
         job.skill_execution_proposal_id is null
         or exists (
           select 1
           from briar_agent_skill_execution_approval_audit approval
           where approval.proposal_id = job.skill_execution_proposal_id
             and approval.project_id = job.project_id
             and approval.result_session_id = job.id
             and approval.agent_id = job.agent_id
             and approval.skill_id = job.skill_id
             and approval.request = job.request
             and approval.proposal_id = job.request_id
             and approval.worker_id = job.preferred_worker_id
         )
       )`;
  const claimed = await db
    .prepare(
      `update briar_project_agent_task_jobs
       set status = 'running', claimed_worker_id = ?,
           claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + 1, error = null, updated_at = ?
       where id = (
         select job.id
         from briar_project_agent_task_jobs job
         join briar_project_agents agent on agent.id = job.agent_id
         join briar_agent_skills skill
           on skill.agent_id = agent.id
          and skill.id = job.skill_id
         where job.project_id = ?
           and job.preferred_worker_id = ?
           and skill.provider in (${providerPlaceholders})
           ${skillExecutionEligibility}
           and exists (
             select 1
             from briar_execution_workers selected_worker
             join briar_execution_worker_devices selected_device
               on selected_device.id = selected_worker.device_id
             where selected_worker.id = ?
               and (
                 (select count(*)
                  from briar_hunt_runs active
                  join briar_execution_workers holder
                    on holder.id = active.worker_id
                  where holder.device_id = selected_device.id
                    and active.claim_token_hash is not null
                    and active.lease_expires_at is not null
                    and active.lease_expires_at > ?
                    and active.status not in (
                      'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                    ))
                 +
                 (select count(*)
                  from briar_project_agent_task_jobs active_task
                  join briar_execution_workers holder
                    on holder.id = active_task.claimed_worker_id
                  where holder.device_id = selected_device.id
                    and active_task.status = 'running'
                    and active_task.lease_expires_at > ?)
               ) < selected_device.max_concurrent_sessions
           )
           and job.attempts < 3
           and (
             job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?)
           )
         order by job.created_at, job.id
         limit 1
       )
       returning *`,
    )
    .bind(
      input.workerId,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      projectId,
      input.workerId,
      ...input.agentProviders,
      input.workerId,
      input.claimedAt,
      input.claimedAt,
      input.claimedAt,
    )
    .first<ProjectAgentTaskJobRow>()
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        error.message.includes(
          "Agent Skill execution approval audit is missing or stale",
        )
      ) {
        return null;
      }
      throw error;
    });
  if (!claimed) return null;
  if (claimed.skill_execution_proposal_id) {
    const approval = await db
      .prepare(
        `select approval.*
         from briar_agent_skill_execution_approval_audit approval
         where approval.proposal_id = ? and approval.project_id = ?
           and approval.result_session_id = ?
           and approval.agent_id = ? and approval.skill_id = ?
           and approval.request = ? and approval.worker_id = ?`,
      )
      .bind(
        claimed.skill_execution_proposal_id,
        claimed.project_id,
        claimed.id,
        claimed.agent_id,
        claimed.skill_id,
        claimed.request,
        input.workerId,
      )
      .first<{
        agent_name: string;
        agent_responsibility: string;
        skill_id: string;
        skill_name: string;
        skill_instructions: string;
        skill_kind: AgentSkillKind;
        provider: ProjectAgentProvider;
        model: string | null;
        effort: AgentSkillEffort | null;
        approved_at: string;
      }>();
    if (!approval) {
      throw new Error(
        "Agent Skill execution approval snapshot disappeared after claim",
      );
    }
    const approvedSkill: AgentSkillRow = {
      id: approval.skill_id,
      agent_id: claimed.agent_id,
      name: approval.skill_name,
      instructions: approval.skill_instructions,
      provider: approval.provider,
      model: approval.model,
      effort: approval.effort,
      kind: approval.skill_kind,
      is_default: 0,
      position: 0,
      created_at: approval.approved_at,
      updated_at: approval.approved_at,
    };
    return {
      ...claimed,
      agent_name: approval.agent_name,
      agent_provider: approval.provider,
      agent_model: approval.model,
      agent_effort: approval.effort,
      agent_responsibility: approval.agent_responsibility,
      agent_skill: approval.skill_instructions,
      selected_skill_id: approval.skill_id,
      selected_skill_name: approval.skill_name,
      selected_skill_instructions: approval.skill_instructions,
      agent_skills: [approvedSkill],
    };
  }
  const selected = await db
    .prepare(
      `select job.*, agent.name as agent_name, skill.provider as agent_provider,
              skill.model as agent_model, skill.effort as agent_effort,
              agent.responsibility as agent_responsibility,
              skill.instructions as agent_skill,
              skill.id as selected_skill_id,
              skill.name as selected_skill_name,
              skill.instructions as selected_skill_instructions
       from briar_project_agent_task_jobs job
       join briar_project_agents agent on agent.id = job.agent_id
       join briar_agent_skills skill
         on skill.agent_id = agent.id
        and skill.id = job.skill_id
       where job.id = ? and job.project_id = ?`,
    )
    .bind(claimed.id, projectId)
    .first<Omit<ClaimedProjectAgentTaskRow, "agent_skills">>();
  if (!selected) return null;
  const agentSkills = await hydrateAgentSkills(db, [{ id: selected.agent_id }]);
  return { ...selected, agent_skills: agentSkills[0].skills };
}

export async function getClaimedProjectAgentTask(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: { workerId: string; claimTokenHash: string },
) {
  return db
    .prepare(
      `select * from briar_project_agent_task_jobs
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?`,
    )
    .bind(jobId, projectId, input.workerId, input.claimTokenHash)
    .first<ProjectAgentTaskJobRow>();
}

export async function renewProjectAgentTaskLease(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    leaseExpiresAt: string;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_project_agent_task_jobs
       set lease_expires_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
       returning *`,
    )
    .bind(
      input.leaseExpiresAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    )
    .first<ProjectAgentTaskJobRow>();
}

export async function completeProjectAgentTaskWithReceipt(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    updatedAt: string;
    summary?: string | null;
    conversationId?: string | null;
    error?: string;
  },
) {
  const approvalColumnsAvailable =
    await agentSkillExecutionApprovalTablesAvailable(db);
  const resultProjection = approvalColumnsAvailable
    ? `result_summary = ?, result_conversation_id = ?,`
    : "";
  const completionStatement = (receiptId: string | null) => db
    .prepare(
      `update briar_project_agent_task_jobs as task
       set status = case when ? is null then 'completed' else
         case when attempts >= 3 then 'failed' else 'queued' end end,
           error = ?,
           ${resultProjection}
           claim_token_hash = null, claimed_worker_id = null,
           claimed_at = null, lease_expires_at = null,
           completed_at = case when ? is null then ? else
             case when attempts >= 3 then ? else null end end,
           updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         ${receiptId
           ? `and exists (
                select 1
                from briar_project_agent_task_completion_receipts receipt
                where receipt.id = ?
                  and receipt.project_id = task.project_id
                  and receipt.task_id = task.id
                  and receipt.worker_id = task.claimed_worker_id
                  and receipt.claim_token_hash = task.claim_token_hash
              )`
           : ""}
       returning *`,
    )
    .bind(
      input.error ?? null,
      input.error ?? null,
      ...(approvalColumnsAvailable
        ? [input.summary ?? null, input.conversationId ?? null]
        : []),
      input.error ?? null,
      input.updatedAt,
      input.updatedAt,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      ...(receiptId ? [receiptId] : []),
    );
  if (!approvalColumnsAvailable) {
    const job = await completionStatement(null).first<ProjectAgentTaskJobRow>();
    return job ? { job, receipt: null, replayed: false } : null;
  }

  const summary = input.summary ?? null;
  const conversationId = input.conversationId ?? null;
  const error = input.error ?? null;
  const receiptId = crypto.randomUUID();
  const receiptStatement = db
    .prepare(
      `insert into briar_project_agent_task_completion_receipts (
         id, organization_id, project_id, task_id,
         skill_execution_proposal_id, worker_id, claim_token_hash,
         outcome_status, summary, conversation_id, error,
         completed_at, created_at
       )
       select ?, project.organization_id, task.project_id, task.id,
              task.skill_execution_proposal_id, task.claimed_worker_id,
              task.claim_token_hash,
              case when ? is null then 'completed'
                else case when task.attempts >= 3 then 'failed'
                  else 'queued' end end,
              ?, ?, ?, ?, ?
       from briar_project_agent_task_jobs task
       join briar_projects project on project.id = task.project_id
       where task.id = ? and task.project_id = ? and task.status = 'running'
         and task.claimed_worker_id = ? and task.claim_token_hash = ?
       on conflict (project_id, task_id, worker_id, claim_token_hash)
       do nothing
       returning *`,
    )
    .bind(
      receiptId,
      error,
      summary,
      conversationId,
      error,
      input.updatedAt,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    );
  const [receiptResult, completionResult] = await db.batch([
    receiptStatement,
    completionStatement(receiptId),
  ]);
  const receipt = receiptResult.results[0] as
    | ProjectAgentTaskCompletionReceiptRow
    | undefined;
  const job = completionResult.results[0] as ProjectAgentTaskJobRow | undefined;
  if (receipt && job) {
    return { job, receipt, replayed: false };
  }
  if (receipt || job) {
    throw new Error("Project Agent task completion was not atomic");
  }
  const existing = await db
    .prepare(
      `select * from briar_project_agent_task_completion_receipts
       where project_id = ? and task_id = ? and worker_id = ?
         and claim_token_hash = ?`,
    )
    .bind(projectId, jobId, input.workerId, input.claimTokenHash)
    .first<ProjectAgentTaskCompletionReceiptRow>();
  if (
    !existing || existing.summary !== summary ||
    existing.conversation_id !== conversationId || existing.error !== error
  ) {
    return null;
  }
  return {
    job: await getProjectAgentTaskJob(db, projectId, jobId),
    receipt: existing,
    replayed: true,
  };
}

export async function completeProjectAgentTask(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    updatedAt: string;
    summary?: string | null;
    conversationId?: string | null;
    error?: string;
  },
) {
  return (await completeProjectAgentTaskWithReceipt(
    db,
    projectId,
    jobId,
    input,
  ))?.job ?? null;
}

export async function createProjectAgent(
  db: D1Database,
  projectId: string,
  input: {
    name: string;
    avatar?: string | null;
    avatarPetJson?: string | null;
    avatarSpritesheetObjectKey?: string | null;
    provider: ProjectAgentProvider;
    model: string | null;
    effort: AgentSkillEffort | null;
    responsibility: string;
    calendarColor: string;
    skills?: AgentSkillInput[];
  },
) {
  const createdAt = new Date().toISOString();
  const agent: ProjectAgentRow = {
    id: crypto.randomUUID(),
    organization_id: "",
    project_id: projectId,
    name: input.name,
    avatar: input.avatar ?? null,
    avatar_pet_json: input.avatarPetJson ?? null,
    avatar_spritesheet_object_key: input.avatarSpritesheetObjectKey ?? null,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    responsibility: input.responsibility,
    skill_markdown: projectAgentSkill({
      name: input.name,
      responsibility: input.responsibility,
    }),
    calendar_color: input.calendarColor,
    created_at: createdAt,
    updated_at: createdAt,
  };
  // Organization identity follows the project and is required before the
  // Agent can appear in a channel roster.
  const organization = await db
    .prepare(`select organization_id from briar_projects where id = ?`)
    .bind(projectId)
    .first<{ organization_id: string }>();
  if (!organization) throw new Error("Project not found");
  agent.organization_id = organization.organization_id;
  const skillRows = normalizedAgentSkillRows(
    agent.id,
    input.skills ?? [],
    {
      name: input.name,
      instructions: input.responsibility,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      kind: "custom",
    },
    createdAt,
  );
  await db.batch([
        db.prepare(
          `insert into briar_project_agents (
             id, organization_id, project_id, name, avatar,
             avatar_pet_json, avatar_spritesheet_object_key, provider, model,
             effort, responsibility, skill_markdown, calendar_color, created_at,
             updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          agent.id,
          organization.organization_id,
          agent.project_id,
          agent.name,
          agent.avatar,
          agent.avatar_pet_json,
          agent.avatar_spritesheet_object_key,
          agent.provider,
          agent.model,
          agent.effort,
          agent.responsibility,
          agent.skill_markdown,
          agent.calendar_color,
          agent.created_at,
          agent.updated_at,
        ),
        ...skillRows.map((skill) => insertAgentSkillStatement(db, skill)),
      ]);
  return (await getProjectAgent(db, projectId, agent.id))!;
}

export async function deleteProjectAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
) {
  const deleted = await db
    .prepare(
      `delete from briar_project_agents
       where id = ? and project_id = ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs
           where project_id = ? and agent_id = ? and status = 'running'
         )
       returning id, organization_id, project_id, name, avatar, avatar_pet_json,
                 avatar_spritesheet_object_key, provider, model, effort,
                 responsibility, skill_markdown, calendar_color,
                 created_at, updated_at`,
    )
    .bind(agentId, projectId, projectId, agentId)
    .first<ProjectAgentRow>();
  if (deleted) return deleted;
  return (await getProjectAgent(db, projectId, agentId)) ? "running" : null;
}

type ProjectAgentScheduleInput = {
  agentId: string;
  name: string;
  recurrence: ProjectAgentScheduleRecurrence;
  timeOfDay: string;
  dayOfWeek: number | null;
  intervalValue?: number;
  intervalUnit?: ProjectAgentScheduleIntervalUnit;
  daysOfWeek?: number[];
  notificationLevel?: ProjectAgentScheduleNotificationLevel;
  timeZone: string;
};

function persistedProjectAgentScheduleRecurrence(
  input: ProjectAgentScheduleInput,
): "daily" | "weekdays" | "weekly" {
  if (input.recurrence === "interval") return "daily";
  if (input.recurrence === "custom") return "daily";
  return input.recurrence;
}

export async function listProjectAgentSchedules(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.project_id = ?
       order by schedule.created_at, schedule.id`,
    )
    .bind(projectId)
    .all<ProjectAgentScheduleRow>();
  return result.results;
}

export async function createProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  input: ProjectAgentScheduleInput,
) {
  const agent = await db
    .prepare(
      `select id
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(input.agentId, projectId)
    .first<{ id: string }>();
  if (!agent) return null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: input.recurrence,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      intervalValue: input.intervalValue,
      intervalUnit: input.intervalUnit,
      daysOfWeek: input.daysOfWeek,
      anchorAt: createdAt,
      timeZone: input.timeZone,
    },
    new Date(
      Date.parse(createdAt) -
        (input.recurrence === "interval" ? 0 : 60_000),
    ),
  );
  const persistedRecurrence = persistedProjectAgentScheduleRecurrence(input);
  await db
    .prepare(
      `insert into briar_project_agent_schedules (
         id, project_id, agent_id, name, recurrence, frequency, time_of_day,
         day_of_week, interval_value, interval_unit, days_of_week,
         notification_level, time_zone, enabled, next_run_at, created_at,
         updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      projectId,
      input.agentId,
      input.name,
      persistedRecurrence,
      input.recurrence,
      input.timeOfDay,
      input.dayOfWeek,
      input.intervalValue ?? 1,
      input.intervalUnit ??
        (input.recurrence === "interval" ? "hour" : "day"),
      serializeProjectAgentScheduleDays(input.daysOfWeek),
      input.notificationLevel ?? "important_updates",
      input.timeZone,
      nextRunAt,
      createdAt,
      createdAt,
    )
    .run();

  return await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.id = ? and schedule.project_id = ?`,
    )
    .bind(id, projectId)
    .first<ProjectAgentScheduleRow>();
}

export async function updateProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  scheduleId: string,
  input: ProjectAgentScheduleInput,
) {
  const observedAt = new Date().toISOString();
  const existing = await db
    .prepare(
      `select created_at
       from briar_project_agent_schedules
       where id = ? and project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<{ created_at: string }>();
  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: input.recurrence,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      intervalValue: input.intervalValue,
      intervalUnit: input.intervalUnit,
      daysOfWeek: input.daysOfWeek,
      anchorAt: existing?.created_at ?? observedAt,
      timeZone: input.timeZone,
    },
    new Date(
      Date.parse(observedAt) -
        (input.recurrence === "interval" ? 0 : 60_000),
    ),
  );
  const persistedRecurrence = persistedProjectAgentScheduleRecurrence(input);
  const updated = await db
    .prepare(
      `update briar_project_agent_schedules
       set agent_id = ?, name = ?, recurrence = ?, frequency = ?,
           time_of_day = ?, day_of_week = ?, interval_value = ?,
           interval_unit = ?, days_of_week = ?, notification_level = ?,
           time_zone = ?, next_run_at = ?, updated_at = ?
       where id = ? and project_id = ?
         and exists (
           select 1 from briar_project_agents agent
           where agent.id = ? and agent.project_id = ?
         )
       returning id`,
    )
    .bind(
      input.agentId,
      input.name,
      persistedRecurrence,
      input.recurrence,
      input.timeOfDay,
      input.dayOfWeek,
      input.intervalValue ?? 1,
      input.intervalUnit ??
        (input.recurrence === "interval" ? "hour" : "day"),
      serializeProjectAgentScheduleDays(input.daysOfWeek),
      input.notificationLevel ?? "important_updates",
      input.timeZone,
      nextRunAt,
      observedAt,
      scheduleId,
      projectId,
      input.agentId,
      projectId,
    )
    .first<{ id: string }>();
  if (!updated) return null;
  return db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.id = ? and schedule.project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<ProjectAgentScheduleRow>();
}

export async function deleteProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  scheduleId: string,
): Promise<"deleted" | "running" | "not_found"> {
  const result = await db
    .prepare(
      `delete from briar_project_agent_schedules
       where id = ? and project_id = ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs run
           where run.schedule_id = briar_project_agent_schedules.id
             and run.project_id = briar_project_agent_schedules.project_id
             and run.status = 'running'
         )`,
    )
    .bind(scheduleId, projectId)
    .run();
  if (result.meta.changes === 1) return "deleted";
  const schedule = await db
    .prepare(
      `select id from briar_project_agent_schedules
       where id = ? and project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<{ id: string }>();
  return schedule ? "running" : "not_found";
}

const scheduleRunSelect = `
  select run.id, run.project_id, run.schedule_id,
         schedule.name as schedule_name,
         run.agent_id, agent.name as agent_name,
         agent.provider as agent_provider,
         agent.model as agent_model,
         agent.effort as agent_effort,
         agent.responsibility as agent_responsibility,
         agent.skill_markdown as agent_skill_markdown,
         settings.workflow_json,
         run.status, run.scheduled_for, run.lease_expires_at,
         run.started_at, run.completed_at, run.result_summary,
         run.structured_result_json, run.error,
         run.created_at, run.updated_at
  from briar_project_agent_schedule_runs run
  join briar_project_agent_schedules schedule on schedule.id = run.schedule_id
  join briar_project_agents agent on agent.id = run.agent_id
  join briar_project_settings settings on settings.project_id = run.project_id`;

type UnhydratedProjectAgentScheduleRunRow = Omit<
  ProjectAgentScheduleRunRow,
  "agent_skills"
>;

async function hydrateScheduleRunAgentSkills(
  db: D1Database,
  rows: readonly UnhydratedProjectAgentScheduleRunRow[],
): Promise<ProjectAgentScheduleRunRow[]> {
  const skills = await listAgentSkills(
    db,
    [...new Set(rows.map((row) => row.agent_id))],
  );
  const byAgent = new Map<string, AgentSkillRow[]>();
  for (const skill of skills) {
    const current = byAgent.get(skill.agent_id) ?? [];
    current.push(skill);
    byAgent.set(skill.agent_id, current);
  }
  return rows.map((row) => ({
    ...row,
    agent_skills: byAgent.get(row.agent_id) ?? [],
  }));
}

export async function listProjectAgentScheduleRuns(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `${scheduleRunSelect}
       where run.project_id = ?
       order by run.started_at desc, run.id`,
    )
    .bind(projectId)
    .all<UnhydratedProjectAgentScheduleRunRow>();
  return hydrateScheduleRunAgentSkills(db, result.results);
}

export const PROJECT_AGENT_SCHEDULE_LEASE_MS = 2 * 60 * 60_000;

const scheduleLeaseExpiresAt = (observedAt: string) =>
  new Date(
    Date.parse(observedAt) + PROJECT_AGENT_SCHEDULE_LEASE_MS,
  ).toISOString();

async function initializeProjectAgentScheduleNextRuns(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const schedules = await db
    .prepare(
      `select id, coalesce(frequency, recurrence) as frequency,
              time_of_day, day_of_week, interval_value, interval_unit,
              days_of_week, time_zone, created_at
       from briar_project_agent_schedules
       where project_id = ? and enabled = 1 and next_run_at is null`,
    )
    .bind(projectId)
    .all<{
      id: string;
      frequency: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      interval_value: number;
      interval_unit: ProjectAgentScheduleIntervalUnit;
      days_of_week: string | null;
      time_zone: string;
      created_at: string;
    }>();
  for (const schedule of schedules.results ?? []) {
    const startAt = Math.min(
      Date.parse(observedAt),
      Date.parse(schedule.created_at),
    );
    const nextRunAt = nextProjectAgentScheduleRunAt(
      {
        recurrence: schedule.frequency,
        timeOfDay: schedule.time_of_day,
        dayOfWeek: schedule.day_of_week,
        intervalValue: schedule.interval_value,
        intervalUnit: schedule.interval_unit,
        daysOfWeek: parseProjectAgentScheduleDays(schedule.days_of_week),
        anchorAt: schedule.created_at,
        timeZone: schedule.time_zone,
      },
      new Date(
        startAt - (schedule.frequency === "interval" ? 0 : 60_000),
      ),
    );
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = ?, updated_at = ?
         where id = ? and project_id = ? and next_run_at is null`,
      )
      .bind(nextRunAt, observedAt, schedule.id, projectId)
      .run();
  }
}

async function reclaimExpiredProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  const expired = await db
    .prepare(
      `select id
       from briar_project_agent_schedule_runs
       where project_id = ? and status = 'running'
         and lease_expires_at is not null and lease_expires_at <= ?
       order by scheduled_for, id
       limit 1`,
    )
    .bind(projectId, input.observedAt)
    .first<{ id: string }>();
  if (!expired) return null;
  const run = await db
    .prepare(
      `update briar_project_agent_schedule_runs
       set claim_token_hash = ?, lease_expires_at = ?,
           started_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and lease_expires_at is not null and lease_expires_at <= ?
       returning id`,
    )
    .bind(
      input.claimTokenHash,
      scheduleLeaseExpiresAt(input.observedAt),
      input.observedAt,
      input.observedAt,
      expired.id,
      projectId,
      input.observedAt,
    )
    .first<{ id: string }>();
  if (!run) return null;
  const selected = await db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(run.id, projectId)
    .first<UnhydratedProjectAgentScheduleRunRow>();
  if (!selected) return null;
  return (await hydrateScheduleRunAgentSkills(db, [selected]))[0];
}

export async function claimDueProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  const reclaimed = await reclaimExpiredProjectAgentScheduleRun(
    db,
    projectId,
    input,
  );
  if (reclaimed) return reclaimed;

  await initializeProjectAgentScheduleNextRuns(db, projectId, input.observedAt);
  const schedule = await db
    .prepare(
      `select schedule.id, schedule.agent_id, schedule.next_run_at,
              coalesce(schedule.frequency, schedule.recurrence) as frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.time_zone, schedule.created_at
       from briar_project_agent_schedules schedule
       where schedule.project_id = ? and schedule.enabled = 1
         and schedule.next_run_at is not null
         and schedule.next_run_at <= ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs active
           where active.schedule_id = schedule.id and active.status = 'running'
             and active.lease_expires_at > ?
         )
       order by schedule.next_run_at, schedule.id
       limit 1`,
    )
    .bind(projectId, input.observedAt, input.observedAt)
    .first<{
      id: string;
      agent_id: string;
      next_run_at: string;
      frequency: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      interval_value: number;
      interval_unit: ProjectAgentScheduleIntervalUnit;
      days_of_week: string | null;
      time_zone: string;
      created_at: string;
    }>();
  if (!schedule) return null;

  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: schedule.frequency,
      timeOfDay: schedule.time_of_day,
      dayOfWeek: schedule.day_of_week,
      intervalValue: schedule.interval_value,
      intervalUnit: schedule.interval_unit,
      daysOfWeek: parseProjectAgentScheduleDays(schedule.days_of_week),
      anchorAt: schedule.created_at,
      timeZone: schedule.time_zone,
    },
    new Date(
      Math.max(Date.parse(schedule.next_run_at), Date.parse(input.observedAt)),
    ),
  );
  const runId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `insert or ignore into briar_project_agent_schedule_runs (
           id, project_id, schedule_id, agent_id, status, scheduled_for,
           claim_token_hash, lease_expires_at, started_at, created_at, updated_at
         )
         select ?, ?, schedule.id, schedule.agent_id, 'running',
                schedule.next_run_at, ?, ?, ?, ?, ?
         from briar_project_agent_schedules schedule
         where schedule.id = ? and schedule.project_id = ?
           and schedule.enabled = 1 and schedule.next_run_at = ?
           and not exists (
             select 1 from briar_project_agent_schedule_runs active
             where active.schedule_id = schedule.id and active.status = 'running'
               and active.lease_expires_at > ?
           )`,
      )
      .bind(
        runId,
        projectId,
        input.claimTokenHash,
        scheduleLeaseExpiresAt(input.observedAt),
        input.observedAt,
        input.observedAt,
        input.observedAt,
        schedule.id,
        projectId,
        schedule.next_run_at,
        input.observedAt,
      ),
    db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = ?, updated_at = ?
         where id = ? and project_id = ? and next_run_at = ?
           and exists (
             select 1 from briar_project_agent_schedule_runs run
             where run.id = ? and run.claim_token_hash = ?
           )`,
      )
      .bind(
        nextRunAt,
        input.observedAt,
        schedule.id,
        projectId,
        schedule.next_run_at,
        runId,
        input.claimTokenHash,
      ),
  ]);
  const selected = await db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<UnhydratedProjectAgentScheduleRunRow>();
  if (!selected) return null;
  return (await hydrateScheduleRunAgentSkills(db, [selected]))[0];
}

export async function completeProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    claimTokenHash: string;
    status: Exclude<ProjectAgentScheduleRunStatus, "running">;
    resultSummary: string | null;
    structuredResult: StructuredAgentResult;
    error: string | null;
    observedAt: string;
  },
) {
  const row = await db
    .prepare(
      `update briar_project_agent_schedule_runs
       set status = ?, claim_token_hash = null, lease_expires_at = null,
           completed_at = ?, result_summary = ?, structured_result_json = ?,
           error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id`,
    )
    .bind(
      input.status,
      input.observedAt,
      input.resultSummary,
      stableJson(input.structuredResult),
      input.error,
      input.observedAt,
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string }>();
  if (!row) return null;
  const selected = await db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<UnhydratedProjectAgentScheduleRunRow>();
  if (!selected) return null;
  return (await hydrateScheduleRunAgentSkills(db, [selected]))[0];
}

export async function renewProjectAgentScheduleRunLease(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_project_agent_schedule_runs
       set lease_expires_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id, lease_expires_at`,
    )
    .bind(
      scheduleLeaseExpiresAt(input.observedAt),
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string; lease_expires_at: string }>();
}

export async function updateProjectAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
  input: {
    name: string;
    avatar?: string | null;
    codexPet?: {
      json: string;
      objectKey: string;
    } | null;
    provider: ProjectAgentProvider;
    model: string | null;
    effort: AgentSkillEffort | null;
    responsibility: string;
    calendarColor: string;
    skills?: AgentSkillInput[];
  },
) {
  const updatedAt = new Date().toISOString();
  const existing = await getProjectAgent(db, projectId, agentId);
  if (!existing) return null;
  const skill = projectAgentSkill({
    name: input.name,
    responsibility: input.responsibility,
  });
  const supplementalStatements: D1PreparedStatement[] = [];
  if (input.skills !== undefined) {
    const skillRows = normalizedAgentSkillRows(
      agentId,
      input.skills,
      {
        name: input.name,
        instructions: input.responsibility,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        kind: "custom",
      },
      updatedAt,
    );
    await assertAgentSkillReplacementAllowed(
      db,
      agentId,
      skillRows,
    );
    supplementalStatements.push(
      ...replaceAgentSkillStatements(db, agentId, skillRows),
    );
  } else {
    const legacySkill = soleAgentSkillRowFromLegacy(existing.skills, {
        instructions: input.responsibility,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        updatedAt,
      });
    if (legacySkill) {
      await assertAgentSkillReplacementAllowed(db, agentId, [legacySkill]);
      supplementalStatements.push(
        ...replaceAgentSkillStatements(db, agentId, [legacySkill]),
      );
    }
  }
  const results = await db.batch([
      db.prepare(
        `update briar_project_agents
         set name = ?,
             avatar = case when ? = 1 then ? else avatar end,
             avatar_pet_json = case when ? = 1 then ? else avatar_pet_json end,
             avatar_spritesheet_object_key =
               case when ? = 1 then ? else avatar_spritesheet_object_key end,
             provider = ?, model = ?, effort = ?, responsibility = ?,
             skill_markdown = ?, calendar_color = ?, updated_at = ?
         where id = ? and project_id = ?`,
      ).bind(
        input.name,
        input.avatar === undefined ? 0 : 1,
        input.avatar ?? null,
        input.codexPet === undefined ? 0 : 1,
        input.codexPet ? input.codexPet.json : null,
        input.codexPet === undefined ? 0 : 1,
        input.codexPet ? input.codexPet.objectKey : null,
        input.provider,
        input.model,
        input.effort,
        input.responsibility,
        skill,
        input.calendarColor,
        updatedAt,
        agentId,
        projectId,
      ),
      ...supplementalStatements,
    ]);
  if ((results[0]?.meta.changes ?? 0) === 0) return null;
  return getProjectAgent(db, projectId, agentId);
}

export async function getProjectSettings(db: D1Database, projectId: string) {
  return await db
    .prepare(
      `select project_id, velen_org, data_source, linear_enabled,
              linear_source, linear_team_key, github_repository, workflow_json,
              mandatory_checkpoints_json, checkpoint_policy_revision,
              created_at, updated_at
       from briar_project_settings
       where project_id = ?`,
    )
    .bind(projectId)
    .first<ProjectSettingsRow>();
}

export async function updateProjectMandatoryCheckpoints(
  db: D1Database,
  projectId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
  expectedRevision: number,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_project_settings
       set mandatory_checkpoints_json = ?,
           checkpoint_policy_revision = checkpoint_policy_revision + 1,
           updated_at = ?
       where project_id = ? and checkpoint_policy_revision = ?`,
    )
    .bind(stableJson(checkpoints), updatedAt, projectId, expectedRevision)
    .run();
  // Dashboard sync triggers may add their own row changes to D1 metadata.
  // The guarded settings row changed iff the total is non-zero.
  return (result.meta.changes ?? 0) > 0;
}

export async function updateUserWorkflowCheckpointDefaults(
  db: D1Database,
  projectId: string,
  userId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
  expectedRevision: number,
) {
  const updatedAt = new Date().toISOString();
  const result = expectedRevision === 0
    ? await db
        .prepare(
          `insert into briar_user_workflow_checkpoint_defaults (
             project_id, user_id, checkpoints_json, revision, created_at, updated_at
           ) values (?, ?, ?, 1, ?, ?)
           on conflict(project_id, user_id) do nothing`,
        )
        .bind(projectId, userId, stableJson(checkpoints), updatedAt, updatedAt)
        .run()
    : await db
        .prepare(
          `update briar_user_workflow_checkpoint_defaults
           set checkpoints_json = ?, revision = revision + 1, updated_at = ?
           where project_id = ? and user_id = ? and revision = ?`,
        )
        .bind(
          stableJson(checkpoints),
          updatedAt,
          projectId,
          userId,
          expectedRevision,
        )
        .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updateProjectSettings(
  db: D1Database,
  projectId: string,
  input: ProjectSettingsInput,
) {
  const updatedAt = new Date().toISOString();
  const normalizedWorkflow = normalizeAutoHuntWorkflow(input.workflow);
  const workflow = normalizeAutoHuntWorkflow({
    ...normalizedWorkflow,
    execution: {
      checkpoints: canonicalizeCheckpointSet(
        normalizedWorkflow,
        normalizedWorkflow.execution.checkpoints,
        "project",
      ),
    },
  });
  await db
    .prepare(
      `insert into briar_project_settings (
         project_id, velen_org, data_source, linear_enabled, linear_source,
         linear_team_key, github_repository, workflow_json,
         mandatory_checkpoints_json, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(project_id) do update set
         velen_org = excluded.velen_org,
         data_source = excluded.data_source,
         linear_enabled = excluded.linear_enabled,
         linear_source = excluded.linear_source,
         linear_team_key = excluded.linear_team_key,
         github_repository = excluded.github_repository,
         workflow_json = excluded.workflow_json,
         mandatory_checkpoints_json = case
           when exists (
             select 1 from json_each(
               briar_project_settings.workflow_json,
               '$.stages'
             ) stage
             where json_extract(stage.value, '$.id') = 'repository_workflow_pending'
           ) then excluded.mandatory_checkpoints_json
           else briar_project_settings.mandatory_checkpoints_json
         end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      projectId,
      input.velenOrg,
      input.dataSource,
      input.linear.enabled ? 1 : 0,
      input.linear.enabled ? input.linear.source : null,
      input.linear.enabled ? input.linear.teamKey : null,
      input.githubRepository,
      stableJson(workflow),
      stableJson(workflow.execution.checkpoints),
      updatedAt,
      updatedAt,
    )
    .run();
  return await getProjectSettings(db, projectId);
}

export async function listDashboardRuns(db: D1Database, projectId: string) {
  const runs = await db
    .prepare(
      `select run.*,
              coalesce((
                select json_group_array(json_object(
                  'userId', subscriber.user_id,
                  'subscribedAt', subscriber.created_at
                ))
                from (
                  select subscription.user_id, subscription.created_at
                  from briar_issue_subscriptions subscription
                  where subscription.run_id = run.id
                  order by subscription.created_at, subscription.user_id
                ) subscriber
              ), '[]') as subscribers_json,
              run.event_count + coalesce((
                select sum(archive.row_count)
                from briar_log_archives archive
                where archive.run_id = run.id
                  and archive.archive_kind = 'run_events'
                  and archive.status = 'complete'
              ), 0) as event_count
       from briar_hunt_runs run
       where run.project_id = ?
       order by
         case when run.status in ('completed', 'cancelled') then 1 else 0 end,
         run.updated_at desc
       limit 200`,
    )
    .bind(projectId)
    .all<HuntRunRow>();

  return runs.results;
}

export async function listDashboardRunsByIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const runs = await db
    .prepare(
      `select run.*,
              coalesce((
                select json_group_array(json_object(
                  'userId', subscriber.user_id,
                  'subscribedAt', subscriber.created_at
                ))
                from (
                  select subscription.user_id, subscription.created_at
                  from briar_issue_subscriptions subscription
                  where subscription.run_id = run.id
                  order by subscription.created_at, subscription.user_id
                ) subscriber
              ), '[]') as subscribers_json,
              run.event_count + coalesce((
                select sum(archive.row_count)
                from briar_log_archives archive
                where archive.run_id = run.id
                  and archive.archive_kind = 'run_events'
                  and archive.status = 'complete'
              ), 0) as event_count
       from briar_hunt_runs run
       where run.project_id = ?
         and run.id in (select value from json_each(?))
       order by run.updated_at desc`,
    )
    .bind(projectId, JSON.stringify([...new Set(runIds)]))
    .all<HuntRunRow>();

  return runs.results;
}

export async function listOrganizationStatusTrayRuns(
  db: D1Database,
  organizationId: string,
) {
  const runs = await db
    .prepare(
      `select project.id as project_id, project.name as project_name,
              run.id, run.title, run.status, run.workflow_stage,
              run.workflow_snapshot_json, run.started_at, run.updated_at,
              run.last_event_at
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where project.organization_id = ?
         and run.status = 'running'
         and run.paused_at is null
       order by run.updated_at desc, run.id
       limit 200`,
    )
    .bind(organizationId)
    .all<OrganizationStatusTrayRunRow>();

  return runs.results;
}

export async function listOrganizationUsageRuns(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const runs = await db
    .prepare(
      `select run.id, run.project_id, run.status, run.paused_at,
              run.execution_metrics_json,
              run.claimed_by, run.claimed_at, run.claim_attempts, run.worker_id,
              run.preferred_agent_provider, run.preferred_agent_model,
              run.requested_agent_provider, run.requested_agent_model,
              coalesce(
                run.requested_agent_provider,
                run.preferred_agent_provider
              ) as execution_provider,
              case
                when run.requested_agent_provider is not null
                  then run.requested_agent_model
                when run.preferred_agent_provider is not null
                  then run.preferred_agent_model
                else null
              end as execution_model,
              run.started_at, run.updated_at, run.completed_at
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where project.organization_id = ?
         and (
           unixepoch(coalesce(
             run.completed_at,
             run.updated_at,
             run.started_at
           )) >= unixepoch(?)
           or exists (
             select 1 from briar_run_execution_attempts attempt
             where attempt.run_id = run.id
               and attempt.organization_id = project.organization_id
               and (
                 unixepoch(attempt.claimed_at) >= unixepoch(?)
                 or exists (
                   select 1 from briar_run_usage_records usage
                   where usage.execution_id = attempt.id
                     and unixepoch(usage.observed_at) >= unixepoch(?)
                 )
                 or exists (
                   select 1 from briar_run_cost_records cost
                   where cost.execution_id = attempt.id
                     and unixepoch(cost.observed_at) >= unixepoch(?)
                 )
               )
           )
         )
         and (
           run.execution_metrics_json is not null
           or run.claimed_at is not null
           or run.claimed_by is not null
           or run.worker_id is not null
           or run.claim_attempts > 0
           or run.paused_at is not null
           or run.status in (
             'running', 'blocked', 'failed', 'completed', 'cancelled'
           )
           or exists (
             select 1 from briar_run_execution_attempts attempt
             where attempt.run_id = run.id
               and attempt.organization_id = project.organization_id
           )
         )
       order by unixepoch(coalesce(
         run.completed_at,
         run.updated_at,
         run.started_at
       )), run.id`,
    )
    .bind(organizationId, since, since, since, since)
    .all<OrganizationUsageRunRow>();

  return runs.results;
}

export async function listProjectUsageRuns(
  db: D1Database,
  projectId: string,
  since: string,
) {
  const runs = await db
    .prepare(
      `select run.id, run.project_id, run.status, run.paused_at,
              run.execution_metrics_json,
              run.claimed_by, run.claimed_at, run.claim_attempts, run.worker_id,
              run.preferred_agent_provider, run.preferred_agent_model,
              run.requested_agent_provider, run.requested_agent_model,
              coalesce(
                run.requested_agent_provider,
                run.preferred_agent_provider
              ) as execution_provider,
              case
                when run.requested_agent_provider is not null
                  then run.requested_agent_model
                when run.preferred_agent_provider is not null
                  then run.preferred_agent_model
                else null
              end as execution_model,
              run.started_at, run.updated_at, run.completed_at,
              run.source_created_at, run.created_by_user_id,
              creator.name as created_by_name,
              run.agent_id,
              coalesce(agent.name, worker.label, run.claimed_by) as agent_name,
              exists (
                select 1
                from briar_run_execution_attempts ledger_attempt
                join briar_run_usage_records ledger_usage
                  on ledger_usage.execution_id = ledger_attempt.id
                where ledger_attempt.run_id = run.id
                  and ledger_attempt.project_id = run.project_id
              ) as has_usage_ledger
       from briar_hunt_runs run
       left join "user" creator on creator.id = run.created_by_user_id
       left join briar_project_agents agent on agent.id = run.agent_id
       left join briar_execution_workers worker on worker.id = run.worker_id
       where run.project_id = ?
         and (
           coalesce(run.source_created_at, run.started_at) >= ?
           or
           coalesce(run.completed_at, run.updated_at, run.started_at) >= ?
           or exists (
             select 1
             from briar_run_execution_attempts attempt
             join briar_run_usage_records usage
               on usage.execution_id = attempt.id
             where attempt.run_id = run.id
               and attempt.project_id = run.project_id
               and usage.observed_at >= ?
           )
         )
       order by coalesce(run.completed_at, run.updated_at, run.started_at),
                run.id`,
    )
    .bind(projectId, since, since, since)
    .all<OrganizationUsageRunRow>();

  return runs.results;
}

export async function getRunExecutionAttempt(
  db: D1Database,
  executionId: string,
) {
  return db
    .prepare(`select * from briar_run_execution_attempts where id = ?`)
    .bind(executionId)
    .first<RunExecutionAttemptRow>();
}

export async function recordRunUsageRecords(
  db: D1Database,
  input: {
    executionId: string;
    records: AgentExecutionUsageRecord[];
    recordedAt: string;
  },
) {
  if (input.records.length === 0) return 0;
  const result = await db
    .prepare(
      `insert into briar_run_usage_records (
         execution_id, usage_key, session_id, turn_id, scope_id,
         agent_provider, model_provider, model, canonical_model,
         model_source, source, uncached_input_tokens, cache_read_tokens,
         cache_write_tokens, output_tokens, reasoning_output_tokens,
         total_tokens, observed_at, recorded_at
       )
       select ?, json_extract(record.value, '$.usageKey'),
              json_extract(record.value, '$.sessionId'),
              json_extract(record.value, '$.turnId'),
              json_extract(record.value, '$.scopeId'),
              json_extract(record.value, '$.agentProvider'),
              json_extract(record.value, '$.modelProvider'),
              json_extract(record.value, '$.model'),
              json_extract(record.value, '$.canonicalModel'),
              json_extract(record.value, '$.modelSource'),
              json_extract(record.value, '$.source'),
              json_extract(record.value, '$.uncachedInputTokens'),
              json_extract(record.value, '$.cacheReadTokens'),
              json_extract(record.value, '$.cacheWriteTokens'),
              json_extract(record.value, '$.outputTokens'),
              json_extract(record.value, '$.reasoningOutputTokens'),
              json_extract(record.value, '$.totalTokens'),
              json_extract(record.value, '$.observedAt'), ?
       from json_each(?) record
       where true
       on conflict (execution_id, usage_key) do nothing`,
    )
    .bind(
      input.executionId,
      input.recordedAt,
      JSON.stringify(input.records),
    )
    .run();
  return result.meta.changes ?? 0;
}

export async function recordRunCostRecords(
  db: D1Database,
  input: {
    executionId: string;
    records: AgentExecutionCostRecord[];
    recordedAt: string;
  },
) {
  if (input.records.length === 0) return 0;
  const result = await db
    .prepare(
      `insert into briar_run_cost_records (
         execution_id, cost_key, usage_key, session_id, turn_id, scope_id,
         agent_provider, model_provider, model, canonical_model,
         model_source, source, amount_usd_ticks, observed_at, recorded_at
       )
       select ?, json_extract(record.value, '$.costKey'),
              json_extract(record.value, '$.usageKey'),
              json_extract(record.value, '$.sessionId'),
              json_extract(record.value, '$.turnId'),
              json_extract(record.value, '$.scopeId'),
              json_extract(record.value, '$.agentProvider'),
              json_extract(record.value, '$.modelProvider'),
              json_extract(record.value, '$.model'),
              json_extract(record.value, '$.canonicalModel'),
              json_extract(record.value, '$.modelSource'),
              json_extract(record.value, '$.source'),
              json_extract(record.value, '$.amountUsdTicks'),
              json_extract(record.value, '$.observedAt'), ?
       from json_each(?) record
       where true
       on conflict (execution_id, cost_key) do nothing`,
    )
    .bind(
      input.executionId,
      input.recordedAt,
      JSON.stringify(input.records),
    )
    .run();
  return result.meta.changes ?? 0;
}

export async function listOrganizationUsageExecutionAttempts(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const result = await db
    .prepare(
      `select * from briar_run_execution_attempts
       where organization_id = ? and (
         unixepoch(claimed_at) >= unixepoch(?)
         or exists (
           select 1 from briar_run_usage_records usage
           where usage.execution_id = briar_run_execution_attempts.id
             and unixepoch(usage.observed_at) >= unixepoch(?)
         )
         or exists (
           select 1 from briar_run_cost_records cost
           where cost.execution_id = briar_run_execution_attempts.id
             and unixepoch(cost.observed_at) >= unixepoch(?)
         )
       )
       order by unixepoch(claimed_at), run_id, claim_attempt, id`,
    )
    .bind(organizationId, since, since, since)
    .all<RunExecutionAttemptRow>();
  return result.results;
}

export async function listOrganizationUsageRecords(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const result = await db
    .prepare(
      `select usage.execution_id, attempt.run_id, attempt.project_id,
              attempt.run_attempt, attempt.claim_attempt, attempt.worker_id,
              attempt.claimed_at, usage.usage_key, usage.session_id,
              usage.turn_id, usage.scope_id, usage.agent_provider,
              usage.model_provider, usage.model, usage.canonical_model,
              usage.model_source, usage.source, usage.uncached_input_tokens,
              usage.cache_read_tokens, usage.cache_write_tokens,
              usage.output_tokens, usage.reasoning_output_tokens,
              usage.total_tokens, usage.observed_at, usage.recorded_at
       from briar_run_usage_records usage
       join briar_run_execution_attempts attempt
         on attempt.id = usage.execution_id
       where attempt.organization_id = ?
         and unixepoch(usage.observed_at) >= unixepoch(?)
       order by unixepoch(usage.observed_at), attempt.run_id,
                attempt.claim_attempt, usage.usage_key`,
    )
    .bind(organizationId, since)
    .all<OrganizationUsageRecordRow>();
  return result.results;
}

export async function listRunUsageRecords(
  db: D1Database,
  projectId: string,
  runId: string,
  runAttempt: number,
  executionId: string | null,
) {
  const result = await db
    .prepare(
      `select usage.execution_id, attempt.run_id, attempt.project_id,
              attempt.run_attempt, attempt.claim_attempt, attempt.worker_id,
              attempt.claimed_at, usage.usage_key, usage.session_id,
              usage.turn_id, usage.scope_id, usage.agent_provider,
              usage.model_provider, usage.model, usage.canonical_model,
              usage.model_source, usage.source, usage.uncached_input_tokens,
              usage.cache_read_tokens, usage.cache_write_tokens,
              usage.output_tokens, usage.reasoning_output_tokens,
              usage.total_tokens, usage.observed_at, usage.recorded_at
       from briar_run_usage_records usage
       join briar_run_execution_attempts attempt
         on attempt.id = usage.execution_id
       where attempt.project_id = ? and attempt.run_id = ?
         and attempt.run_attempt = ?
         and (? is null or attempt.id = ?)
       order by unixepoch(usage.observed_at), attempt.claim_attempt,
                usage.usage_key`,
    )
    .bind(projectId, runId, runAttempt, executionId, executionId)
    .all<OrganizationUsageRecordRow>();
  return result.results;
}

export async function listProjectUsageTotals(
  db: D1Database,
  projectId: string,
  since: string,
) {
  const result = await db
    .prepare(
      `select attempt.run_id,
              sum(coalesce(
                usage.total_tokens,
                coalesce(usage.uncached_input_tokens, 0) +
                coalesce(usage.cache_read_tokens, 0) +
                coalesce(usage.cache_write_tokens, 0) +
                coalesce(usage.output_tokens, 0)
              )) as total_tokens,
              count(*) as usage_records,
              substr(usage.observed_at, 1, 10) || 'T00:00:00.000Z'
                as observed_at
       from briar_run_execution_attempts attempt
       join briar_run_usage_records usage on usage.execution_id = attempt.id
       where attempt.project_id = ? and usage.observed_at >= ?
       group by attempt.run_id, substr(usage.observed_at, 1, 10)
       order by observed_at, attempt.run_id`,
    )
    .bind(projectId, since)
    .all<ProjectUsageTotalRow>();
  return result.results;
}

export async function listOrganizationUsageCostRecords(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const result = await db
    .prepare(
      `select cost.execution_id, attempt.run_id, attempt.project_id,
              attempt.run_attempt, attempt.claim_attempt, attempt.worker_id,
              attempt.claimed_at, cost.cost_key, cost.usage_key,
              cost.session_id, cost.turn_id, cost.scope_id,
              cost.agent_provider, cost.model_provider, cost.model,
              cost.canonical_model, cost.model_source, cost.source,
              cost.amount_usd_ticks, cost.observed_at, cost.recorded_at
       from briar_run_cost_records cost
       join briar_run_execution_attempts attempt
         on attempt.id = cost.execution_id
       where attempt.organization_id = ?
         and unixepoch(cost.observed_at) >= unixepoch(?)
       order by unixepoch(cost.observed_at), attempt.run_id,
                attempt.claim_attempt, cost.cost_key`,
    )
    .bind(organizationId, since)
    .all<OrganizationCostRecordRow>();
  return result.results;
}

export async function listIssueResultReviews(
  db: D1Database,
  projectId: string,
) {
  const reviews = await db
    .prepare(
      `select review.run_id, user.id as user_id, user.name, user.username,
              user.image, review.completed_at
       from briar_issue_result_reviews review
       join briar_hunt_runs run on run.id = review.run_id
       join "user" user on user.id = review.reviewer_user_id
       where run.project_id = ?
       order by review.completed_at asc, lower(user.name), user.id`,
    )
    .bind(projectId)
    .all<IssueResultReviewRow>();
  return reviews.results;
}

export async function listIssueResultReviewsByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const reviews = await db
    .prepare(
      `select review.run_id, user.id as user_id, user.name, user.username,
              user.image, review.completed_at
       from briar_issue_result_reviews review
       join briar_hunt_runs run on run.id = review.run_id
       join "user" user on user.id = review.reviewer_user_id
       where run.project_id = ?
         and review.run_id in (select value from json_each(?))
       order by review.completed_at asc, lower(user.name), user.id`,
    )
    .bind(projectId, JSON.stringify([...new Set(runIds)]))
    .all<IssueResultReviewRow>();
  return reviews.results;
}

export async function updateHuntRunExecutionMetrics(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    attempt: number;
    workerId: string;
    executionId?: string;
    metrics: AgentExecutionMetrics;
  },
) {
  const result = await db
    .prepare(
      `update briar_hunt_runs
       set execution_metrics_json = ?
       where id = ? and project_id = ? and current_attempt = ?
         and worker_id = ?
         and (? is null or last_execution_id = ?)`,
    )
    .bind(
      stableJson(input.metrics),
      input.runId,
      projectId,
      input.attempt,
      input.workerId,
      input.executionId ?? null,
      input.executionId ?? null,
    )
    .run();
  return result.meta.changes > 0;
}

export async function listHuntRunEvents(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const events = await db
    .prepare(
      `select event.id, event.run_id, event.event_key, event.attempt,
              event.revision, event.stage, event.status, event.workflow_stage,
              event.detail, event.actor, event.branch, event.commit_sha,
              event.qa_status, event.tracker_issue_state,
              event.pull_request_urls, event.target_sha,
              event.occurred_at, event.recorded_at
       from briar_hunt_events event
       join briar_hunt_runs run on run.id = event.run_id
       where run.project_id = ? and event.run_id = ?
       order by event.occurred_at desc, event.id desc`,
    )
    .bind(projectId, runId)
    .all<HuntEventRow>();

  return events.results;
}

export async function listIssueDependencies(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select dependency.project_id, dependency.prerequisite_run_id,
              dependency.dependent_run_id, dependency.created_by_user_id,
              dependency.created_at,
              prerequisite.run_number as prerequisite_run_number,
              prerequisite.title as prerequisite_title,
              prerequisite.status as prerequisite_status,
              prerequisite.paused_at as prerequisite_paused_at,
              dependent.run_number as dependent_run_number,
              dependent.title as dependent_title,
              dependent.status as dependent_status,
              dependent.paused_at as dependent_paused_at
       from briar_issue_dependencies dependency
       join briar_hunt_runs prerequisite
         on prerequisite.id = dependency.prerequisite_run_id
       join briar_hunt_runs dependent
         on dependent.id = dependency.dependent_run_id
       where dependency.project_id = ?
       order by dependency.created_at, dependency.prerequisite_run_id,
                dependency.dependent_run_id`,
    )
    .bind(projectId)
    .all<IssueDependencyRow>();
  return result.results;
}

export async function listIssueDependenciesByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const serializedRunIds = JSON.stringify([...new Set(runIds)]);
  const result = await db
    .prepare(
      `select dependency.project_id, dependency.prerequisite_run_id,
              dependency.dependent_run_id, dependency.created_by_user_id,
              dependency.created_at,
              prerequisite.run_number as prerequisite_run_number,
              prerequisite.title as prerequisite_title,
              prerequisite.status as prerequisite_status,
              prerequisite.paused_at as prerequisite_paused_at,
              dependent.run_number as dependent_run_number,
              dependent.title as dependent_title,
              dependent.status as dependent_status,
              dependent.paused_at as dependent_paused_at
       from briar_issue_dependencies dependency
       join briar_hunt_runs prerequisite
         on prerequisite.id = dependency.prerequisite_run_id
       join briar_hunt_runs dependent
         on dependent.id = dependency.dependent_run_id
       where dependency.project_id = ?
         and (
           dependency.prerequisite_run_id in (select value from json_each(?))
           or dependency.dependent_run_id in (select value from json_each(?))
         )
       order by dependency.created_at, dependency.prerequisite_run_id,
                dependency.dependent_run_id`,
    )
    .bind(projectId, serializedRunIds, serializedRunIds)
    .all<IssueDependencyRow>();
  return result.results;
}

export async function createIssueDependency(
  db: D1Database,
  projectId: string,
  input: {
    prerequisiteRunId: string;
    dependentRunId: string;
    createdByUserId: string;
    createdAt: string;
  },
): Promise<IssueDependencyMutationOutcome> {
  const inserted = await db
    .prepare(
      `with recursive reachable(run_id) as (
         values (?)
         union
         select dependency.dependent_run_id
         from briar_issue_dependencies dependency
         join reachable
           on reachable.run_id = dependency.prerequisite_run_id
         where dependency.project_id = ?
       )
       insert into briar_issue_dependencies (
         project_id, prerequisite_run_id, dependent_run_id,
         created_by_user_id, created_at
       )
       select ?, ?, ?, ?, ?
       where exists (
         select 1 from briar_hunt_runs
         where id = ? and project_id = ?
       )
         and exists (
           select 1 from briar_hunt_runs
           where id = ? and project_id = ?
             and status in ('backlog', 'queued', 'blocked', 'failed')
         )
         and not exists (
           select 1 from reachable where run_id = ?
         )
       on conflict (prerequisite_run_id, dependent_run_id) do nothing
       returning prerequisite_run_id`,
    )
    .bind(
      input.dependentRunId,
      projectId,
      projectId,
      input.prerequisiteRunId,
      input.dependentRunId,
      input.createdByUserId,
      input.createdAt,
      input.prerequisiteRunId,
      projectId,
      input.dependentRunId,
      projectId,
      input.prerequisiteRunId,
    )
    .first<{ prerequisite_run_id: string }>();
  if (inserted) return "created";

  const runs = await db
    .prepare(
      `select
         exists(
           select 1 from briar_hunt_runs
           where project_id = ? and id = ?
         ) as prerequisite_exists,
         exists(
           select 1 from briar_hunt_runs
           where project_id = ? and id = ?
         ) as dependent_exists,
         (select status from briar_hunt_runs
          where project_id = ? and id = ?) as dependent_status`,
    )
    .bind(
      projectId,
      input.prerequisiteRunId,
      projectId,
      input.dependentRunId,
      projectId,
      input.dependentRunId,
    )
    .first<{
      prerequisite_exists: number;
      dependent_exists: number;
      dependent_status: AutoHuntRunStatus | null;
    }>();
  if (!runs?.prerequisite_exists || !runs.dependent_exists) return "not_found";

  const existing = await db
    .prepare(
      `select 1 as present from briar_issue_dependencies
       where project_id = ? and prerequisite_run_id = ?
         and dependent_run_id = ?`,
    )
    .bind(projectId, input.prerequisiteRunId, input.dependentRunId)
    .first<{ present: number }>();
  if (existing) return "already_exists";
  if (
    !["backlog", "queued", "blocked", "failed"].includes(
      runs.dependent_status ?? "",
    )
  ) {
    return "ineligible";
  }
  return "cycle";
}

export async function deleteIssueDependency(
  db: D1Database,
  projectId: string,
  prerequisiteRunId: string,
  dependentRunId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_issue_dependencies
       where project_id = ? and prerequisite_run_id = ?
         and dependent_run_id = ?`,
    )
    .bind(projectId, prerequisiteRunId, dependentRunId)
    .run();
  return result.meta.changes > 0;
}

export async function listIssueMessages(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name,
              author.image as author_image, message.body,
              (select count(*) from briar_issue_messages reply
               where reply.parent_message_id = message.id) as reply_count,
              message.created_at, message.updated_at
       from briar_issue_messages message
       join briar_hunt_runs run
         on run.id = message.run_id and run.project_id = message.project_id
       left join "user" author on author.id = message.author_user_id
       where message.project_id = ? and message.run_id = ?
       order by message.created_at, message.id
       limit 1000`,
    )
    .bind(projectId, runId)
    .all<IssueMessageRow>();
  return result.results;
}

export async function listIssueThreadMessages(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name,
              author.image as author_image, message.body,
              (select count(*) from briar_issue_messages reply
               where reply.parent_message_id = message.id) as reply_count,
              message.created_at, message.updated_at
       from briar_issue_messages message
       join briar_hunt_runs run
         on run.id = message.run_id and run.project_id = message.project_id
       left join "user" author on author.id = message.author_user_id
       where message.project_id = ? and message.run_id = ?
         and message.id in (
           with recursive thread_path(id, parent_message_id) as (
             select message.id, message.parent_message_id
             from briar_issue_messages message
             where message.project_id = ? and message.run_id = ?
               and message.id = ?
             union all
             select parent.id, parent.parent_message_id
             from briar_issue_messages parent
             join thread_path path on parent.id = path.parent_message_id
           ),
           thread_messages(id) as (
             select id from thread_path where parent_message_id is null
             union all
             select message.id
             from briar_issue_messages message
             join thread_messages thread on message.parent_message_id = thread.id
             where message.project_id = ? and message.run_id = ?
           )
           select id from thread_messages
         )
       order by message.created_at, message.id`,
    )
    .bind(projectId, runId, projectId, runId, messageId, projectId, runId)
    .all<IssueMessageRow>();
  return result.results;
}

export async function createIssueMessage(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    parentMessageId: string | null;
    authorUserId: string | null;
    authorAgentProvider: ProjectAgentProvider | null;
    body: string;
    mentionedUserIds?: string[];
    createdAt: string;
  },
) {
  const parentMessageId = input.parentMessageId?.toLowerCase() ?? null;
  const result = await db
    .prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_provider, body, created_at, updated_at
       )
       select ?, run.project_id, run.id, parent.id, ?, ?, ?, ?, ?
       from briar_hunt_runs run
       left join briar_issue_messages parent
         on parent.id = ?
        and parent.project_id = run.project_id
        and parent.run_id = run.id
       where run.id = ? and run.project_id = ?
         and (? is null or parent.id is not null)`,
    )
    .bind(
      input.id,
      input.authorUserId,
      input.authorAgentProvider,
      input.body,
      input.createdAt,
      input.createdAt,
      parentMessageId,
      input.runId,
      input.projectId,
      parentMessageId,
    )
    .run();
  if (result.meta.changes < 1) return null;
  const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])];
  if (mentionedUserIds.length > 0) {
    await db.batch(
      mentionedUserIds.map((userId) =>
        db
          .prepare(
            `insert into briar_issue_message_mentions (
               message_id, user_id, created_at
             )
             select message.id, membership.user_id, ?
             from briar_issue_messages message
             join briar_projects project on project.id = message.project_id
             join briar_organization_members membership
               on membership.organization_id = project.organization_id
              and membership.user_id = ?
             where message.id = ?
               and (message.author_user_id is null
                 or message.author_user_id != membership.user_id)
             on conflict (message_id, user_id) do nothing`,
          )
          .bind(input.createdAt, userId, input.id),
      ),
    );
  }
  const messages = await listIssueMessages(db, input.projectId, input.runId);
  return messages.find((message) => message.id === input.id) ?? null;
}

export async function getIssueMessage(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
) {
  return await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name,
              author.image as author_image, message.body,
              (select count(*) from briar_issue_messages reply
               where reply.parent_message_id = message.id) as reply_count,
              message.created_at, message.updated_at
       from briar_issue_messages message
       left join "user" author on author.id = message.author_user_id
       where message.project_id = ? and message.run_id = ? and message.id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = message.run_id
             and run.project_id = message.project_id
         )`,
    )
    .bind(projectId, runId, messageId)
    .first<IssueMessageRow>();
}

export async function updateIssueMessage(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
  input: {
    body: string;
    mentionedUserIds?: string[];
    updatedAt: string;
  },
) {
  const updated = await db
    .prepare(
      `update briar_issue_messages
       set body = ?, updated_at = ?
       where project_id = ? and run_id = ? and id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_messages.run_id
             and run.project_id = briar_issue_messages.project_id
         )`,
    )
    .bind(input.body, input.updatedAt, projectId, runId, messageId)
    .run();
  if (updated.meta.changes < 1) return null;
  const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])];
  await db.batch([
    db
      .prepare(`delete from briar_issue_message_mentions where message_id = ?`)
      .bind(messageId),
    ...mentionedUserIds.map((userId) =>
      db
        .prepare(
          `insert into briar_issue_message_mentions (
             message_id, user_id, created_at
           )
           select message.id, membership.user_id, ?
           from briar_issue_messages message
           join briar_projects project on project.id = message.project_id
           join briar_organization_members membership
             on membership.organization_id = project.organization_id
            and membership.user_id = ?
           where message.id = ?
             and (message.author_user_id is null
               or message.author_user_id != membership.user_id)
           on conflict (message_id, user_id) do nothing`,
        )
        .bind(input.updatedAt, userId, messageId),
    ),
  ]);
  const messages = await listIssueMessages(db, projectId, runId);
  return messages.find((message) => message.id === messageId) ?? null;
}

export async function deleteIssueMessage(
  db: D1Database,
  projectId: string,
  runId: string,
  messageId: string,
) {
  const result = await db
    .prepare(
      `with recursive descendants(id) as (
         select message.id
         from briar_issue_messages message
         where message.project_id = ? and message.run_id = ? and message.id = ?
         union all
         select reply.id
         from briar_issue_messages reply
         join descendants parent on reply.parent_message_id = parent.id
         where reply.project_id = ? and reply.run_id = ?
       )
       delete from briar_issue_messages
       where id in (select id from descendants)
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_messages.run_id
             and run.project_id = briar_issue_messages.project_id
         )`,
    )
    .bind(projectId, runId, messageId, projectId, runId)
    .run();
  return result.meta.changes > 0;
}

export async function enqueueIssueAgentReply(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    triggerMessageId: string;
    parentMessageId: string;
    replyMessageId: string;
    skillId?: string | null;
    createdAt: string;
  },
) {
  const skillExecutionAvailable =
    await agentSkillExecutionApprovalTablesAvailable(db);
  await db
    .prepare(
      skillExecutionAvailable
        ? `insert into briar_issue_agent_reply_jobs (
         id, project_id, run_id, trigger_message_id, parent_message_id,
         reply_message_id, preferred_worker_id, preferred_provider,
         skill_id, selected_skill_id_snapshot,
         selected_agent_name_snapshot,
         selected_agent_responsibility_snapshot,
         selected_skill_name_snapshot, selected_skill_instructions_snapshot,
         selected_skill_kind_snapshot,
         selected_skill_provider_snapshot, selected_skill_model_snapshot,
         selected_skill_effort_snapshot, skill_execution_request_snapshot,
         created_at, updated_at
       )
       select ?, run.project_id, run.id, trigger.id, parent.id, ?,
              run.worker_id,
              coalesce(
                selected_skill.provider,
                run.requested_agent_provider,
                (
                  select skill.provider
                  from briar_agent_skills skill
                  where skill.agent_id = agent.id
                    and skill.kind = 'issue_processing'
                  order by skill.position, skill.created_at, skill.id
                  limit 1
                ),
                agent.provider
              ),
              selected_skill.id, selected_skill.id,
              case when selected_skill.id is null then null else agent.name end,
              case when selected_skill.id is null then null
                else agent.responsibility end,
              selected_skill.name, selected_skill.instructions,
              selected_skill.kind,
              selected_skill.provider, selected_skill.model,
              selected_skill.effort,
              case when selected_skill.id is null then null else trigger.body end,
              ?, ?
       from briar_hunt_runs run
       join briar_issue_messages trigger
         on trigger.id = ? and trigger.project_id = run.project_id
        and trigger.run_id = run.id
       join briar_issue_messages parent
         on parent.id = ? and parent.project_id = run.project_id
        and parent.run_id = run.id
       left join briar_project_agents agent
         on agent.id = run.agent_id and agent.project_id = run.project_id
       left join briar_agent_skills selected_skill
         on selected_skill.id = ? and selected_skill.agent_id = agent.id
       where run.id = ? and run.project_id = ?
         and (? is null or selected_skill.id is not null)
       on conflict (project_id, trigger_message_id) do nothing`
        : `insert into briar_issue_agent_reply_jobs (
         id, project_id, run_id, trigger_message_id, parent_message_id,
         reply_message_id, preferred_worker_id, preferred_provider,
         created_at, updated_at
       )
       select ?, run.project_id, run.id, trigger.id, parent.id, ?,
              run.worker_id,
              coalesce(
                run.requested_agent_provider,
                (
                  select skill.provider
                  from briar_agent_skills skill
                  where skill.agent_id = agent.id
                    and skill.kind = 'issue_processing'
                  order by skill.position, skill.created_at, skill.id
                  limit 1
                ),
                agent.provider
              ),
              ?, ?
       from briar_hunt_runs run
       join briar_issue_messages trigger
         on trigger.id = ? and trigger.project_id = run.project_id
        and trigger.run_id = run.id
       join briar_issue_messages parent
         on parent.id = ? and parent.project_id = run.project_id
        and parent.run_id = run.id
       left join briar_project_agents agent
         on agent.id = run.agent_id and agent.project_id = run.project_id
       where run.id = ? and run.project_id = ?
       on conflict (project_id, trigger_message_id) do nothing`,
    )
    .bind(...(
      skillExecutionAvailable
        ? [
            input.id,
            input.replyMessageId,
            input.createdAt,
            input.createdAt,
            input.triggerMessageId,
            input.parentMessageId,
            input.skillId ?? null,
            input.runId,
            input.projectId,
            input.skillId ?? null,
          ]
        : [
            input.id,
            input.replyMessageId,
            input.createdAt,
            input.createdAt,
            input.triggerMessageId,
            input.parentMessageId,
            input.runId,
            input.projectId,
          ]
    ))
    .run();
  return getIssueAgentReplyJob(db, input.projectId, input.triggerMessageId);
}

export async function getIssueAgentReplyJob(
  db: D1Database,
  projectId: string,
  triggerMessageId: string,
) {
  return await db
    .prepare(
      `select job.*
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where job.project_id = ? and job.trigger_message_id = ?`,
    )
    .bind(projectId, triggerMessageId)
    .first<IssueAgentReplyJobRow>();
}

export async function listIssueAgentReplyJobs(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select job.*
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where job.project_id = ? and job.run_id = ?
       order by job.created_at, job.id`,
    )
    .bind(projectId, runId)
    .all<IssueAgentReplyJobRow>();
  return result.results;
}

export async function claimNextIssueAgentReply(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    agentProvider: ProjectAgentProvider;
    agentProviders: ProjectAgentProvider[];
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
    staleBefore: string;
  },
) {
  const skillProviderPlaceholders = input.agentProviders
    .map(() => "?")
    .join(", ");
  // Migration 0092 is a deployment prerequisite, so every claim enforces the
  // saved-Skill snapshot without a runtime compatibility branch.
  const selectedSkillGuard = `and (
         job.selected_skill_id_snapshot is null
         or (
           job.skill_id = job.selected_skill_id_snapshot
           and exists (
             select 1
             from briar_projects project
             join briar_project_agents selected_agent
               on selected_agent.id = run.agent_id
              and selected_agent.project_id = run.project_id
              and selected_agent.organization_id = project.organization_id
             join briar_agent_skills selected_skill
               on selected_skill.id = job.selected_skill_id_snapshot
              and selected_skill.agent_id = selected_agent.id
             join briar_issue_messages trigger
               on trigger.id = job.trigger_message_id
              and trigger.project_id = job.project_id
              and trigger.run_id = job.run_id
             where project.id = run.project_id
               and selected_skill.provider in (${skillProviderPlaceholders})
               and selected_agent.name = job.selected_agent_name_snapshot
               and selected_agent.responsibility =
                 job.selected_agent_responsibility_snapshot
               and selected_skill.name = job.selected_skill_name_snapshot
               and selected_skill.instructions =
                 job.selected_skill_instructions_snapshot
               and selected_skill.kind = job.selected_skill_kind_snapshot
               and selected_skill.provider = job.selected_skill_provider_snapshot
               and selected_skill.model is job.selected_skill_model_snapshot
               and selected_skill.effort is job.selected_skill_effort_snapshot
               and trigger.body = job.skill_execution_request_snapshot
             )
         )
       )`;
  await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'failed',
           error = coalesce(error, 'Worker reply lease expired repeatedly.'),
           claim_token_hash = null, lease_expires_at = null, updated_at = ?
       where project_id = ? and status = 'running' and attempts >= 3
         and lease_expires_at <= ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )`,
    )
    .bind(input.claimedAt, projectId, input.claimedAt)
    .run();
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'running', claimed_worker_id = ?,
           agent_provider = case
             when preferred_provider = 'codex' and ? = 1 then 'codex'
             when preferred_provider = 'claude' and ? = 1 then 'claude'
             when preferred_provider = 'grok' and ? = 1 then 'grok'
             when preferred_provider = 'agy' and ? = 1 then 'agy'
             when preferred_provider = 'opencode' and ? = 1 then 'opencode'
             else ?
           end,
           claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + 1, error = null, updated_at = ?
       where id = (
         select job.id
         from briar_issue_agent_reply_jobs job
         join briar_hunt_runs run
           on run.id = job.run_id and run.project_id = job.project_id
         where job.project_id = ?
           and job.attempts < 3
           and (
             job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?)
           )
           and (
             not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = job.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1
               from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = job.project_id
                 and allowed.worker_id = ?
             )
           )
           and (
             job.preferred_worker_id is null
             or job.preferred_worker_id = ?
             or not exists (
               select 1
               from briar_execution_workers preferred
               join briar_execution_worker_devices device
                 on device.id = preferred.device_id
               where preferred.id = job.preferred_worker_id
                 and preferred.project_id = job.project_id
                 and preferred.state != 'disabled'
                 and device.state != 'disabled'
                 and preferred.accepting_work = 1
                 and preferred.readiness_state != 'needs_attention'
                 and preferred.last_heartbeat_at >= ?
                 and (
                   not exists (
                     select 1
                     from briar_project_execution_worker_policies policy
                     where policy.project_id = job.project_id
                       and policy.selection_mode = 'allowlist'
                   )
                   or exists (
                     select 1
                     from briar_project_execution_worker_allowlist allowed
                     where allowed.project_id = job.project_id
                       and allowed.worker_id = preferred.id
                   )
                 )
             )
           )
           ${selectedSkillGuard}
         order by job.created_at, job.id
         limit 1
       )
       returning *`,
    )
    .bind(
      input.workerId,
      input.agentProviders.includes("codex") ? 1 : 0,
      input.agentProviders.includes("claude") ? 1 : 0,
      input.agentProviders.includes("grok") ? 1 : 0,
      input.agentProviders.includes("agy") ? 1 : 0,
      input.agentProviders.includes("opencode") ? 1 : 0,
      input.agentProvider,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      projectId,
      input.claimedAt,
      input.workerId,
      input.workerId,
      input.staleBefore,
      ...input.agentProviders,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function renewIssueAgentReplyLease(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    leaseExpiresAt: string;
    updatedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set lease_expires_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )
       returning *`,
    )
    .bind(
      input.leaseExpiresAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.updatedAt,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function getClaimedIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    observedAt: string;
  },
) {
  return await db
    .prepare(
      `select job.*
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where job.id = ? and job.project_id = ? and job.status = 'running'
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.lease_expires_at > ?`,
    )
    .bind(
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function failIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    error: string;
    updatedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           preferred_worker_id = null,
           claim_token_hash = null, claimed_at = null, lease_expires_at = null,
           error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )
       returning *`,
    )
    .bind(
      input.error,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.updatedAt,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function completeIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    completedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'completed', claim_token_hash = null,
           lease_expires_at = null, completed_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )
       returning *`,
    )
    .bind(
      input.completedAt,
      input.completedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.completedAt,
    )
    .first<IssueAgentReplyJobRow>();
}

export type IssueAgentReplyCompletionOutput = {
  body: string;
  proposedAction:
    | {
        type: "request_issue_rework";
        workflowStage: string;
        reason: string;
      }
    | {
        type: "request_issue_update";
        changes: Record<string, unknown>;
      }
    | {
        type: "request_issue_create";
        issue: Record<string, unknown>;
        executeAfterCreate: boolean;
      }
    | null;
  executionProposal: boolean;
  skillExecutionProposal?: boolean;
};

/**
 * Commits the claim transition, reply, and optional approval card in one D1
 * batch. The claim token intentionally remains on the completed row until the
 * final statement so every artifact insert can prove it belongs to the exact
 * live lease that won the transition.
 */
export async function completeIssueAgentReplyOutput(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    completedAt: string;
    output: IssueAgentReplyCompletionOutput;
  },
) {
  const executionApprovalsAvailable =
    await issueExecutionApprovalTablesAvailable(db);
  const skillExecutionApprovalsAvailable =
    await agentSkillExecutionApprovalTablesAvailable(db);
  if (
    !executionApprovalsAvailable &&
    (input.output.executionProposal ||
      (input.output.proposedAction?.type === "request_issue_create" &&
        input.output.proposedAction.executeAfterCreate))
  ) {
    throw new Error("issue execution approval schema is unavailable");
  }
  if (
    input.output.skillExecutionProposal &&
    !skillExecutionApprovalsAvailable
  ) {
    throw new Error("Agent Skill execution approval schema is unavailable");
  }
  if (
    input.output.skillExecutionProposal &&
    (input.output.executionProposal || input.output.proposedAction)
  ) {
    throw new Error(
      "Agent Skill execution cannot be combined with another proposal",
    );
  }

  const proposedAction = input.output.proposedAction;
  const rework = proposedAction?.type === "request_issue_rework"
    ? proposedAction
    : null;
  const action = proposedAction && proposedAction.type !== "request_issue_rework"
    ? proposedAction
    : null;
  const actionProposalId = action ? crypto.randomUUID() : null;
  const reworkProposalId = rework ? crypto.randomUUID() : null;
  const executionProposalId = input.output.executionProposal
    ? crypto.randomUUID()
    : null;
  const createExecutionProposalId =
    action?.type === "request_issue_create" && action.executeAfterCreate
      ? crypto.randomUUID()
      : null;
  const skillExecutionProposalId = input.output.skillExecutionProposal
    ? crypto.randomUUID()
    : null;
  const staleExecutionGuard = executionApprovalsAvailable
    ? `and not exists (
         select 1 from briar_issue_execution_proposals stale_execution
         where stale_execution.reply_message_id = job.reply_message_id
            or (
              stale_execution.project_id = job.project_id
              and stale_execution.trigger_message_id = job.trigger_message_id
              and stale_execution.source_kind = 'issue'
            )
       )`
    : "";
  const staleSkillExecutionGuard = skillExecutionApprovalsAvailable
    ? `and not exists (
         select 1
         from briar_agent_skill_execution_proposals stale_skill_execution
         where stale_skill_execution.reply_message_id = job.reply_message_id
            or (
              stale_skill_execution.project_id = job.project_id
              and stale_skill_execution.trigger_message_id =
                job.trigger_message_id
              and stale_skill_execution.source_kind = 'issue'
            )
       )`
    : "";

  const transition = db
    .prepare(
      `update briar_issue_agent_reply_jobs as job
       set status = 'completed', completed_at = ?, updated_at = ?
       where job.id = ? and job.project_id = ? and job.status = 'running'
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = job.run_id and run.project_id = job.project_id
         )
         and not exists (
           select 1 from briar_issue_messages stale_message
           where stale_message.id = job.reply_message_id
         )
         and not exists (
           select 1 from briar_issue_rework_proposals stale_rework
           where stale_rework.reply_message_id = job.reply_message_id
              or (
                stale_rework.project_id = job.project_id
                and stale_rework.trigger_message_id = job.trigger_message_id
              )
         )
         and not exists (
           select 1 from briar_issue_action_proposals stale_action
           where stale_action.reply_message_id = job.reply_message_id
              or (
                stale_action.project_id = job.project_id
                and stale_action.trigger_message_id = job.trigger_message_id
              )
         )
         ${staleExecutionGuard}
         ${staleSkillExecutionGuard}
         and (
           ? = 0
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = job.run_id and run.project_id = job.project_id
               and run.status = 'completed'
               and exists (
                 select 1
                 from json_each(run.workflow_snapshot_json, '$.stages') stage
                 where json_extract(stage.value, '$.id') = ?
               )
           )
         )
         and (
           ? = 0
           or exists (
             select 1 from briar_hunt_runs run
             where run.id = job.run_id and run.project_id = job.project_id
               and run.status = 'backlog' and run.stage = 'queued'
               and run.workflow_stage is null
               and run.worker_id is null and run.requested_worker_id is null
               and run.claim_token_hash is null and run.claimed_by is null
               and run.claimed_at is null and run.lease_expires_at is null
               and run.last_execution_id is null
               and run.dispatch_mode is null
               and run.dispatch_request_id is null
               and run.dispatched_at is null
               and run.requested_by_user_id is null
               and run.completed_at is null and run.paused_at is null
               and run.resume_requested_at is null
           )
         )
         and (
           ? = 0
           or exists (
             select 1
             from briar_hunt_runs run
             join briar_projects project on project.id = run.project_id
             join briar_project_agents agent
               on agent.id = run.agent_id and agent.project_id = run.project_id
              and agent.organization_id = project.organization_id
             join briar_agent_skills skill
               on skill.id = job.skill_id and skill.agent_id = agent.id
              and job.selected_skill_id_snapshot = skill.id
             join briar_issue_messages trigger
               on trigger.id = job.trigger_message_id
              and trigger.project_id = job.project_id
              and trigger.run_id = job.run_id
             where run.id = job.run_id and run.project_id = job.project_id
               and agent.name = job.selected_agent_name_snapshot
               and agent.responsibility =
                 job.selected_agent_responsibility_snapshot
               and skill.name = job.selected_skill_name_snapshot
               and skill.instructions =
                 job.selected_skill_instructions_snapshot
               and skill.kind = job.selected_skill_kind_snapshot
               and skill.provider = job.selected_skill_provider_snapshot
               and skill.model is job.selected_skill_model_snapshot
               and skill.effort is job.selected_skill_effort_snapshot
               and trigger.body = job.skill_execution_request_snapshot
           )
         )
       returning *`,
    )
    .bind(
      input.completedAt,
      input.completedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.completedAt,
      rework ? 1 : 0,
      rework?.workflowStage ?? null,
      input.output.executionProposal ? 1 : 0,
      input.output.skillExecutionProposal ? 1 : 0,
    );

  const completedClaim = (alias: string) =>
    `${alias}.id = ? and ${alias}.project_id = ?
     and ${alias}.status = 'completed'
     and ${alias}.claimed_worker_id = ?
     and ${alias}.claim_token_hash = ?
     and ${alias}.completed_at = ?`;
  const claimBindings = [
    jobId,
    projectId,
    input.workerId,
    input.claimTokenHash,
    input.completedAt,
  ];
  const statements: D1PreparedStatement[] = [
    transition,
    db.prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_provider, body, created_at, updated_at
       )
       select job.reply_message_id, job.project_id, job.run_id, parent.id,
              null, job.agent_provider, ?, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_issue_messages parent
         on parent.id = job.parent_message_id
        and parent.project_id = job.project_id and parent.run_id = job.run_id
       where ${completedClaim("job")}`,
    ).bind(
      input.output.body,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ),
  ];

  if (rework) {
    statements.push(db.prepare(
      `insert into briar_issue_rework_proposals (
         id, project_id, run_id, trigger_message_id, reply_message_id,
         workflow_stage, reason, expected_attempt, expected_revision,
         created_at, updated_at
       )
       select ?, job.project_id, run.id, job.trigger_message_id,
              job.reply_message_id, ?, ?, run.current_attempt,
              run.current_revision, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where ${completedClaim("job")}`,
    ).bind(
      reworkProposalId,
      rework.workflowStage,
      rework.reason,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ));
  }

  if (action) {
    const payloadJson = JSON.stringify(
      action.type === "request_issue_update"
        ? { changes: action.changes }
        : { issue: action.issue },
    );
    statements.push(db.prepare(
      executionApprovalsAvailable
        ? `insert into briar_issue_action_proposals (
             id, project_id, conversation_run_id, trigger_message_id,
             reply_message_id, action_type, payload_json,
             expected_run_updated_at, execute_after_create,
             execution_proposal_id, created_at, updated_at
           )
           select ?, job.project_id, run.id, job.trigger_message_id,
                  job.reply_message_id, ?, ?,
                  case when ? = 'request_issue_update'
                    then run.updated_at else null end,
                  ?, ?, ?, ?
           from briar_issue_agent_reply_jobs job
           join briar_hunt_runs run
             on run.id = job.run_id and run.project_id = job.project_id
           where ${completedClaim("job")}`
        : `insert into briar_issue_action_proposals (
             id, project_id, conversation_run_id, trigger_message_id,
             reply_message_id, action_type, payload_json,
             expected_run_updated_at, created_at, updated_at
           )
           select ?, job.project_id, run.id, job.trigger_message_id,
                  job.reply_message_id, ?, ?,
                  case when ? = 'request_issue_update'
                    then run.updated_at else null end,
                  ?, ?
           from briar_issue_agent_reply_jobs job
           join briar_hunt_runs run
             on run.id = job.run_id and run.project_id = job.project_id
           where ${completedClaim("job")}`,
    ).bind(...(
      executionApprovalsAvailable
        ? [
            actionProposalId,
            action.type,
            payloadJson,
            action.type,
            action.type === "request_issue_create" && action.executeAfterCreate
              ? 1
              : 0,
            createExecutionProposalId,
            input.completedAt,
            input.completedAt,
            ...claimBindings,
          ]
        : [
            actionProposalId,
            action.type,
            payloadJson,
            action.type,
            input.completedAt,
            input.completedAt,
            ...claimBindings,
          ]
    )));
  }

  if (input.output.executionProposal) {
    statements.push(db.prepare(
      `insert into briar_issue_execution_proposals (
         id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         target_run_id, target_title, target_run_updated_at,
         proposed_by_agent_id, delegated_by_agent_id,
         delegated_by_agent_name, created_at, updated_at
       )
       select ?, project.organization_id, job.project_id, 'issue', null,
              job.run_id, job.trigger_message_id, job.reply_message_id,
              run.id, run.title, run.updated_at, run.agent_id,
              null, null, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       join briar_projects project on project.id = job.project_id
       where ${completedClaim("job")}`,
    ).bind(
      executionProposalId,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ));
  }

  if (input.output.skillExecutionProposal) {
    statements.push(db.prepare(
      `insert into briar_agent_skill_execution_proposals (
         id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         source_reply_job_id, delegated_by_reply_job_id,
         agent_id, agent_name, agent_responsibility,
         skill_id, skill_name, skill_instructions,
         skill_kind, provider, model, effort, request, delegated_by_agent_id,
         delegated_by_agent_name, created_at, updated_at
       )
       select ?, project.organization_id, job.project_id, 'issue', null,
              job.run_id, job.trigger_message_id, job.reply_message_id,
              job.id, null, agent.id, job.selected_agent_name_snapshot,
              job.selected_agent_responsibility_snapshot,
              skill.id, job.selected_skill_name_snapshot,
              job.selected_skill_instructions_snapshot,
              job.selected_skill_kind_snapshot,
              job.selected_skill_provider_snapshot,
              job.selected_skill_model_snapshot,
              job.selected_skill_effort_snapshot,
              job.skill_execution_request_snapshot, null, null, ?, ?
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       join briar_projects project on project.id = job.project_id
       join briar_project_agents agent
         on agent.id = run.agent_id and agent.project_id = run.project_id
        and agent.organization_id = project.organization_id
       join briar_agent_skills skill
         on skill.id = job.skill_id and skill.agent_id = agent.id
        and job.selected_skill_id_snapshot = skill.id
       join briar_issue_messages trigger
         on trigger.id = job.trigger_message_id
        and trigger.project_id = job.project_id and trigger.run_id = job.run_id
       and agent.name = job.selected_agent_name_snapshot
       and agent.responsibility = job.selected_agent_responsibility_snapshot
       and skill.name = job.selected_skill_name_snapshot
       and skill.instructions = job.selected_skill_instructions_snapshot
       and skill.kind = job.selected_skill_kind_snapshot
       and skill.provider = job.selected_skill_provider_snapshot
       and skill.model is job.selected_skill_model_snapshot
       and skill.effort is job.selected_skill_effort_snapshot
       and trigger.body = job.skill_execution_request_snapshot
       where ${completedClaim("job")}`,
    ).bind(
      skillExecutionProposalId,
      input.completedAt,
      input.completedAt,
      ...claimBindings,
    ));
  }

  statements.push(db.prepare(
    `update briar_issue_agent_reply_jobs
     set claim_token_hash = null, lease_expires_at = null
     where ${completedClaim("briar_issue_agent_reply_jobs")}`,
  ).bind(...claimBindings));

  const results = await db.batch(statements);
  const completed = results[0]?.results[0] as IssueAgentReplyJobRow | undefined;
  return completed
    ? { ...completed, claim_token_hash: null, lease_expires_at: null }
    : null;
}

export async function createIssueReworkProposal(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    triggerMessageId: string;
    replyMessageId: string;
    workflowStage: string;
    reason: string;
    createdAt: string;
  },
) {
  return await db
    .prepare(
      `insert into briar_issue_rework_proposals (
         id, project_id, run_id, trigger_message_id, reply_message_id,
         workflow_stage, reason, expected_attempt, expected_revision,
         created_at, updated_at
       )
       select ?, run.project_id, run.id, ?, ?, ?, ?,
              run.current_attempt, run.current_revision, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ? and run.status = 'completed'
         and exists (
           select 1 from json_each(run.workflow_snapshot_json, '$.stages') stage
           where json_extract(stage.value, '$.id') = ?
         )
       on conflict (project_id, trigger_message_id) do nothing
       returning *`,
    )
    .bind(
      input.id,
      input.triggerMessageId,
      input.replyMessageId,
      input.workflowStage,
      input.reason,
      input.createdAt,
      input.createdAt,
      input.runId,
      input.projectId,
      input.workflowStage,
    )
    .first<IssueReworkProposalRow>();
}

export async function listIssueReworkProposals(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select proposal.*
       from briar_issue_rework_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.run_id and run.project_id = proposal.project_id
       where proposal.project_id = ? and proposal.run_id = ?
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, runId)
    .all<IssueReworkProposalRow>();
  return result.results;
}

export async function getIssueReworkProposal(
  db: D1Database,
  projectId: string,
  runId: string,
  proposalId: string,
) {
  return await db
    .prepare(
      `select proposal.*
       from briar_issue_rework_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.run_id and run.project_id = proposal.project_id
       where proposal.id = ? and proposal.project_id = ?
         and proposal.run_id = ?`,
    )
    .bind(proposalId, projectId, runId)
    .first<IssueReworkProposalRow>();
}

export async function acceptIssueReworkProposal(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    proposalId: string;
    userId: string;
    acceptedAt: string;
    appliedRevision: number;
  },
) {
  return await db
    .prepare(
      `update briar_issue_rework_proposals
       set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
           applied_revision = ?, updated_at = ?
       where id = ? and project_id = ? and run_id = ?
         and status = 'pending'
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_rework_proposals.run_id
             and run.project_id = briar_issue_rework_proposals.project_id
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.acceptedAt,
      input.appliedRevision,
      input.acceptedAt,
      input.proposalId,
      input.projectId,
      input.runId,
    )
    .first<IssueReworkProposalRow>();
}

export async function createIssueActionProposal(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    conversationRunId: string;
    triggerMessageId: string;
    replyMessageId: string;
    actionType: IssueActionProposalRow["action_type"];
    payloadJson: string;
    executeAfterCreate?: boolean;
    executionProposalId?: string | null;
    createdAt: string;
  },
) {
  const executionApprovalsAvailable =
    await issueExecutionApprovalTablesAvailable(db);
  if (input.executeAfterCreate && !executionApprovalsAvailable) {
    throw new Error("issue execution approval schema is unavailable");
  }
  return await db
    .prepare(
      executionApprovalsAvailable
        ? `insert into briar_issue_action_proposals (
         id, project_id, conversation_run_id, trigger_message_id,
         reply_message_id, action_type, payload_json,
         expected_run_updated_at, execute_after_create,
         execution_proposal_id, created_at, updated_at
       )
       select ?, run.project_id, run.id, ?, ?, ?, ?,
              case when ? = 'request_issue_update' then run.updated_at else null end,
              ?, ?, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ?
       on conflict (project_id, trigger_message_id) do nothing
       returning *`
        : `insert into briar_issue_action_proposals (
         id, project_id, conversation_run_id, trigger_message_id,
         reply_message_id, action_type, payload_json,
         expected_run_updated_at, created_at, updated_at
       )
       select ?, run.project_id, run.id, ?, ?, ?, ?,
              case when ? = 'request_issue_update' then run.updated_at else null end,
              ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ?
       on conflict (project_id, trigger_message_id) do nothing
       returning *`,
    )
    .bind(...(
      executionApprovalsAvailable
        ? [
            input.id,
            input.triggerMessageId,
            input.replyMessageId,
            input.actionType,
            input.payloadJson,
            input.actionType,
            input.executeAfterCreate ? 1 : 0,
            input.executionProposalId ?? null,
            input.createdAt,
            input.createdAt,
            input.conversationRunId,
            input.projectId,
          ]
        : [
            input.id,
            input.triggerMessageId,
            input.replyMessageId,
            input.actionType,
            input.payloadJson,
            input.actionType,
            input.createdAt,
            input.createdAt,
            input.conversationRunId,
            input.projectId,
          ]
    ))
    .first<IssueActionProposalRow>();
}

export async function issueExecutionApprovalTablesAvailable(db: D1Database) {
  return Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table' and name = 'briar_issue_execution_proposals'`,
    )
    .first<{ available: number }>());
}

export async function agentSkillExecutionApprovalTablesAvailable(
  db: D1Database,
) {
  return Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table'
         and name = 'briar_agent_skill_execution_proposals'`,
    )
    .first<{ available: number }>());
}

export async function listIssueActionProposals(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
) {
  const result = await db
    .prepare(
      `select proposal.*
       from briar_issue_action_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.conversation_run_id
        and run.project_id = proposal.project_id
       where proposal.project_id = ? and proposal.conversation_run_id = ?
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, conversationRunId)
    .all<IssueActionProposalRow>();
  return result.results;
}

export async function getIssueActionProposal(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
) {
  return await db
    .prepare(
      `select proposal.*
       from briar_issue_action_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.conversation_run_id
        and run.project_id = proposal.project_id
       where proposal.id = ? and proposal.project_id = ?
         and proposal.conversation_run_id = ?`,
    )
    .bind(proposalId, projectId, conversationRunId)
    .first<IssueActionProposalRow>();
}

export async function acceptIssueUpdateProposal(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    acceptedAt: string;
    title: string;
    description: string | null;
    priority: number | null;
  },
) {
  const proposal = await getIssueActionProposal(
    db,
    input.projectId,
    input.conversationRunId,
    input.proposalId,
  );
  if (!proposal || proposal.action_type !== "request_issue_update") return null;
  if (proposal.status === "accepted") return proposal;
  const results = await db.batch([
    db
      .prepare(
        `update briar_hunt_runs
         set title = ?, issue_description = ?, priority = ?, updated_at = ?
         where id = ? and project_id = ? and updated_at = ?
           and exists (
             select 1 from briar_issue_action_proposals proposal
             where proposal.id = ? and proposal.project_id = ?
               and proposal.conversation_run_id = briar_hunt_runs.id
               and proposal.status = 'pending'
               and proposal.action_type = 'request_issue_update'
           )`,
      )
      .bind(
        input.title,
        input.description,
        input.priority,
        input.acceptedAt,
        input.conversationRunId,
        input.projectId,
        proposal.expected_run_updated_at,
        input.proposalId,
        input.projectId,
      ),
    db
      .prepare(
        `update briar_issue_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = conversation_run_id, updated_at = ?
         where id = ? and project_id = ? and conversation_run_id = ?
           and status = 'pending' and action_type = 'request_issue_update'
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ? and run.updated_at = ?
           )`,
      )
      .bind(
        input.userId,
        input.acceptedAt,
        input.acceptedAt,
        input.proposalId,
        input.projectId,
        input.conversationRunId,
        input.conversationRunId,
        input.projectId,
        input.acceptedAt,
      ),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0 ||
      (results[1]?.meta.changes ?? 0) === 0) {
    return null;
  }
  return await getIssueActionProposal(
    db,
    input.projectId,
    input.conversationRunId,
    input.proposalId,
  );
}

export async function acceptIssueCreateProposal(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    acceptedAt: string;
    resultRunId: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_action_proposals
       set status = 'accepted',
           accepted_by_user_id = approval_reserved_by_user_id,
           accepted_at = approval_reserved_at,
           result_run_id = ?, updated_at = approval_reserved_at
       where id = ? and project_id = ? and conversation_run_id = ?
         and status = 'pending' and action_type = 'request_issue_create'
         and approval_reserved_by_user_id is not null
         and approval_reserved_at is not null
         and issue_source_key is not null
         and exists (
           select 1 from briar_hunt_runs conversation
           where conversation.id =
               briar_issue_action_proposals.conversation_run_id
             and conversation.project_id =
               briar_issue_action_proposals.project_id
         )
         and exists (
           select 1 from briar_hunt_runs result
           where result.id = ? and result.project_id = ?
             and result.source = 'issue'
             and result.source_key =
               briar_issue_action_proposals.issue_source_key
             and result.status = 'backlog' and result.stage = 'queued'
             and result.workflow_stage is null
             and result.worker_id is null
             and result.agent_id is null
             and result.requested_worker_id is null
             and result.claim_token_hash is null
             and result.claimed_by is null and result.claimed_at is null
             and result.lease_expires_at is null
             and result.last_execution_id is null
             and result.dispatch_mode is null
             and result.dispatch_request_id is null
             and result.dispatched_at is null
             and result.requested_by_user_id is null
             and result.requested_agent_provider is null
             and result.requested_agent_model is null
             and result.requested_agent_effort is null
             and result.completed_at is null
             and result.paused_at is null
             and result.resume_requested_at is null
         )
         and exists (
           select 1
           from briar_projects project
           join briar_organization_members membership
             on membership.organization_id = project.organization_id
           where project.id = briar_issue_action_proposals.project_id
             and membership.user_id = ?
         )
       returning *`,
    )
    .bind(
      input.resultRunId,
      input.proposalId,
      input.projectId,
      input.conversationRunId,
      input.resultRunId,
      input.projectId,
      input.userId,
    )
    .first<IssueActionProposalRow>();
}

export async function reserveIssueCreateProposalApproval(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    reservedAt: string;
    issueSourceKey: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_action_proposals
       set approval_reserved_by_user_id = case
             when approval_reserved_by_user_id is null then ?
             else approval_reserved_by_user_id
           end,
           approval_reserved_at = case
             when approval_reserved_by_user_id is null then ?
             else approval_reserved_at
           end,
           issue_source_key = coalesce(issue_source_key, ?),
           updated_at = case
             when approval_reserved_by_user_id is null then ? else updated_at
           end
       where id = ? and project_id = ? and conversation_run_id = ?
         and status = 'pending' and action_type = 'request_issue_create'
         and exists (
           select 1 from briar_hunt_runs conversation
           where conversation.id =
               briar_issue_action_proposals.conversation_run_id
             and conversation.project_id =
               briar_issue_action_proposals.project_id
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.reservedAt,
      input.issueSourceKey,
      input.reservedAt,
      input.proposalId,
      input.projectId,
      input.conversationRunId,
    )
    .first<IssueActionProposalRow>();
}

export async function createIssueExecutionProposal(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    conversationRunId: string;
    triggerMessageId: string;
    replyMessageId: string;
    createdAt: string;
  },
) {
  return db
    .prepare(
      `insert into briar_issue_execution_proposals (
         id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         target_run_id, target_title, target_run_updated_at,
         proposed_by_agent_id, delegated_by_agent_id,
         delegated_by_agent_name, created_at, updated_at
       )
       select ?, project.organization_id, run.project_id, 'issue', null,
              run.id, ?, ?, run.id, run.title, run.updated_at,
              run.agent_id, null, null, ?, ?
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       join briar_issue_agent_reply_jobs job
         on job.project_id = run.project_id and job.run_id = run.id
        and job.trigger_message_id = ? and job.reply_message_id = ?
       where run.id = ? and run.project_id = ?
         and run.status = 'backlog' and run.stage = 'queued'
         and run.workflow_stage is null
         and run.worker_id is null and run.requested_worker_id is null
         and run.claim_token_hash is null and run.claimed_by is null
         and run.claimed_at is null and run.lease_expires_at is null
         and run.last_execution_id is null
         and run.dispatch_mode is null and run.dispatch_request_id is null
         and run.dispatched_at is null and run.requested_by_user_id is null
         and run.completed_at is null and run.paused_at is null
         and run.resume_requested_at is null
       on conflict (reply_message_id) do nothing
       returning *`,
    )
    .bind(
      input.id,
      input.triggerMessageId,
      input.replyMessageId,
      input.createdAt,
      input.createdAt,
      input.triggerMessageId,
      input.replyMessageId,
      input.conversationRunId,
      input.projectId,
    )
    .first<IssueExecutionProposalRow>();
}

export async function listIssueExecutionProposals(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
) {
  if (!(await issueExecutionApprovalTablesAvailable(db))) return [];
  const rows = await db
    .prepare(
      `select proposal.*
       from briar_issue_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?
         and proposal.status in ('pending', 'accepted')
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, conversationRunId)
    .all<IssueExecutionProposalRow>();
  return rows.results;
}

export async function getIssueExecutionProposal(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select proposal.*
       from briar_issue_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.id = ? and proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?`,
    )
    .bind(proposalId, projectId, conversationRunId)
    .first<IssueExecutionProposalRow>();
}

export async function reserveIssueExecutionProposalApproval(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    provider: ProjectAgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    workerId: string | null;
    dispatchRequestId: string;
    reservedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_issue_execution_proposals
       set approval_reserved_by_user_id = coalesce(
             approval_reserved_by_user_id, ?
           ),
           approval_reserved_at = coalesce(approval_reserved_at, ?),
           requested_provider = coalesce(requested_provider, ?),
           requested_model = case
             when dispatch_request_id is null then ? else requested_model end,
           requested_effort = case
             when dispatch_request_id is null then ? else requested_effort end,
           requested_worker_id = case
             when dispatch_request_id is null then ? else requested_worker_id end,
           dispatch_request_id = coalesce(dispatch_request_id, ?),
           updated_at = case
             when dispatch_request_id is null then ? else updated_at end
       where id = ? and source_kind = 'issue' and status = 'pending'
         and project_id = ? and conversation_run_id = ?
         and (
           target_run_id = conversation_run_id
           or origin_create_proposal_id is not null
         )
         and (
           dispatch_request_id is null
           or (
             approval_reserved_by_user_id = ?
             and requested_provider = ? and requested_model is ?
             and requested_effort is ? and requested_worker_id is ?
           )
         )
         and exists (
           select 1
           from briar_hunt_runs run
           join briar_projects project on project.id = run.project_id
           join briar_organization_members membership
             on membership.organization_id = project.organization_id
            and membership.user_id = ?
           where run.id = briar_issue_execution_proposals.target_run_id
             and run.project_id = briar_issue_execution_proposals.project_id
             and run.updated_at =
               briar_issue_execution_proposals.target_run_updated_at
             and run.status = 'backlog' and run.stage = 'queued'
             and run.workflow_stage is null
             and run.worker_id is null and run.requested_worker_id is null
             and run.claim_token_hash is null and run.claimed_by is null
             and run.claimed_at is null and run.lease_expires_at is null
             and run.last_execution_id is null
             and run.dispatch_mode is null and run.dispatch_request_id is null
             and run.dispatched_at is null and run.requested_by_user_id is null
             and run.completed_at is null and run.paused_at is null
             and run.resume_requested_at is null
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.reservedAt,
      input.provider,
      input.model,
      input.effort,
      input.workerId,
      input.dispatchRequestId,
      input.reservedAt,
      input.proposalId,
      input.projectId,
      input.conversationRunId,
      input.userId,
      input.provider,
      input.model,
      input.effort,
      input.workerId,
      input.userId,
    )
    .first<IssueExecutionProposalRow>();
}

export async function acceptIssueExecutionProposal(
  db: D1Database,
  input: {
    proposalId: string;
    projectId: string;
    userId: string;
    acceptedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_issue_execution_proposals
       set status = 'accepted',
           accepted_by_user_id = approval_reserved_by_user_id,
           accepted_at = approval_reserved_at,
           updated_at = approval_reserved_at
       where id = ? and project_id = ? and status = 'pending'
         and approval_reserved_by_user_id = ?
         and approval_reserved_at = ?
       returning *`,
    )
    .bind(
      input.proposalId,
      input.projectId,
      input.userId,
      input.acceptedAt,
    )
    .first<IssueExecutionProposalRow>();
}

export async function listFreshBacklogExecutionTargets(
  db: D1Database,
  projectId: string,
  limit = 100,
) {
  const rows = await db
    .prepare(
      `select id, run_number, source_key, title, status
       from briar_hunt_runs
       where project_id = ? and status = 'backlog' and stage = 'queued'
         and workflow_stage is null
         and worker_id is null and requested_worker_id is null
         and claim_token_hash is null and claimed_by is null
         and claimed_at is null and lease_expires_at is null
         and last_execution_id is null
         and dispatch_mode is null and dispatch_request_id is null
         and dispatched_at is null and requested_by_user_id is null
         and completed_at is null and paused_at is null
         and resume_requested_at is null
       order by run_number desc limit ?`,
    )
    .bind(projectId, Math.max(1, Math.min(limit, 100)))
    .all<FreshBacklogExecutionTargetRow>();
  return rows.results;
}

export async function listIssueAgentSkillExecutionProposals(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
) {
  if (!(await agentSkillExecutionApprovalTablesAvailable(db))) return [];
  const rows = await db
    .prepare(
      `select proposal.*
       from briar_agent_skill_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?
         and proposal.status in ('pending', 'accepted')
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, conversationRunId)
    .all<AgentSkillExecutionProposalRow>();
  return rows.results;
}

export async function getIssueAgentSkillExecutionProposal(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select proposal.*
       from briar_agent_skill_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.id = ? and proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?`,
    )
    .bind(proposalId, projectId, conversationRunId)
    .first<AgentSkillExecutionProposalRow>();
}

export async function getAgentSkillExecutionApprovalAudit(
  db: D1Database,
  projectId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select * from briar_agent_skill_execution_approval_audit
       where project_id = ? and proposal_id = ?`,
    )
    .bind(projectId, proposalId)
    .first<AgentSkillExecutionApprovalAuditRow>();
}

export async function acceptAgentSkillExecutionProposal(
  db: D1Database,
  input: {
    proposalId: string;
    sourceKind: "channel" | "issue";
    organizationId: string;
    projectId: string;
    channelId: string | null;
    conversationRunId: string | null;
    userId: string;
    workerId: string;
    workerLabel: string;
    resultSessionId: string;
    acceptedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_agent_skill_execution_proposals
       set status = 'accepted', requested_worker_id = ?,
           requested_worker_label = ?, result_session_id = ?,
           accepted_by_user_id = ?, accepted_at = ?, updated_at = ?
       where id = ? and source_kind = ? and organization_id = ?
         and project_id = ? and channel_id is ? and conversation_run_id is ?
         and status = 'pending'
       returning *`,
    )
    .bind(
      input.workerId,
      input.workerLabel,
      input.resultSessionId,
      input.userId,
      input.acceptedAt,
      input.acceptedAt,
      input.proposalId,
      input.sourceKind,
      input.organizationId,
      input.projectId,
      input.channelId,
      input.conversationRunId,
    )
    .first<AgentSkillExecutionProposalRow>();
}

export async function listIssueConversationNotifications(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name, author.image as author_image,
              message.body, 0 as reply_count, message.created_at,
              message.updated_at, run.title as run_title,
              coalesce(message.parent_message_id, message.id) as root_message_id,
              case
                when mention.user_id is not null then 'mention'
                when message.parent_message_id is not null
                 and root.author_user_id = ? then 'thread_reply'
                else 'subscription'
              end as notification_reason
       from briar_issue_messages message
       join briar_hunt_runs run
         on run.id = message.run_id and run.project_id = message.project_id
       join briar_issue_subscriptions subscription
         on subscription.run_id = run.id and subscription.user_id = ?
       left join "user" author on author.id = message.author_user_id
       left join briar_issue_messages root
         on root.id = message.parent_message_id
        and root.project_id = message.project_id
        and root.run_id = message.run_id
       left join briar_issue_message_mentions mention
         on mention.message_id = message.id and mention.user_id = ?
       where message.project_id = ?
         and julianday(message.created_at) >= julianday(subscription.created_at)
         and (message.author_user_id is null or message.author_user_id != ?)
       order by message.created_at desc, message.id desc
       limit 500`,
    )
    .bind(userId, userId, userId, projectId, userId)
    .all<IssueConversationNotificationRow>();
  return result.results;
}

export async function listIssueSubscriptions(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select subscription.run_id, subscription.organization_id,
              subscription.user_id, subscription.created_at
       from briar_issue_subscriptions subscription
       join briar_hunt_runs run on run.id = subscription.run_id
       where run.project_id = ? and run.id = ?
       order by subscription.created_at, subscription.user_id`,
    )
    .bind(projectId, runId)
    .all<IssueSubscriptionRow>();
  return result.results;
}

export async function listOrganizationIssueSubscriptionRunIds(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `select run_id
       from briar_issue_subscriptions
       where organization_id = ? and user_id = ?
       order by created_at, run_id`,
    )
    .bind(organizationId, userId)
    .all<{ run_id: string }>();
  return result.results.map((row) => row.run_id);
}

export async function subscribeIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  userId: string,
  createdAt: string,
) {
  return db
    .prepare(
      `insert into briar_issue_subscriptions (
         run_id, organization_id, user_id, created_at
       )
       select run.id, project.organization_id, ?, ?
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       where run.id = ? and run.project_id = ?
       on conflict (run_id, user_id) do nothing
       returning run_id`,
    )
    .bind(userId, createdAt, userId, runId, projectId)
    .first<{ run_id: string }>();
}

export async function unsubscribeIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  userId: string,
) {
  return db
    .prepare(
      `delete from briar_issue_subscriptions
       where run_id = ? and user_id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_subscriptions.run_id
             and run.project_id = ?
         )
       returning run_id`,
    )
    .bind(runId, userId, projectId)
    .first<{ run_id: string }>();
}

/**
 * Returns channel messages that require this organization member's attention:
 * direct mentions and replies to root messages they authored. Public channels
 * are organization-visible; private channels require explicit membership.
 */
export async function listChannelConversationNotifications(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.channel_id, channel.name as channel_name,
              message.parent_message_id, message.author_user_id,
              message.author_agent_provider,
              coalesce(author.name, message.author_agent_name, '') as author_name,
              author.image as author_image, message.body, message.created_at,
              coalesce(message.parent_message_id, message.id) as root_message_id,
              notification.notification_reason
       from briar_channel_notification_inbox notification
       join briar_channel_messages message on message.id = notification.message_id
       join briar_channels channel on channel.id = message.channel_id
       left join "user" author on author.id = message.author_user_id
       where notification.user_id = ?
         and notification.organization_id = ?
         and channel.organization_id = notification.organization_id
         and channel.archived_at is null
         and (
           channel.visibility = 'public'
           or exists (
             select 1 from briar_channel_members member
             where member.channel_id = channel.id and member.user_id = ?
           )
         )
       order by notification.created_at desc, notification.message_id desc
       limit 500`,
    )
    .bind(userId, organizationId, userId)
    .all<ChannelConversationNotificationRow>();
  return result.results;
}

export async function createIssueAttachments(
  db: D1Database,
  projectId: string,
  runId: string,
  attachments: IssueAttachmentInput[],
) {
  if (attachments.length === 0) return;
  const createdAt = new Date().toISOString();
  const results = await db.batch(
    attachments.map((attachment) =>
      db
        .prepare(
          `insert into briar_issue_attachments (
             id, run_id, project_id, object_key, filename, content_type,
             byte_size, created_at
           )
           select ?, run.id, run.project_id, ?, ?, ?, ?, ?
           from briar_hunt_runs run
           where run.id = ? and run.project_id = ?
           returning id`,
        )
        .bind(
          attachment.id,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          createdAt,
          runId,
          projectId,
        ),
    ),
  );
  if (
    results.some(
      (result) => !result.success || (result.results?.length ?? 0) !== 1,
    )
  ) {
    throw new Error("Issue attachment metadata could not be stored");
  }
}

export async function deleteIssueAttachments(
  db: D1Database,
  projectId: string,
  runId: string,
  attachmentIds: string[],
) {
  if (attachmentIds.length === 0) return [];
  const results = await db.batch(
    attachmentIds.map((attachmentId) =>
      db
        .prepare(
          `delete from briar_issue_attachments
           where project_id = ? and run_id = ? and id = ?
             and exists (
               select 1 from briar_hunt_runs run
               where run.id = briar_issue_attachments.run_id
                 and run.project_id = briar_issue_attachments.project_id
             )
           returning object_key`,
        )
        .bind(projectId, runId, attachmentId),
    ),
  );
  if (results.some((result) => !result.success)) {
    throw new Error("Issue attachment metadata could not be removed");
  }
  return results.flatMap((result) =>
    (result.results ?? []).map((row) => (row as { object_key: string }).object_key)
  );
}

export async function issueAttachmentObjectKeysInUse(
  db: D1Database,
  objectKeys: string[],
) {
  if (objectKeys.length === 0) return new Set<string>();
  const placeholders = objectKeys.map(() => "?").join(",");
  const result = await db
    .prepare(
      `select object_key from briar_issue_attachments
       where object_key in (${placeholders})`,
    )
    .bind(...objectKeys)
    .all<{ object_key: string }>();
  return new Set((result.results ?? []).map((row) => row.object_key));
}

export async function updateIssueWithAttachmentMetadata(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    title: string;
    description: string | null;
    priority: number | null;
    assigneeUserId?: string | null;
    updatedAt: string;
    attachments: IssueAttachmentInput[];
    removedAttachmentIds: string[];
  },
) {
  const createdAt = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `update briar_hunt_runs
         set title = ?, issue_description = ?, priority = ?,
             assignee_user_id = case when ? = 1 then ? else assignee_user_id end,
             updated_at = ?
         where id = ? and project_id = ?
         returning *`,
      )
      .bind(
        input.title,
        input.description,
        input.priority,
        input.assigneeUserId === undefined ? 0 : 1,
        input.assigneeUserId ?? null,
        input.updatedAt,
        runId,
        projectId,
      ),
    ...input.attachments.map((attachment) =>
      db
        .prepare(
          `insert into briar_issue_attachments (
             id, run_id, project_id, object_key, filename, content_type,
             byte_size, created_at
           )
           select ?, run.id, run.project_id, ?, ?, ?, ?, ?
           from briar_hunt_runs run
           where run.id = ? and run.project_id = ?
           returning id`,
        )
        .bind(
          attachment.id,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          createdAt,
          runId,
          projectId,
        ),
    ),
    ...input.removedAttachmentIds.map((attachmentId) =>
      db
        .prepare(
          `delete from briar_issue_attachments
           where project_id = ? and run_id = ? and id = ?
             and exists (
               select 1 from briar_hunt_runs run
               where run.id = briar_issue_attachments.run_id
                 and run.project_id = briar_issue_attachments.project_id
             )
           returning object_key`,
        )
        .bind(projectId, runId, attachmentId),
    ),
  ];
  const results = await db.batch(statements);
  if (results.some((result) => !result.success)) {
    throw new Error("Issue and attachment metadata could not be updated");
  }
  const run = (results[0]?.results?.[0] as HuntRunRow | undefined) ?? null;
  if (!run) return null;
  const insertOffset = 1;
  const deleteOffset = insertOffset + input.attachments.length;
  if (
    results
      .slice(insertOffset, deleteOffset)
      .some((result) => (result.results?.length ?? 0) !== 1)
  ) {
    throw new Error("Issue attachment metadata could not be stored");
  }
  return {
    run,
    deletedObjectKeys: results.slice(deleteOffset).flatMap((result) =>
      (result.results ?? []).map(
        (row) => (row as { object_key: string }).object_key,
      )
    ),
  };
}

export async function listIssueAttachments(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  const query = runId
    ? `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ? and attachment.run_id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = attachment.run_id
             and run.project_id = attachment.project_id
         )
       order by created_at, id`
    : `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ?
         and attachment.run_id in (
           select run.id from briar_hunt_runs run
           where run.project_id = ?
           order by
             case when run.status in ('completed', 'cancelled') then 1 else 0 end,
             run.last_event_at desc
           limit 200
         )
       order by created_at, id`;
  const statement = db.prepare(query);
  const result = runId
    ? await statement.bind(projectId, runId).all<IssueAttachmentRow>()
    : await statement.bind(projectId, projectId).all<IssueAttachmentRow>();
  return result.results;
}

export async function listIssueAttachmentsByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const result = await db
    .prepare(
      `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ?
         and attachment.run_id in (select value from json_each(?))
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = attachment.run_id
             and run.project_id = attachment.project_id
         )
       order by created_at, id`,
    )
    .bind(projectId, JSON.stringify([...new Set(runIds)]))
    .all<IssueAttachmentRow>();
  return result.results;
}

export async function getIssueAttachment(
  db: D1Database,
  projectId: string,
  runId: string,
  attachmentId: string,
) {
  return db
    .prepare(
      `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ? and attachment.run_id = ?
         and attachment.id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = attachment.run_id
             and run.project_id = attachment.project_id
         )`,
    )
    .bind(projectId, runId, attachmentId)
    .first<IssueAttachmentRow>();
}

export async function rollbackNewAppIssue(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_hunt_runs
       where id = ? and project_id = ? and source = 'issue'
         and status = 'queued' and claim_attempts = 0
         and event_count = 1`,
    )
    .bind(runId, projectId)
    .run();
  return result.meta.changes > 0;
}

export async function claimNextQueuedHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    claimedBy: string;
    claimedAt: string;
    leaseExpiresAt: string;
    runId?: string;
    workerId?: string;
    workerDeviceId?: string;
    agentProvider?: ProjectAgentProvider;
    agentProviders?: ProjectAgentProvider[];
    detachedOnly?: boolean;
  },
) {
  const allowedProviders =
    input.agentProviders ??
    (input.agentProvider ? [input.agentProvider] : undefined);
  const executionId = crypto.randomUUID();
  const claimStatement = db
    .prepare(
      `update briar_hunt_runs
       set claim_token_hash = ?, claimed_by = ?, claimed_at = ?,
           lease_expires_at = ?, claim_attempts = claim_attempts + 1,
           last_execution_id = ?,
           worker_id = ?,
           status = case
             when status = 'queued' and workflow_stage is not null
               then 'running'
             else status
           end,
           stage = case
             when status = 'queued' and workflow_stage is not null then
               case
                 when workflow_stage in (
                   'analyzing', 'implementing', 'pr_open',
                   'staging_qa', 'production_qa'
                 ) then workflow_stage
                 else 'implementing'
               end
             else stage
           end,
           detail = case
             when status = 'queued' and workflow_stage is not null
               then '워커가 이전 작업 단계부터 이어받았습니다.'
             else detail
           end,
           paused_at = case
             when resume_requested_at is not null then null else paused_at end,
           updated_at = ?
       where id = (
         select id from briar_hunt_runs
         where project_id = ?
           and (
             status = 'queued'
             or (
               status = 'running' and paused_at is not null
               and resume_requested_at is not null
             )
           )
           and (lease_expires_at is null or lease_expires_at <= ?)
           and (? is null or id = ?)
           and not exists (
             select 1
             from briar_issue_dependencies dependency
             join briar_hunt_runs prerequisite
               on prerequisite.id = dependency.prerequisite_run_id
             where dependency.project_id = briar_hunt_runs.project_id
               and dependency.dependent_run_id = briar_hunt_runs.id
               and prerequisite.status != 'completed'
           )
           and (? = 0 or dispatched_at is not null)
           and (
             (? = 0 and dispatch_mode is null)
             or (? = 1 and dispatch_mode = 'any')
             or (
               ? = 1 and dispatch_mode = 'specific'
               and requested_worker_id = ?
             )
           )
           and (
             ? is null
             or not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = briar_hunt_runs.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1
               from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = briar_hunt_runs.project_id
                 and allowed.worker_id = ?
             )
           )
           and (
             ? = 0
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'codex'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'claude'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'grok'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'agy'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'opencode'
             )
           )
           and (
             ? is null or (
             (select count(*)
              from briar_hunt_runs active
              join briar_execution_workers holder
                on holder.id = active.worker_id
              where holder.device_id = ?
                and active.claim_token_hash is not null
                and active.lease_expires_at is not null
                and active.lease_expires_at > ?
                and active.status not in (
                  'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                ))
             +
             (select count(*)
              from briar_project_agent_task_jobs active_task
              join briar_execution_workers holder
                on holder.id = active_task.claimed_worker_id
              where holder.device_id = ?
                and active_task.status = 'running'
                and active_task.lease_expires_at > ?)
             ) < coalesce((
               select device.max_concurrent_sessions
               from briar_execution_worker_devices device
               where device.id = ?
             ), 0)
           )
         order by
           case when resume_requested_at is not null then 0 else 1 end,
           case when priority is null then 1 else 0 end,
           priority asc,
           coalesce(source_created_at, started_at) asc,
           run_number asc
         limit 1
       )
       returning *`,
    )
    .bind(
      input.claimTokenHash,
      input.claimedBy,
      input.claimedAt,
      input.leaseExpiresAt,
      executionId,
      input.workerId ?? null,
      input.claimedAt,
      projectId,
      input.claimedAt,
      input.runId ?? null,
      input.runId ?? null,
      input.detachedOnly ? 1 : 0,
      input.detachedOnly ? 1 : 0,
      input.detachedOnly ? 1 : 0,
      input.detachedOnly ? 1 : 0,
      input.workerId ?? null,
      input.workerId ?? null,
      input.workerId ?? null,
      allowedProviders ? 1 : 0,
      allowedProviders?.includes("codex") ? 1 : 0,
      allowedProviders?.includes("claude") ? 1 : 0,
      allowedProviders?.includes("grok") ? 1 : 0,
      allowedProviders?.includes("agy") ? 1 : 0,
      allowedProviders?.includes("opencode") ? 1 : 0,
      input.workerDeviceId ?? null,
      input.workerDeviceId ?? null,
      input.claimedAt,
      input.workerDeviceId ?? null,
      input.claimedAt,
      input.workerDeviceId ?? null,
    );
  const attemptStatement = db
    .prepare(
      `insert into briar_run_execution_attempts (
         id, organization_id, project_id, run_id, run_attempt, claim_attempt,
         worker_id, claimed_by, claimed_at, recorded_at
       )
       select ?, project.organization_id, run.project_id, run.id,
              run.current_attempt, run.claim_attempts, ?,
              run.claimed_by, run.claimed_at, ?
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where run.project_id = ? and run.last_execution_id = ?`,
    )
    .bind(
      executionId,
      input.workerId ?? null,
      input.claimedAt,
      projectId,
      executionId,
    );
  const [claimResult] = await db.batch([claimStatement, attemptStatement]);
  return (claimResult.results[0] as HuntRunRow | undefined) ?? null;
}

export async function assertQueuedHuntClaim(
  db: D1Database,
  projectId: string,
  input: Pick<HuntEventInput, "source" | "sourceKey">,
  claimTokenHash: string | null,
  observedAt: string,
) {
  const run = await db
    .prepare(
      `select stage, status, claim_token_hash, lease_expires_at, context_json,
              case when claim_token_hash = ? then 1 else 0 end as claim_token_valid
       from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(claimTokenHash ?? "", projectId, input.source, input.sourceKey)
    .first<{
      stage: DashboardStage;
      status: AutoHuntPersistedRunStatus;
      claim_token_hash: string | null;
      lease_expires_at: string | null;
      context_json: string | null;
      claim_token_valid: number;
    }>();
  if (!run) return;
  if (run.status !== "queued") {
    if (claimTokenHash && run.claim_token_valid !== 1) {
      throw new HuntClaimError("Issue processing claim token is no longer active");
    }
    return;
  }
  const context: unknown = run.context_json
    ? JSON.parse(run.context_json)
    : null;
  const appCreated =
    context !== null &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    (context as Record<string, unknown>).origin === "briar-app";
  if (!run.claim_token_hash) {
    if (claimTokenHash) {
      throw new HuntClaimError("Issue processing claim token is no longer active");
    }
    if (!appCreated) return;
  }
  if (
    run.claim_token_valid !== 1 ||
    !run.lease_expires_at ||
    run.lease_expires_at <= observedAt
  ) {
    throw new HuntClaimError(
      "Queued issue processing requires its active claim token",
    );
  }
}

export async function findProjectIdByAgentTokenHash(
  db: D1Database,
  agentTokenHash: string,
) {
  return await db
    .prepare(
      `select token.project_id
       from briar_project_agent_tokens token
       join briar_projects project on project.id = token.project_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = token.issued_to_user_id
       where token.token_hash = ?
       union all
       select id as project_id
       from briar_projects
       where agent_token_hash = ?
       limit 1`,
    )
    .bind(agentTokenHash, agentTokenHash)
    .first<string>("project_id");
}

export async function issueProjectAgentToken(
  db: D1Database,
  projectId: string,
  userId: string,
  agentTokenHash: string,
) {
  const result = await db
    .prepare(
      `insert into briar_project_agent_tokens (
         token_hash, project_id, issued_to_user_id, created_at
       )
       select ?, project.id, ?, ?
       from briar_projects project
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       where project.id = ?`,
    )
    .bind(
      agentTokenHash,
      userId,
      new Date().toISOString(),
      userId,
      projectId,
    )
    .run();
  return result.meta.changes > 0;
}

const digestRunId = async (
  projectId: string,
  source: AutoHuntSource,
  sourceKey: string,
) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${projectId}\u0000${source}\u0000${sourceKey}`),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const scopedRunKey = async (
  key: string,
  attempt: number,
  revision: number,
) => {
  if (attempt === 1 && revision === 1) return key;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  const fingerprint = [...digest.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const suffix = `:attempt-${attempt}:revision-${revision}:${fingerprint}`;
  return `${key.slice(0, 300 - suffix.length)}${suffix}`;
};

const scopedEvidenceKey = async (key: string, revision: number) => {
  if (revision === 1) return key;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  const fingerprint = [...digest.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const suffix = `:revision-${revision}:${fingerprint}`;
  return `${key.slice(0, 300 - suffix.length)}${suffix}`;
};

const loadStageRevisionRequirements = async (
  db: D1Database,
  run: HuntRunRow,
) => {
  const result = await db
    .prepare(
      `select workflow_stage, required_revision
       from briar_run_stage_revisions
       where run_id = ? and attempt = ?`,
    )
    .bind(run.id, run.current_attempt)
    .all<{ workflow_stage: string; required_revision: number }>();
  return new Map(
    result.results.map((item) => [
      item.workflow_stage,
      item.required_revision,
    ]),
  );
};

const sameEvent = (row: HuntEventRow, input: HuntEventInput) =>
  row.stage === input.stage &&
  row.status === input.status &&
  row.workflow_stage === input.workflowStage &&
  row.detail === input.detail &&
  row.actor === input.actor &&
  row.branch === input.branch &&
  row.commit_sha === input.commitSha &&
  row.qa_status === input.qaStatus &&
  row.tracker_issue_state === (input.tracker?.state ?? null) &&
  row.pull_request_urls === stableJson(input.pullRequestUrls) &&
  row.target_sha === input.targetSha &&
  row.occurred_at === input.occurredAt;

const loadRunForIdentity = async (
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) => {
  if (input.tracker?.issueId) {
    const byTracker = await db
      .prepare(
        `select * from briar_hunt_runs
         where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
         limit 1`,
      )
      .bind(projectId, input.tracker.provider, input.tracker.issueId)
      .first<HuntRunRow>();
    if (byTracker) return byTracker;
  }
  return await db
    .prepare(
      `select * from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(projectId, input.source, input.sourceKey)
    .first<HuntRunRow>();
};

const assertRunCompletionEligible = async (
  db: D1Database,
  projectId: string,
  run: HuntRunRow,
  resultSummary: string | null,
  trackerProvider: string | null,
  trackerState: string | null,
) => {
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  await assertWorkflowRunCompletion(db, projectId, run.id);
  const requiredStages = requiredWorkflowStages(workflow);
  const revisionRequirements = await loadStageRevisionRequirements(db, run);
  const requiredEvidence = workflow.stages.flatMap((stage) =>
    requiredStages.includes(stage.id)
      ? (stage.evidence ?? []).map((type) => ({ stage: stage.id, type }))
      : [],
  );
  if (requiredEvidence.length > 0) {
    const evidence = await db
      .prepare(
        `select workflow_stage, evidence_type, revision from briar_run_evidence
         where run_id = ? and attempt = ? and status in ('passed', 'skipped')`,
      )
      .bind(run.id, run.current_attempt)
      .all<{
        workflow_stage: string;
        evidence_type: string;
        revision: number;
      }>();
    const accepted = new Set(
      evidence.results
        .filter(
          (item) =>
            item.revision >=
            (revisionRequirements.get(item.workflow_stage) ?? 1),
        )
        .map((item) => `${item.workflow_stage}:${item.evidence_type}`),
    );
    const missingEvidence = requiredEvidence
      .filter((item) => !accepted.has(`${item.stage}:${item.type}`))
      .map((item) => `${item.stage}:${item.type}`);
    if (missingEvidence.length > 0) {
      throw new HuntTransitionError(
        `Run completion requires evidence: ${missingEvidence.join(", ")}`,
      );
    }
  }
  if (!resultSummary?.trim()) {
    throw new HuntTransitionError("Run completion requires a result summary");
  }
  const settings = await getProjectSettings(db, projectId);
  if (
    settings?.linear_enabled === 1 &&
    trackerProvider === "linear" &&
    !isTerminalTrackerState(trackerState)
  ) {
    throw new HuntTransitionError(
      "Run completion requires a terminal Linear issue",
    );
  }
};

const assertCompletionEligible = async (
  db: D1Database,
  projectId: string,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (input.status !== "completed") return;
  if (!run) throw new HuntTransitionError("Run does not exist");
  await assertRunCompletionEligible(
    db,
    projectId,
    run,
    input.resultSummary ?? run.result_summary,
    input.tracker?.provider ?? run.tracker_provider,
    input.tracker?.state ?? run.tracker_issue_state,
  );
};

const assertStageTransition = async (
  _db: D1Database,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (!run || input.occurredAt < run.last_event_at) {
    return;
  }
  if (
    input.status === run.status &&
    (input.status !== "running" || input.workflowStage === run.workflow_stage)
  ) {
    return;
  }
  if (run.status === "completed" || run.status === "cancelled") {
    throw new HuntTransitionError(`Run is already ${run.status}`);
  }
  if (["blocked", "failed", "cancelled"].includes(input.status ?? "")) return;
  if (input.status !== "running" || !input.workflowStage) return;
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const nextRank = workflow.stages.findIndex(
    (stage) => stage.id === input.workflowStage,
  );
  if (nextRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.workflowStage}`,
    );
  }
  const currentRank = run.workflow_stage
    ? workflow.stages.findIndex((stage) => stage.id === run.workflow_stage)
    : -1;
  if (run.paused_at && nextRank !== currentRank) {
    throw new HuntTransitionError(
      "Run is paused; resume it before recording a later workflow stage",
    );
  }
  const floorRank = currentRank;
  if (nextRank < floorRank) {
    throw new HuntTransitionError(
      `Workflow cannot regress from rank ${floorRank} to ${nextRank}`,
    );
  }
};

const statusForDashboardStage = (
  stage: DashboardStage,
): AutoHuntPersistedRunStatus => {
  if (stage === "queued") return "queued";
  if (["blocked", "failed", "completed", "cancelled"].includes(stage)) {
    return stage as AutoHuntPersistedRunStatus;
  }
  return "running";
};

const workflowStageForDashboardStage = (
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

const dashboardStageFor = (
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

export async function recordHuntEvent(
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) {
  const normalizedInput = {
    ...input,
    status: input.status ?? statusForDashboardStage(input.stage),
    workflowStage:
      input.workflowStage === undefined
        ? workflowStageForDashboardStage(input.stage)
        : input.workflowStage,
    pullRequestUrls: normalizedUrls(input.pullRequestUrls),
  };
  normalizedInput.stage = dashboardStageFor(
    normalizedInput.status,
    normalizedInput.workflowStage,
  );
  const existingRun = await loadRunForIdentity(db, projectId, normalizedInput);
  const baseWorkflowSnapshot = existingRun
    ? parseWorkflow(existingRun.workflow_snapshot_json)
    : await workflowSnapshotForRun(
        db,
        projectId,
        normalizedInput.createdByUserId,
        [],
        normalizedInput.fullAuto === true,
      );
  const issueCheckpointSnapshot = existingRun
    ? (JSON.parse(
        existingRun.issue_checkpoints_json || "[]",
      ) as AutoHuntWorkflowCheckpoint[])
    : normalizedInput.fullAuto
      ? []
      : additionalWorkflowCheckpoints(
          baseWorkflowSnapshot,
          normalizedInput.issueCheckpoints ?? [],
        );
  const workflowSnapshot = existingRun
    ? baseWorkflowSnapshot
    : workflowWithAdditionalCheckpoints(
        baseWorkflowSnapshot,
        issueCheckpointSnapshot,
      );
  if (!existingRun && isRepositoryWorkflowPending(workflowSnapshot)) {
    throw new HuntTransitionError(
      "Repository workflow has not been generated for this project",
    );
  }
  if (
    normalizedInput.status === "running" &&
    (!normalizedInput.workflowStage ||
      !workflowSnapshot.stages.some(
        (stage) => stage.id === normalizedInput.workflowStage,
      ))
  ) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${normalizedInput.workflowStage ?? "none"}`,
    );
  }
  const eventAttempt = existingRun?.current_attempt ?? 1;
  const eventRevision = existingRun?.current_revision ?? 1;
  const storedEventKey = await scopedRunKey(
    normalizedInput.eventKey,
    eventAttempt,
    eventRevision,
  );
  await assertStageTransition(db, existingRun, normalizedInput);
  await assertCompletionEligible(db, projectId, existingRun, normalizedInput);
  if (existingRun?.paused_at && normalizedInput.status === "completed") {
    throw new HuntTransitionError(
      "Run is paused; resume it before completing the workflow",
    );
  }

  if (existingRun) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(existingRun.id, storedEventKey)
      .first<HuntEventRow>();
    if (existingEvent) {
      if (!sameEvent(existingEvent, normalizedInput)) {
        throw new EventKeyConflictError();
      }
      if (
        normalizedInput.status === "running" &&
        normalizedInput.workflowStage === "pr_open"
      ) {
        await attemptGithubMergeAutoResume(db, projectId, existingRun.id);
      }
      return existingRun.id;
    }
  }

  const runId =
    existingRun?.id ??
    (await digestRunId(
      projectId,
      normalizedInput.source,
      normalizedInput.sourceKey,
    ));
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const completedAt = ["completed", "cancelled"].includes(
    normalizedInput.status,
  )
    ? normalizedInput.occurredAt
    : null;
  const mergedPullRequestUrls = normalizedUrls([
    ...parseUrls(existingRun?.pull_request_urls),
    ...normalizedInput.pullRequestUrls,
  ]);
  const qaStatus = normalizedInput.qaStatus;
  const stagingQaStatus =
    normalizedInput.stage === "staging_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const productionQaStatus =
    normalizedInput.stage === "production_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
           detail, priority,
           assignee_user_id, created_by_user_id,
           repository, branch, commit_sha, tracker_provider,
           tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
           tracker_issue_state, issue_description, result_summary,
           structured_result_json,
           pull_request_urls, target_sha, source_created_at,
           staging_qa_status, production_qa_status, staging_qa_detail,
           production_qa_detail, context_json, started_at, completed_at,
            last_event_at, created_at, updated_at,
            preferred_agent_provider, preferred_agent_model, preferred_agent_effort
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id, source, source_key) do nothing`,
      )
      .bind(
        runId,
        projectId,
        normalizedInput.source,
        normalizedInput.sourceKey,
        normalizedInput.title,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        stableJson(workflowSnapshot),
        stableJson(issueCheckpointSnapshot),
        normalizedInput.detail,
        normalizedInput.priority,
        normalizedInput.assigneeUserId ?? null,
        normalizedInput.createdByUserId ?? null,
        normalizedInput.repository,
        normalizedInput.branch,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.issueDescription,
        normalizedInput.resultSummary,
        normalizedInput.structuredResult
          ? stableJson(normalizedInput.structuredResult)
          : null,
        stableJson(mergedPullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        stagingQaStatus,
        productionQaStatus,
        normalizedInput.stagingQaDetail,
        normalizedInput.productionQaDetail,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        completedAt,
        normalizedInput.occurredAt,
        recordedAt,
        recordedAt,
        normalizedInput.preferredAgentProvider ?? null,
        normalizedInput.preferredAgentModel ?? null,
        normalizedInput.preferredAgentEffort ?? null,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
           detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        runId,
        storedEventKey,
        eventAttempt,
        eventRevision,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        normalizedInput.detail,
        normalizedInput.actor,
        normalizedInput.branch,
        normalizedInput.commitSha,
        qaStatus,
        normalizedInput.tracker?.state ?? null,
        stableJson(normalizedInput.pullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.occurredAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set title = case when ? >= last_event_at then ? else title end,
             stage = case
               when ? < last_event_at then stage
               when status = 'completed' and ? <> 'completed' then stage
               else ?
             end,
             status = case
               when ? < last_event_at then status
               when status = 'completed' and ? <> 'completed' then status
               else ?
             end,
             workflow_stage = case
               when ? >= last_event_at then coalesce(?, workflow_stage)
               else workflow_stage
             end,
             detail = case when ? >= last_event_at then ? else detail end,
             priority = case when ? >= last_event_at then coalesce(?, priority) else priority end,
             repository = case when ? >= last_event_at then ? else repository end,
             branch = case when ? >= last_event_at then coalesce(?, branch) else branch end,
             commit_sha = case when ? >= last_event_at then coalesce(?, commit_sha) else commit_sha end,
             tracker_provider = coalesce(?, tracker_provider),
             tracker_issue_id = coalesce(?, tracker_issue_id),
             tracker_issue_identifier = coalesce(?, tracker_issue_identifier),
             tracker_issue_url = coalesce(?, tracker_issue_url),
             tracker_issue_state = case when ? >= last_event_at then coalesce(?, tracker_issue_state) else tracker_issue_state end,
             issue_description = case when ? >= last_event_at then coalesce(?, issue_description) else issue_description end,
             result_summary = case when ? >= last_event_at then coalesce(?, result_summary) else result_summary end,
             structured_result_json = case when ? >= last_event_at then coalesce(?, structured_result_json) else structured_result_json end,
             pull_request_urls = ?,
             target_sha = case when ? >= last_event_at then coalesce(?, target_sha) else target_sha end,
             source_created_at = coalesce(source_created_at, ?),
             staging_qa_status = case
               when ? >= last_event_at and ? = 'staging_qa' and ? = 'pending' then 'pending'
               else staging_qa_status
             end,
             production_qa_status = case
               when ? >= last_event_at and ? = 'production_qa' and ? = 'pending' then 'pending'
               else production_qa_status
             end,
             staging_qa_detail = case when ? >= last_event_at then coalesce(?, staging_qa_detail) else staging_qa_detail end,
             production_qa_detail = case when ? >= last_event_at then coalesce(?, production_qa_detail) else production_qa_detail end,
             context_json = case when ? >= last_event_at then coalesce(?, context_json) else context_json end,
             resume_requested_at = case
               when ? >= last_event_at and paused_at is null then null
               else resume_requested_at
             end,
             completed_at = case
               when ? < last_event_at then completed_at
               when ? in ('completed', 'cancelled') then ?
               when status = 'completed' and ? <> 'completed' then completed_at
               else null
             end,
             last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ?
           and current_attempt = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        normalizedInput.occurredAt,
        normalizedInput.title,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.stage,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.workflowStage,
        normalizedInput.occurredAt,
        normalizedInput.detail,
        normalizedInput.occurredAt,
        normalizedInput.priority,
        normalizedInput.occurredAt,
        normalizedInput.repository,
        normalizedInput.occurredAt,
        normalizedInput.branch,
        normalizedInput.occurredAt,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.occurredAt,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.occurredAt,
        normalizedInput.issueDescription,
        normalizedInput.occurredAt,
        normalizedInput.resultSummary,
        normalizedInput.occurredAt,
        normalizedInput.structuredResult
          ? stableJson(normalizedInput.structuredResult)
          : null,
        stableJson(mergedPullRequestUrls),
        normalizedInput.occurredAt,
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stagingQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.productionQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        recordedAt,
        runId,
        eventAttempt,
        eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(runId, storedEventKey)
      .first<HuntEventRow>();
    if (!existingEvent || !sameEvent(existingEvent, normalizedInput)) {
      throw new EventKeyConflictError();
    }
  }

  // Reconcile signed merges after the event is durable. Retries also take this
  // path through the duplicate-event branch if reconciliation fails transiently.
  if (
    normalizedInput.status === "running" &&
    normalizedInput.workflowStage === "pr_open"
  ) {
    await attemptGithubMergeAutoResume(db, projectId, runId);
  }

  return runId;
}

const githubPullRequestStateRank: Record<GithubPullRequestState, number> = {
  unknown: 0,
  open: 1,
  closed: 2,
  merged: 3,
};

const githubPullRequestUrlTarget = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    return null;
  }
  const match = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/u,
  );
  return match
    ? {
        repository: `${match[1]}/${match[2]}`.toLowerCase(),
        number: Number(match[3]),
      }
    : null;
};

type GithubPullRequestEvidenceIdentity = {
  repositoryId: number;
  repository: string;
  pullRequestId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
};

const githubPullRequestEvidenceIdentity = (
  metadata: Record<string, unknown> | null,
  target: { repository: string; number: number },
): GithubPullRequestEvidenceIdentity | null => {
  const value = metadata?.githubPullRequest;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identity = value as Record<string, unknown>;
  const repository = typeof identity.repository === "string"
    ? identity.repository.trim().toLowerCase()
    : "";
  const repositoryId = identity.repositoryId;
  const pullRequestId = identity.pullRequestId;
  const pullRequestNodeId = identity.pullRequestNodeId;
  const pullRequestNumber = identity.pullRequestNumber;
  if (
    !Number.isSafeInteger(repositoryId) || Number(repositoryId) <= 0 ||
    !Number.isSafeInteger(pullRequestId) || Number(pullRequestId) <= 0 ||
    !Number.isSafeInteger(pullRequestNumber) || Number(pullRequestNumber) <= 0 ||
    repository !== target.repository ||
    pullRequestNumber !== target.number ||
    typeof pullRequestNodeId !== "string" ||
    pullRequestNodeId.trim().length < 1 ||
    pullRequestNodeId.trim().length > 200
  ) return null;
  return {
    repositoryId: Number(repositoryId),
    repository,
    pullRequestId: Number(pullRequestId),
    pullRequestNodeId: pullRequestNodeId.trim(),
    pullRequestNumber: Number(pullRequestNumber),
  };
};

const githubPullRequestSyncDetail = (input: GithubPullRequestSyncInput) => {
  if (input.state === "merged") {
    return `GitHub PR #${input.pullRequestNumber}이(가) merge되었습니다.`;
  }
  if (input.state === "closed") {
    return `GitHub PR #${input.pullRequestNumber}이(가) merge 없이 닫혔습니다.`;
  }
  return input.draft
    ? `GitHub PR #${input.pullRequestNumber}이(가) draft 상태입니다.`
    : `GitHub PR #${input.pullRequestNumber}이(가) 열려 있습니다.`;
};

async function githubPullRequestLinksForEvent(
  db: D1Database,
  input: Pick<
    GithubPullRequestSyncInput,
    | "repositoryId"
    | "repository"
    | "pullRequestId"
    | "pullRequestNodeId"
    | "pullRequestNumber"
    | "state"
    | "mergedAt"
    | "providerUpdatedAt"
    | "linkedIssues"
    | "organizationId"
  >,
) {
  const linkedIssuesJson = stableJson(input.linkedIssues);
  const result = await db
    .prepare(
      `select link.*
       from briar_run_pull_requests link
       join briar_hunt_runs run
         on run.id = link.run_id and run.project_id = link.project_id
       join briar_projects project on project.id = link.project_id
       join briar_github_pull_requests snapshot
         on snapshot.repository_id = link.repository_id
        and snapshot.pull_request_number = link.pull_request_number
        and snapshot.pull_request_id = link.pull_request_id
        and snapshot.pull_request_node_id = link.pull_request_node_id
       where unixepoch(snapshot.provider_updated_at) >=
           unixepoch(link.revision_started_at)
         and unixepoch(?) >= unixepoch(link.revision_started_at)
         and (? is null or project.organization_id = ?)
         and link.repository_id = ? and link.pull_request_number = ?
         and link.pull_request_id = ? and link.pull_request_node_id = ?
         and (
           link.last_delivery_id is not null
           or (
             link.repository = ?
             and (? is null or ? = 'merged')
           )
         )
         and (? <> 'merged' or ? is not null)
         and (
           ? <> 'merged'
           or exists (
             select 1 from json_each(?) issue
             where json_extract(issue.value, '$.projectId') = link.project_id
               and json_extract(issue.value, '$.runId') = link.run_id
           )
         )
         and (
           ? <> 'merged'
           or (
             snapshot.updated_at >= link.created_at
             and unixepoch(snapshot.merged_at) >= unixepoch(link.created_at)
           )
         )`,
    )
    .bind(
      input.providerUpdatedAt,
      input.organizationId ?? null,
      input.organizationId ?? null,
      input.repositoryId,
      input.pullRequestNumber,
      input.pullRequestId,
      input.pullRequestNodeId,
      input.repository,
      input.mergedAt,
      input.state,
      input.state,
      input.mergedAt,
      input.state,
      linkedIssuesJson,
      input.state,
    )
    .all<RunPullRequestRow>();
  return result.results;
}

async function recordGithubPullRequestSyncEvent(
  db: D1Database,
  projectId: string,
  runId: string,
  input: GithubPullRequestSyncInput,
) {
  const eventId = crypto.randomUUID();
  const eventKey = `github:pull_request:${input.deliveryId}`;
  const recordedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, current_attempt, current_revision, stage, status,
                workflow_stage, ?, ?, branch, commit_sha, null,
                tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        githubPullRequestSyncDetail(input),
        input.actor.slice(0, 128),
        input.providerUpdatedAt,
        recordedAt,
        runId,
        projectId,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set last_event_at = max(last_event_at, ?),
             updated_at = max(updated_at, ?)
         where id = ? and project_id = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        input.providerUpdatedAt,
        input.observedAt,
        runId,
        projectId,
        eventId,
      ),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

async function hasUnboundGithubPullRequestEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
  attempt: number,
  revision: number,
) {
  const row = await db
    .prepare(
      `select 1 as unbound
       from briar_run_evidence evidence
       where evidence.project_id = ? and evidence.run_id = ?
         and evidence.attempt = ? and evidence.revision = ?
         and evidence.evidence_type = 'pull_request'
         and evidence.status in ('pending', 'passed')
         and not exists (
           select 1 from briar_run_pull_requests link
           where link.run_id = evidence.run_id
             and link.attempt = evidence.attempt
             and link.revision = evidence.revision
             and link.repository_id = cast(json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.repositoryId'
             ) as integer)
             and link.pull_request_id = cast(json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.pullRequestId'
             ) as integer)
             and link.pull_request_node_id = json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.pullRequestNodeId'
             )
             and link.pull_request_number = cast(json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.pullRequestNumber'
             ) as integer)
         )
       limit 1`,
    )
    .bind(projectId, runId, attempt, revision)
    .first<{ unbound: number }>();
  return Boolean(row);
}

async function hasBlockedGithubConnectionForRun(
  db: D1Database,
  projectId: string,
  runId: string,
  attempt: number,
  revision: number,
) {
  const row = await db
    .prepare(
      `select 1 as blocked
       from briar_run_pull_requests link
       join briar_projects project on project.id = link.project_id
       where link.project_id = ? and link.run_id = ?
         and link.attempt = ? and link.revision = ?
         and link.installation_id is not null
         and exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = link.installation_id
         )
         and not exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = link.installation_id
             and connection.status = 'connected'
             and connection.organization_id = project.organization_id
         )
       limit 1`,
    )
    .bind(projectId, runId, attempt, revision)
    .first<{ blocked: number }>();
  return Boolean(row);
}

export async function resumeRunAfterGithubMerge(
  db: D1Database,
  projectId: string,
  runId: string,
  actor = "github-webhook",
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return { outcome: "not_found" as const };
  if (run.resume_requested_at) {
    return { outcome: "already_resumed" as const };
  }
  if (
    await hasBlockedGithubConnectionForRun(
      db,
      projectId,
      run.id,
      run.current_attempt,
      run.current_revision,
    )
  ) {
    return { outcome: "ineligible" as const };
  }
  if (
    await hasUnboundGithubPullRequestEvidence(
      db,
      projectId,
      run.id,
      run.current_attempt,
      run.current_revision,
    )
  ) {
    return { outcome: "not_ready" as const };
  }
  const result = await db
    .prepare(
      `select * from briar_run_pull_requests
       where project_id = ? and run_id = ? and attempt = ? and revision = ?
       order by coalesce(merged_at, provider_updated_at, updated_at) desc, url`,
    )
    .bind(
      projectId,
      run.id,
      run.current_attempt,
      run.current_revision,
    )
    .all<RunPullRequestRow>();
  const links = result.results;
  if (
    links.length === 0 ||
    links.some((link) => link.state !== "merged" || !link.last_delivery_id)
  ) {
    return { outcome: "not_ready" as const };
  }
  const latest = links[0]!;
  const approvedAt = latest.merged_at ?? latest.provider_updated_at ?? latest.updated_at;
  const requestId = `github:${latest.last_delivery_id}`;
  if (!run.waiting_checkpoint_key) {
    return { outcome: "ineligible" as const };
  }
  const checkpoint = await db
    .prepare(
      `select checkpoint_key, attempt, revision
       from briar_run_checkpoint_progress
       where run_id = ? and attempt = ? and revision = ?
         and checkpoint_key = ? and stage_id = 'pr_open'
         and position = 'after' and state = 'waiting'`,
    )
    .bind(
      run.id,
      run.current_attempt,
      run.current_revision,
      run.waiting_checkpoint_key,
    )
    .first<Pick<
      WorkflowCheckpointProgressRow,
      "checkpoint_key" | "attempt" | "revision"
    >>();
  if (!checkpoint) return { outcome: "ineligible" as const };
  const resumed = await resumeWorkflowCheckpoint(db, projectId, {
    runId: run.id,
    checkpointKey: checkpoint.checkpoint_key,
    attempt: checkpoint.attempt,
    revision: checkpoint.revision,
    requestId,
    actor,
    approvedAt,
    requireAllGithubPullRequestsMerged: true,
  });
  return {
    outcome:
      resumed.outcome === "approved"
        ? ("resumed" as const)
        : resumed.outcome === "already_approved"
          ? ("already_resumed" as const)
          : resumed.outcome,
  };
}

export async function attemptGithubMergeAutoResume(
  db: D1Database,
  projectId: string,
  runId: string,
  actor = "github-webhook",
) {
  try {
    return await resumeRunAfterGithubMerge(db, projectId, runId, actor);
  } catch (error) {
    console.error(JSON.stringify({
      message: "GitHub merge auto-resume deferred",
      projectId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return { outcome: "deferred" as const };
  }
}

export async function reconcileGithubMergedRuns(
  db: D1Database,
  limit = 100,
) {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const candidates = await db
    .prepare(
      `select run.project_id, run.id as run_id
       from briar_hunt_runs run
       where run.status = 'running'
         and run.paused_at is not null
         and run.resume_requested_at is null
         and run.workflow_stage = 'pr_open'
         and exists (
           select 1 from briar_run_pull_requests link
           where link.project_id = run.project_id and link.run_id = run.id
             and link.attempt = run.current_attempt
             and link.revision = run.current_revision
         )
         and not exists (
           select 1 from briar_run_pull_requests link
           where link.project_id = run.project_id and link.run_id = run.id
             and link.attempt = run.current_attempt
             and link.revision = run.current_revision
             and (link.state <> 'merged' or link.last_delivery_id is null)
         )
         and not exists (
           select 1
           from briar_run_pull_requests link
           join briar_projects project on project.id = link.project_id
           where link.project_id = run.project_id and link.run_id = run.id
             and link.attempt = run.current_attempt
             and link.revision = run.current_revision
             and link.installation_id is not null
             and exists (
               select 1 from briar_github_connections connection
               where connection.installation_id = link.installation_id
             )
             and not exists (
               select 1 from briar_github_connections connection
               where connection.installation_id = link.installation_id
                 and connection.status = 'connected'
                 and connection.organization_id = project.organization_id
             )
         )
         and not exists (
           select 1 from briar_run_evidence evidence
           where evidence.project_id = run.project_id
             and evidence.run_id = run.id
             and evidence.attempt = run.current_attempt
             and evidence.revision = run.current_revision
             and evidence.evidence_type = 'pull_request'
             and evidence.status in ('pending', 'passed')
             and not exists (
               select 1 from briar_run_pull_requests link
               where link.run_id = evidence.run_id
                 and link.attempt = evidence.attempt
                 and link.revision = evidence.revision
                 and link.repository_id = cast(json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.repositoryId'
                 ) as integer)
                 and link.pull_request_id = cast(json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.pullRequestId'
                 ) as integer)
                 and link.pull_request_node_id = json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.pullRequestNodeId'
                 )
                 and link.pull_request_number = cast(json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.pullRequestNumber'
                 ) as integer)
             )
         )
         and (
           run.waiting_checkpoint_key is null
           or exists (
             select 1 from briar_run_checkpoint_progress checkpoint
             where checkpoint.run_id = run.id
               and checkpoint.attempt = run.current_attempt
               and checkpoint.revision = run.current_revision
               and checkpoint.checkpoint_key = run.waiting_checkpoint_key
               and checkpoint.stage_id = 'pr_open'
               and checkpoint.position = 'after'
               and checkpoint.state = 'waiting'
           )
         )
       order by run.paused_at, run.id
       limit ?`,
    )
    .bind(boundedLimit)
    .all<{ project_id: string; run_id: string }>();
  const outcomes: string[] = [];
  for (const candidate of candidates.results) {
    const result = await attemptGithubMergeAutoResume(
      db,
      candidate.project_id,
      candidate.run_id,
    );
    outcomes.push(result.outcome);
  }
  return {
    examined: candidates.results.length,
    resumed: outcomes.filter((outcome) => outcome === "resumed").length,
    alreadyResumed: outcomes.filter((outcome) => outcome === "already_resumed")
      .length,
    deferred: outcomes.filter((outcome) => outcome === "deferred").length,
  };
}

export async function syncGithubPullRequest(
  db: D1Database,
  rawInput: GithubPullRequestSyncInput,
) {
  const repository = rawInput.repository.toLowerCase();
  const input = {
    ...rawInput,
    repository,
    url: `https://github.com/${repository}/pull/${rawInput.pullRequestNumber}`,
  };
  await db
    .prepare(
      `insert into briar_github_pull_requests (
         repository_id, pull_request_number, installation_id, repository,
         pull_request_id, pull_request_node_id, url, state, draft,
         head_sha, base_sha, merge_commit_sha, opened_at, closed_at, merged_at,
         provider_updated_at, last_delivery_id, briar_issue_links_json,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(repository_id, pull_request_number) do update set
         installation_id = excluded.installation_id,
         repository = excluded.repository,
         pull_request_id = excluded.pull_request_id,
         pull_request_node_id = excluded.pull_request_node_id,
         url = excluded.url,
         state = excluded.state,
         draft = excluded.draft,
         head_sha = excluded.head_sha,
         base_sha = excluded.base_sha,
         merge_commit_sha = excluded.merge_commit_sha,
         opened_at = excluded.opened_at,
         closed_at = excluded.closed_at,
         merged_at = excluded.merged_at,
         provider_updated_at = excluded.provider_updated_at,
         last_delivery_id = excluded.last_delivery_id,
         briar_issue_links_json = excluded.briar_issue_links_json,
         updated_at = excluded.updated_at
       where briar_github_pull_requests.state <> 'merged'
         and (
           excluded.state = 'merged'
           or briar_github_pull_requests.provider_updated_at <
             excluded.provider_updated_at
           or (
             briar_github_pull_requests.provider_updated_at =
               excluded.provider_updated_at
             and case briar_github_pull_requests.state
                   when 'open' then 1 when 'closed' then 2 when 'merged' then 3
                 end <=
                 case excluded.state
                   when 'open' then 1 when 'closed' then 2 when 'merged' then 3
                 end
           )
         )`,
    )
    .bind(
      input.repositoryId,
      input.pullRequestNumber,
      input.installationId,
      input.repository,
      input.pullRequestId,
      input.pullRequestNodeId,
      input.url,
      input.state,
      input.draft ? 1 : 0,
      input.headSha,
      input.baseSha,
      input.mergeCommitSha,
      input.openedAt,
      input.closedAt,
      input.mergedAt,
      input.providerUpdatedAt,
      input.deliveryId,
      stableJson(input.linkedIssues),
      input.observedAt,
      input.observedAt,
    )
    .run();
  // PR-body Briar links are deliberately not used as authorization. The
  // active worker's pull_request evidence is the durable run/PR binding;
  // repository and numeric provider identity then protect later renames.
  const links = await githubPullRequestLinksForEvent(db, input);
  const updatedRunIds = new Set<string>();
  const matchedCurrentRuns = new Map<string, string>();
  for (const link of links) {
    const run = await getHuntRunForProject(db, link.project_id, link.run_id);
    if (!run) continue;
    if (
      link.attempt === run.current_attempt &&
      link.revision === run.current_revision
    ) {
      matchedCurrentRuns.set(link.run_id, link.project_id);
    }
    const result = await db
      .prepare(
        `update briar_run_pull_requests
         set installation_id = ?, repository_id = ?, repository = ?, url = ?,
             pull_request_id = ?, pull_request_node_id = ?,
             pull_request_number = ?, state = ?, draft = ?,
             head_sha = ?, base_sha = ?, merge_commit_sha = ?,
             opened_at = ?, closed_at = ?, merged_at = ?,
             provider_updated_at = ?, last_delivery_id = ?, updated_at = ?
         where run_id = ? and project_id = ? and attempt = ? and revision = ?
           and repository_id = ? and pull_request_number = ?
           and state <> 'merged'
           and (
             ? = 'merged'
             or provider_updated_at is null
             or provider_updated_at < ?
             or (
               provider_updated_at = ?
               and case state
                     when 'unknown' then 0 when 'open' then 1
                     when 'closed' then 2 when 'merged' then 3
                   end <= ?
             )
           )`,
      )
      .bind(
        input.installationId,
        input.repositoryId,
        input.repository,
        input.url,
        input.pullRequestId,
        input.pullRequestNodeId,
        input.pullRequestNumber,
        input.state,
        input.draft ? 1 : 0,
        input.headSha,
        input.baseSha,
        input.mergeCommitSha,
        input.openedAt,
        input.closedAt,
        input.mergedAt,
        input.providerUpdatedAt,
        input.deliveryId,
        input.observedAt,
        link.run_id,
        link.project_id,
        link.attempt,
        link.revision,
        link.repository_id,
        link.pull_request_number,
        input.state,
        input.providerUpdatedAt,
        input.providerUpdatedAt,
        githubPullRequestStateRank[input.state],
      )
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      updatedRunIds.add(link.run_id);
    }
  }

  for (const runId of updatedRunIds) {
    const projectId = matchedCurrentRuns.get(runId);
    if (projectId) {
      await recordGithubPullRequestSyncEvent(db, projectId, runId, input);
    }
  }

  const resumeOutcomes: Array<{ runId: string; outcome: string }> = [];
  if (input.state === "merged") {
    for (const [runId, projectId] of matchedCurrentRuns) {
      const resumed = await attemptGithubMergeAutoResume(
        db,
        projectId,
        runId,
        input.actor,
      );
      resumeOutcomes.push({ runId, outcome: resumed.outcome });
    }
  }
  return {
    matchedRunCount: new Set(links.map((link) => link.run_id)).size,
    updatedRunCount: updatedRunIds.size,
    resumedRunCount: resumeOutcomes.filter(
      (result) => result.outcome === "resumed",
    ).length,
    resumeOutcomes,
  };
}

export async function recordRunEvidence(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    evidenceKey: string;
    stage: string;
    type: string;
    status: RunEvidenceRow["status"];
    detail: string | null;
    command: string | null;
    url: string | null;
    metadata: Record<string, unknown> | null;
    actor: string;
    observedAt: string;
  },
  fence?: { claimTokenHash: string; authenticatedAt: string },
) {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return null;
  const runFenceSql = `
    and run.current_attempt = ? and run.current_revision = ?
    and run.status = ? and run.workflow_stage is ?
    and run.paused_at is ? and run.resume_requested_at is ?
    ${
    fence
      ? "and run.claim_token_hash = ? and run.lease_expires_at > ?"
      : "and run.claim_token_hash is ? and run.lease_expires_at is ?"
  }`;
  const runFenceBindings = (checkedAt: string) => [
    run.current_attempt,
    run.current_revision,
    run.status,
    run.workflow_stage ?? null,
    run.paused_at ?? null,
    run.resume_requested_at ?? null,
    fence?.claimTokenHash ?? run.claim_token_hash ?? null,
    fence ? checkedAt : run.lease_expires_at ?? null,
  ];
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const evidenceStageRank = workflow.stages.findIndex(
    (stage) => stage.id === input.stage,
  );
  if (evidenceStageRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.stage}`,
    );
  }
  if (run.paused_at && input.stage !== run.workflow_stage) {
    throw new HuntTransitionError(
      "Run is paused; resume it before recording later-stage evidence",
    );
  }
  let verifiedGithubPullRequest: {
    target: { repository: string; number: number };
    identity: GithubPullRequestEvidenceIdentity;
  } | null = null;
  if (
    input.type === "pull_request" &&
    ["pending", "passed"].includes(input.status)
  ) {
    const target = input.url ? githubPullRequestUrlTarget(input.url) : null;
    const settings = await db
      .prepare(
        `select github_repository
         from briar_project_settings
         where project_id = ?`,
      )
      .bind(projectId)
      .first<{ github_repository: string | null }>();
    const configuredRepository = settings?.github_repository
      ?.trim()
      .toLowerCase();
    if (configuredRepository) {
      if (!target || configuredRepository !== target.repository) {
        throw new HuntTransitionError(
          `Pull request evidence must use the project's configured GitHub repository: ${configuredRepository}`,
        );
      }
      const identity = githubPullRequestEvidenceIdentity(
        input.metadata,
        target,
      );
      if (!identity) {
        throw new HuntTransitionError(
          "GitHub pull request evidence for the configured repository requires immutable repository and PR identity metadata; update and use the bundled Briar CLI",
        );
      }
      verifiedGithubPullRequest = { target, identity };
    }
  }
  const metadataJson = input.metadata ? stableJson(input.metadata) : null;
  const storedEvidenceKey = await scopedEvidenceKey(
    input.evidenceKey,
    run.current_revision,
  );
  const existing = await db
    .prepare(
      `select * from briar_run_evidence
       where run_id = ? and attempt = ? and evidence_key = ?`,
    )
    .bind(run.id, run.current_attempt, storedEvidenceKey)
    .first<RunEvidenceRow>();
  const revisionStartedAtSql = `coalesce((
    select min(max(event.recorded_at, event.occurred_at))
    from briar_hunt_events event
    where event.run_id = run.id
      and event.attempt = run.current_attempt
      and event.revision = run.current_revision
  ), run.created_at)`;
  const linkPullRequest = async (
    url: string | null,
    recordedAt: string,
    associationStartedAt: string,
  ) => {
    if (
      input.type !== "pull_request" ||
      !url ||
      !["pending", "passed"].includes(input.status)
    ) {
      return;
    }
    const checkedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `update briar_hunt_runs as run
         set pull_request_urls = json_insert(pull_request_urls, '$[#]', ?),
             updated_at = max(updated_at, ?)
         where run.id = ? and run.project_id = ?
           and not exists (
             select 1 from json_each(run.pull_request_urls)
             where value = ?
           )
           ${runFenceSql}`,
      ).bind(
        url,
        recordedAt,
        run.id,
        projectId,
        url,
        ...runFenceBindings(checkedAt),
      ),
    ];
    if (verifiedGithubPullRequest) {
      const { target, identity } = verifiedGithubPullRequest;
      const canonicalUrl =
        `https://github.com/${target.repository}/pull/${target.number}`;
      statements.push(db.prepare(
        `insert into briar_run_pull_requests (
           project_id, run_id, attempt, revision, revision_started_at, url,
           installation_id, repository_id, repository,
           pull_request_id, pull_request_node_id, pull_request_number,
           state, draft, head_sha, base_sha, merge_commit_sha,
           opened_at, closed_at, merged_at, provider_updated_at,
           last_delivery_id, created_at, updated_at
         )
         select run.project_id, run.id, run.current_attempt,
                run.current_revision,
                ${revisionStartedAtSql},
                ?, snapshot.installation_id,
                ?, ?, ?, ?, ?,
                coalesce(snapshot.state, 'unknown'), snapshot.draft,
                snapshot.head_sha, snapshot.base_sha,
                snapshot.merge_commit_sha, snapshot.opened_at,
                snapshot.closed_at, snapshot.merged_at,
                snapshot.provider_updated_at, snapshot.last_delivery_id,
                ?, ?
         from briar_hunt_runs run
         left join briar_github_pull_requests snapshot
           on snapshot.repository_id = ?
          and snapshot.pull_request_number = ?
          and snapshot.pull_request_id = ?
          and snapshot.pull_request_node_id = ?
         and snapshot.repository = ?
         and unixepoch(snapshot.provider_updated_at) >=
            unixepoch(${revisionStartedAtSql})
          and (
            snapshot.installation_id is null
            or not exists (
              select 1 from briar_github_connections connection
              where connection.installation_id = snapshot.installation_id
            )
            or exists (
              select 1
              from briar_github_connections connection
              join briar_projects project
                on project.organization_id = connection.organization_id
              where connection.installation_id = snapshot.installation_id
                and connection.status = 'connected'
                and project.id = run.project_id
            )
          )
          and (
            (
              snapshot.state in ('open', 'closed')
              and snapshot.merged_at is null
            )
            or (
              snapshot.state = 'merged'
              and snapshot.merged_at is not null
              and snapshot.updated_at >= ?
              and unixepoch(snapshot.merged_at) >= unixepoch(?)
              and exists (
                select 1 from json_each(snapshot.briar_issue_links_json) issue
                where json_extract(issue.value, '$.projectId') = run.project_id
                  and json_extract(issue.value, '$.runId') = run.id
              )
            )
          )
         where run.id = ? and run.project_id = ?
           ${runFenceSql}
         on conflict(
           run_id, attempt, revision, repository_id, pull_request_number
         ) do update set
           url = excluded.url,
           installation_id = excluded.installation_id,
           repository = excluded.repository,
           pull_request_id = excluded.pull_request_id,
           pull_request_node_id = excluded.pull_request_node_id,
           state = excluded.state,
           draft = excluded.draft,
           head_sha = excluded.head_sha,
           base_sha = excluded.base_sha,
           merge_commit_sha = excluded.merge_commit_sha,
           opened_at = excluded.opened_at,
           closed_at = excluded.closed_at,
           merged_at = excluded.merged_at,
           provider_updated_at = excluded.provider_updated_at,
           last_delivery_id = excluded.last_delivery_id,
           updated_at = excluded.updated_at
         where briar_run_pull_requests.state = 'unknown'
           and excluded.last_delivery_id is not null`,
      ).bind(
        canonicalUrl,
        identity.repositoryId,
        identity.repository,
        identity.pullRequestId,
        identity.pullRequestNodeId,
        identity.pullRequestNumber,
        associationStartedAt,
        recordedAt,
        identity.repositoryId,
        identity.pullRequestNumber,
        identity.pullRequestId,
        identity.pullRequestNodeId,
        identity.repository,
        associationStartedAt,
        associationStartedAt,
        run.id,
        projectId,
        ...runFenceBindings(checkedAt),
      ));
    }
    await db.batch(statements);
    const fencedRun = await db
      .prepare(
        `select 1 as active from briar_hunt_runs run
         where run.id = ? and run.project_id = ?
           ${runFenceSql}`,
      )
      .bind(
        run.id,
        projectId,
        ...runFenceBindings(new Date().toISOString()),
      )
      .first<{ active: number }>();
    if (!fencedRun) {
      throw new HuntTransitionError(
        "Run claim or revision changed while recording pull request evidence",
      );
    }
    if (verifiedGithubPullRequest) {
      const { identity } = verifiedGithubPullRequest;
      const linked = await db
        .prepare(
          `select 1 as linked from briar_run_pull_requests
           where project_id = ? and run_id = ? and attempt = ? and revision = ?
             and repository_id = ? and pull_request_number = ?`,
        )
        .bind(
          projectId,
          run.id,
          run.current_attempt,
          run.current_revision,
          identity.repositoryId,
          identity.pullRequestNumber,
        )
        .first<{ linked: number }>();
      if (!linked) {
        throw new HuntTransitionError(
          "Run claim or revision changed while recording pull request evidence",
        );
      }
    }
  };
  if (existing) {
    const same =
      existing.workflow_stage === input.stage &&
      existing.evidence_type === input.type &&
      existing.status === input.status &&
      existing.detail === input.detail &&
      existing.command === input.command &&
      existing.url === input.url &&
      existing.metadata_json === metadataJson &&
      existing.actor === input.actor &&
      existing.observed_at === input.observedAt;
    if (!same) throw new EventKeyConflictError();
    await linkPullRequest(
      existing.url,
      existing.recorded_at,
      existing.github_association_started_at ?? existing.recorded_at,
    );
    return existing;
  }
  const recordedAt = new Date().toISOString();
  const githubAssociationStartedAt = input.type === "pull_request" &&
      input.url && ["pending", "passed"].includes(input.status)
    ? fence?.authenticatedAt ?? recordedAt
    : null;
  const evidence: RunEvidenceRow = {
    id: crypto.randomUUID(),
    run_id: run.id,
    attempt: run.current_attempt,
    revision: run.current_revision,
    evidence_key: storedEvidenceKey,
    workflow_stage: input.stage,
    evidence_type: input.type,
    status: input.status,
    detail: input.detail,
    command: input.command,
    url: input.url,
    metadata_json: metadataJson,
    actor: input.actor,
    observed_at: input.observedAt,
    recorded_at: recordedAt,
    github_association_started_at: githubAssociationStartedAt,
  };
  const inserted = await db
    .prepare(
      `insert into briar_run_evidence (
         id, project_id, run_id, attempt, revision, evidence_key, workflow_stage,
         evidence_type, status, detail, command, url, metadata_json,
         actor, observed_at, recorded_at, github_association_started_at
       )
       select ?, run.project_id, run.id, run.current_attempt,
              run.current_revision, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ?
         ${runFenceSql}`,
    )
    .bind(
      evidence.id,
      evidence.evidence_key,
      evidence.workflow_stage,
      evidence.evidence_type,
      evidence.status,
      evidence.detail,
      evidence.command,
      evidence.url,
      evidence.metadata_json,
      evidence.actor,
      evidence.observed_at,
      evidence.recorded_at,
      evidence.github_association_started_at,
      run.id,
      projectId,
      ...runFenceBindings(evidence.recorded_at),
    )
    .run();
  if ((inserted.meta.changes ?? 0) === 0) {
    throw new HuntTransitionError(
      "Run claim or revision changed while recording evidence",
    );
  }
  await linkPullRequest(
    evidence.url,
    evidence.recorded_at,
    evidence.github_association_started_at ?? evidence.recorded_at,
  );
  return evidence;
}

export async function listRunEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select * from briar_run_evidence
       where project_id = ? and run_id = ? and attempt = ?
       order by observed_at, recorded_at, id`,
    )
    .bind(projectId, runId, run.current_attempt)
    .all<RunEvidenceRow>();
  return result.results ?? [];
}

export async function listRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  if (!runId) {
    const result = await db
      .prepare(
        `select image.*
         from briar_run_evidence_images image
         join briar_hunt_runs run
           on run.id = image.run_id and run.project_id = image.project_id
         where image.project_id = ?
         order by image.run_id, image.evidence_id, image.position, image.id`,
      )
      .bind(projectId)
      .all<RunEvidenceImageRow>();
    return result.results ?? [];
  }
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select image.*
       from briar_run_evidence_images image
       join briar_run_evidence evidence on evidence.id = image.evidence_id
       where image.project_id = ? and image.run_id = ?
         and evidence.attempt = ?
       order by evidence.observed_at, evidence.recorded_at, evidence.id,
                image.position, image.id`,
    )
    .bind(projectId, runId, run.current_attempt)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function listAllRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select * from briar_run_evidence_images
       where project_id = ? and run_id = ?
       order by evidence_id, position, id`,
    )
    .bind(projectId, runId)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function listEvidenceImagesForEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
  evidenceId: string,
) {
  const result = await db
    .prepare(
      `select image.*
       from briar_run_evidence_images image
       join briar_hunt_runs run
         on run.id = image.run_id and run.project_id = image.project_id
       where image.project_id = ? and image.run_id = ? and image.evidence_id = ?
       order by image.position, image.id`,
    )
    .bind(projectId, runId, evidenceId)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function createRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId: string,
  evidenceId: string,
  images: RunEvidenceImageInput[],
) {
  const evidence = await db
    .prepare(
      `select id from briar_run_evidence
       where id = ? and project_id = ? and run_id = ?`,
    )
    .bind(evidenceId, projectId, runId)
    .first<{ id: string }>();
  if (!evidence) return null;
  if (images.length === 0) return [];
  const createdAt = new Date().toISOString();
  await db.batch(
    images.map((image) =>
      db
        .prepare(
          `insert into briar_run_evidence_images (
             id, project_id, run_id, evidence_id, object_key, filename,
             content_type, byte_size, sha256, position, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          image.id,
          projectId,
          runId,
          evidenceId,
          image.object_key,
          image.filename,
          image.content_type,
          image.byte_size,
          image.sha256,
          image.position,
          createdAt,
        ),
    ),
  );
  return listEvidenceImagesForEvidence(db, projectId, runId, evidenceId);
}

export async function getRunEvidenceImage(
  db: D1Database,
  projectId: string,
  runId: string,
  imageId: string,
) {
  return db
    .prepare(
      `select image.*
       from briar_run_evidence_images image
       join briar_hunt_runs run
         on run.id = image.run_id and run.project_id = image.project_id
       where image.id = ? and image.project_id = ? and image.run_id = ?`,
    )
    .bind(imageId, projectId, runId)
    .first<RunEvidenceImageRow>();
}

export async function listRunStageRevisions(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const requirements = await loadStageRevisionRequirements(db, run);
  return {
    attempt: run.current_attempt,
    revision: run.current_revision,
    requirements,
  };
}

export type HuntReworkOutcome =
  | "reworked"
  | "already_reworked"
  | "not_found";

export async function reworkHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    workflowStage: AutoHuntWorkflowStageId;
    requestId: string;
    actor: string;
    reason: string;
    occurredAt: string;
    checkpoint?: {
      key: string;
      attempt: number;
      revision: number;
    };
    completed?: {
      expectedAttempt: number;
      expectedRevision: number;
    };
  },
): Promise<{
  outcome: HuntReworkOutcome;
  attempt: number | null;
  revision: number | null;
  workflowStage: AutoHuntWorkflowStageId | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return {
      outcome: "not_found",
      attempt: null,
      revision: null,
      workflowStage: null,
    };
  }

  const eventKey = `workflow:rework:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select attempt, revision, workflow_stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<
      Pick<HuntEventRow, "attempt" | "revision" | "workflow_stage">
    >();
  if (existingEvent) {
    return {
      outcome: "already_reworked",
      attempt: existingEvent.attempt,
      revision: existingEvent.revision,
      workflowStage: existingEvent.workflow_stage,
    };
  }

  if (
    input.checkpoint &&
    (!run.paused_at ||
      run.waiting_checkpoint_key !== input.checkpoint.key ||
      run.current_attempt !== input.checkpoint.attempt ||
      (run.waiting_checkpoint_revision ?? run.current_revision) !==
        input.checkpoint.revision)
  ) {
    throw new HuntTransitionError(
      "The paused checkpoint changed before rework could be requested",
    );
  }

  const completedRework = input.completed !== undefined;
  if (completedRework) {
    if (
      run.status !== "completed" ||
      run.current_attempt !== input.completed?.expectedAttempt ||
      run.current_revision !== input.completed?.expectedRevision
    ) {
      throw new HuntTransitionError(
        "The completed run changed before rework could be accepted",
      );
    }
    if (await isChannelApprovedIssue(db, run)) {
      throw new HuntTransitionError(
        "Approved issue execution requires fresh approval before rework",
      );
    }
  } else if (run.status !== "running" || !run.workflow_stage) {
    throw new HuntTransitionError("Only a running workflow stage can be reworked");
  }
  const isPaused = Boolean(run.paused_at);
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const currentRank = completedRework
    ? workflow.stages.length - 1
    : workflow.stages.findIndex((stage) => stage.id === run.workflow_stage);
  const targetRank = workflow.stages.findIndex(
    (stage) => stage.id === input.workflowStage,
  );
  if (targetRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.workflowStage}`,
    );
  }
  if (
    currentRank < 0 ||
    targetRank > currentRank ||
    (!completedRework && !isPaused && targetRank === currentRank)
  ) {
    throw new HuntTransitionError(
      `Rework target ${input.workflowStage} must not follow ${run.workflow_stage}`,
    );
  }

  const nextRevision = run.current_revision + 1;
  const targetStatus: AutoHuntPersistedRunStatus = "queued";
  const targetDashboardStage: DashboardStage = "queued";
  const claimReset = `claim_token_hash = null, claimed_by = null,
             claimed_at = null, lease_expires_at = null,`;
  const sourceStatus = completedRework ? "completed" : "running";
  const recordedAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const invalidatedStages = workflow.stages.slice(targetRank).map((stage) => stage.id);
  const results = await db.batch([
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = ?, workflow_stage = ?,
             detail = ?, current_revision = ?, commit_sha = null,
             target_sha = null, result_summary = null,
             structured_result_json = null,
             staging_qa_status = null, production_qa_status = null,
             staging_qa_detail = null, production_qa_detail = null,
             ${claimReset}
             paused_at = null, resume_requested_at = null,
             completed_at = null, last_event_at = ?, updated_at = ?
         where id = ? and project_id = ? and status = ?
           and current_attempt = ? and current_revision = ?
           and last_event_at = ?`,
      )
      .bind(
        targetDashboardStage,
        targetStatus,
        input.workflowStage,
        input.reason,
        nextRevision,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        sourceStatus,
        run.current_attempt,
        run.current_revision,
        run.last_event_at,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, current_attempt, current_revision, ?, ?,
                ?, ?, ?, branch, null, null, tracker_issue_state,
                pull_request_urls, null, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        targetDashboardStage,
        targetStatus,
        input.workflowStage,
        input.reason,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        nextRevision,
        input.occurredAt,
      ),
    ...invalidatedStages.map((stage) =>
      db
        .prepare(
          `insert into briar_run_stage_revisions (
             run_id, attempt, workflow_stage, required_revision
           )
           select id, current_attempt, ?, current_revision
           from briar_hunt_runs
           where id = ? and project_id = ? and current_attempt = ?
             and current_revision = ? and last_event_at = ?
           on conflict(run_id, attempt, workflow_stage)
           do update set required_revision = excluded.required_revision`,
        )
        .bind(
          stage,
          run.id,
          projectId,
          run.current_attempt,
          nextRevision,
          input.occurredAt,
        ),
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select attempt, revision, workflow_stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<
        Pick<HuntEventRow, "attempt" | "revision" | "workflow_stage">
      >();
    if (duplicate) {
      return {
        outcome: "already_reworked",
        attempt: duplicate.attempt,
        revision: duplicate.revision,
        workflowStage: duplicate.workflow_stage,
      };
    }
    throw new HuntTransitionError(
      "Issue processing run changed while rework was being recorded",
    );
  }

  await db
    .prepare(
      `update briar_run_checkpoint_progress
       set state = 'invalidated'
       where run_id = ? and attempt = ? and revision = ?
         and state in ('pending', 'waiting', 'approved')`,
    )
    .bind(run.id, run.current_attempt, run.current_revision)
    .run();
  await db
    .prepare(
      `update briar_hunt_runs
       set waiting_checkpoint_key = null,
           waiting_checkpoint_revision = null
       where id = ? and project_id = ?`,
    )
    .bind(run.id, projectId)
    .run();

  return {
    outcome: "reworked",
    attempt: run.current_attempt,
    revision: nextRevision,
    workflowStage: input.workflowStage,
  };
}

export type HuntRecoveryAction = "retry" | "cancel";
export type HuntRecoveryOutcome =
  | "retried"
  | "cancelled"
  | "already_retried"
  | "already_cancelled"
  | "ineligible"
  | "not_found";

export async function recoverHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    action: HuntRecoveryAction;
    requestId: string;
    actor: string;
    reason: string | null;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntRecoveryOutcome;
  attempt: number | null;
  stage: DashboardStage | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return { outcome: "not_found", attempt: null, stage: null };

  const eventKey = `admin:${input.action}:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select attempt, stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<Pick<HuntEventRow, "attempt" | "stage">>();
  if (existingEvent) {
    return {
      outcome:
        input.action === "retry" ? "already_retried" : "already_cancelled",
      attempt: existingEvent.attempt,
      stage: existingEvent.stage,
    };
  }

  const eligible =
    input.action === "retry"
      ? (["blocked", "failed"] as AutoHuntRunStatus[]).includes(run.status)
      : !(["completed", "cancelled"] as AutoHuntRunStatus[]).includes(run.status);
  if (!eligible) {
    return {
      outcome: "ineligible",
      attempt: run.current_attempt,
      stage: run.stage,
    };
  }

  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const nextAttempt =
    input.action === "retry" ? run.current_attempt + 1 : run.current_attempt;
  const nextStage: DashboardStage =
    input.action === "retry" ? "queued" : "cancelled";
  const detail =
    input.reason ??
    (input.action === "retry"
      ? `이슈 처리 ${nextAttempt}차 시도를 요청했습니다.`
      : "사용자가 이슈 처리 작업을 취소했습니다.");

  const update =
    input.action === "retry"
      ? db
          .prepare(
            `update briar_hunt_runs
             set stage = 'queued', status = 'queued', workflow_stage = null,
                 detail = ?, current_attempt = ?, current_revision = 1,
                 branch = null, commit_sha = null, result_summary = null,
                 structured_result_json = null,
                 execution_metrics_json = null,
                 pull_request_urls = '[]',
                 target_sha = null, staging_qa_status = null,
                 production_qa_status = null, staging_qa_detail = null,
                 production_qa_detail = null, claim_token_hash = null,
                 claimed_by = null, claimed_at = null, lease_expires_at = null,
                 paused_at = null, resume_requested_at = null,
                 completed_at = null, last_event_at = ?, updated_at = ?
             where id = ? and project_id = ? and status in ('blocked', 'failed')
               and current_attempt = ? and last_event_at = ?`,
          )
          .bind(
            detail,
            nextAttempt,
            input.occurredAt,
            recordedAt,
            run.id,
            projectId,
            run.current_attempt,
            run.last_event_at,
          )
      : db
          .prepare(
            `update briar_hunt_runs
             set stage = 'cancelled', status = 'cancelled', detail = ?,
                 claim_token_hash = null,
                 claimed_by = null, claimed_at = null, lease_expires_at = null,
                 paused_at = null, resume_requested_at = null,
                 completed_at = ?, last_event_at = ?, updated_at = ?
             where id = ? and project_id = ?
               and status not in ('completed', 'cancelled')
               and current_attempt = ? and last_event_at = ?`,
          )
          .bind(
            detail,
            input.occurredAt,
            input.occurredAt,
            recordedAt,
            run.id,
            projectId,
            run.current_attempt,
            run.last_event_at,
          );

  const results = await db.batch([
    update,
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, stage, status, workflow_stage,
           detail, actor, branch,
           commit_sha, qa_status, tracker_issue_state, pull_request_urls,
           target_sha, occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, null, ?, ?, null, null, null,
                tracker_issue_state, '[]', null, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and status = ? and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        nextAttempt,
        nextStage,
        nextStage,
        detail,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        nextAttempt,
        nextStage,
        input.occurredAt,
      ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select attempt, stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<Pick<HuntEventRow, "attempt" | "stage">>();
    if (duplicate) {
      return {
        outcome:
          input.action === "retry" ? "already_retried" : "already_cancelled",
        attempt: duplicate.attempt,
        stage: duplicate.stage,
      };
    }
    const current = await getHuntRunForProject(db, projectId, run.id);
    return {
      outcome: "ineligible",
      attempt: current?.current_attempt ?? null,
      stage: current?.stage ?? null,
    };
  }

  return {
    outcome: input.action === "retry" ? "retried" : "cancelled",
    attempt: nextAttempt,
    stage: nextStage,
  };
}

export type HuntMoveOutcome =
  "moved" | "unchanged" | "already_moved" | "not_found";

export async function moveHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    status: AutoHuntPersistedRunStatus;
    workflowStage: AutoHuntWorkflowStageId | null;
    requestId: string;
    actor: string;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntMoveOutcome;
  status: AutoHuntRunStatus | null;
  workflowStage: AutoHuntWorkflowStageId | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return { outcome: "not_found", status: null, workflowStage: null };
  }

  const workflow = parseWorkflow(run.workflow_snapshot_json);
  if (input.status === "running") {
    const targetRank = workflow.stages.findIndex(
      (stage) => stage.id === input.workflowStage,
    );
    if (
      !input.workflowStage ||
      targetRank < 0
    ) {
      throw new HuntTransitionError(
        `Workflow stage is not configured for this run: ${input.workflowStage ?? "none"}`,
      );
    }
    if (run.paused_at) {
      throw new HuntTransitionError(
        "Run is paused; resume it before moving to another workflow stage",
      );
    }
  } else if (input.workflowStage !== null) {
    throw new HuntTransitionError(
      "Only running status can select a workflow stage",
    );
  }

  const targetWorkflowStage =
    input.status === "backlog" || input.status === "queued"
      ? null
      : input.status === "running"
        ? input.workflowStage
        : run.workflow_stage;
  const eventKey = `admin:move:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select status, workflow_stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
  if (existingEvent) {
    return {
      outcome: "already_moved",
      status: existingEvent.status,
      workflowStage: existingEvent.workflow_stage,
    };
  }
  if (
    run.status === input.status &&
    (input.status !== "running" || run.workflow_stage === targetWorkflowStage)
  ) {
    return {
      outcome: "unchanged",
      status: run.status,
      workflowStage: run.workflow_stage,
    };
  }
  if (
    ["completed", "cancelled"].includes(run.status) &&
    !["completed", "cancelled"].includes(input.status) &&
    await isChannelApprovedIssue(db, run)
  ) {
    throw new HuntTransitionError(
      "Approved issue execution requires fresh approval before reactivation",
    );
  }

  if (run.paused_at && input.status === "completed") {
    throw new HuntTransitionError(
      "Run is paused; resume it before completing the workflow",
    );
  }
  // Manual board/list moves are an operator override. They must not apply the
  // agent completion gate (required stages, evidence, result summary, Linear).
  // That gate still applies to `recordHuntEvent` / `briar run complete`, which
  // is the path workers use. Applying it to drag-and-drop left a raw English
  // error banner on the issue list when `merged:merge_commit` (or other
  // evidence) was missing.

  const targetStage = dashboardStageFor(input.status, targetWorkflowStage);
  const currentRank = run.workflow_stage
    ? workflow.stages.findIndex((stage) => stage.id === run.workflow_stage)
    : -1;
  const targetRank = targetWorkflowStage
    ? workflow.stages.findIndex((stage) => stage.id === targetWorkflowStage)
    : -1;
  const isRegression =
    input.status === "running" &&
    currentRank >= 0 &&
    targetRank >= 0 &&
    targetRank < currentRank;
  const targetLabel =
    input.status === "running"
      ? workflow.stages.find((stage) => stage.id === targetWorkflowStage)?.label
      : {
          backlog: "백로그",
          queued: "대기",
          blocked: "차단",
          failed: "실패",
          completed: "완료",
          cancelled: "취소",
        }[input.status];
  const detail = `사용자가 작업을 ${targetLabel ?? input.status} 상태로 이동했습니다.`;
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const targetAttempt =
    input.status === "queued" ? run.current_attempt + 1 : run.current_attempt;
  const targetRevision =
    input.status === "queued"
      ? 1
      : isRegression
        ? run.current_revision + 1
        : run.current_revision;
  const invalidatedStages = isRegression
    ? workflow.stages.slice(targetRank).map((stage) => stage.id)
    : [];
  const completedAt = ["completed", "cancelled"].includes(input.status)
    ? input.occurredAt
    : null;

  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
           detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
           pull_request_urls, target_sha, occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, ?, ?, ?, ?, branch, commit_sha,
                null, tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        targetAttempt,
        targetRevision,
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = ?, workflow_stage = ?, detail = ?,
             current_attempt = ?, current_revision = ?,
             commit_sha = case when ? then null else commit_sha end,
             target_sha = case when ? then null else target_sha end,
             result_summary = case when ? then null else result_summary end,
             structured_result_json = case when ? then null else structured_result_json end,
             staging_qa_status = case when ? then null else staging_qa_status end,
             production_qa_status = case when ? then null else production_qa_status end,
             staging_qa_detail = case when ? then null else staging_qa_detail end,
             production_qa_detail = case when ? then null else production_qa_detail end,
             claim_token_hash = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, paused_at = null,
             resume_requested_at = null, completed_at = ?, last_event_at = ?,
             updated_at = ?
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        targetAttempt,
        targetRevision,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        completedAt,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
        eventId,
      ),
    ...invalidatedStages.map((stage) =>
      db
        .prepare(
          `insert into briar_run_stage_revisions (
             run_id, attempt, workflow_stage, required_revision
           )
           select id, current_attempt, ?, current_revision
           from briar_hunt_runs
           where id = ? and project_id = ? and current_attempt = ?
             and current_revision = ? and last_event_at = ?
           on conflict(run_id, attempt, workflow_stage)
           do update set required_revision = excluded.required_revision`,
        )
        .bind(
          stage,
          run.id,
          projectId,
          targetAttempt,
          targetRevision,
          input.occurredAt,
        ),
    ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select status, workflow_stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
    if (duplicate) {
      return {
        outcome: "already_moved",
        status: duplicate.status,
        workflowStage: duplicate.workflow_stage,
      };
    }
    throw new HuntTransitionError(
      "Issue processing run changed while its status was being moved",
    );
  }

  return {
    outcome: "moved",
    status: input.status,
    workflowStage: targetWorkflowStage,
  };
}

export type LinearImportRunInput = {
  sourceKey: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: AutoHuntPersistedRunStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  tracker: {
    provider: string;
    issueId: string;
    identifier: string | null;
    url: string | null;
    state: string | null;
  };
  sourceCreatedAt: string | null;
};

/**
 * One-time admin import of external tracker issues. Bypasses completion
 * eligibility so historical Linear issues can land directly as completed.
 */
export async function importLinearHuntRuns(
  db: D1Database,
  projectId: string,
  repository: string,
  inputs: LinearImportRunInput[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  const settings = await getProjectSettings(db, projectId);
  const workflowSnapshot = parseWorkflow(settings?.workflow_json);
  if (isRepositoryWorkflowPending(workflowSnapshot)) {
    throw new HuntTransitionError(
      "Repository workflow has not been generated for this project",
    );
  }
  const workflowStageIds = new Set(
    workflowSnapshot.stages.map((stage) => stage.id),
  );

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of inputs) {
    try {
      const title = raw.title.trim().slice(0, 300); // absolute DB ceiling
      if (!title) {
        failed += 1;
        continue;
      }
      const sourceKey = raw.sourceKey.trim().slice(0, 200);
      if (!sourceKey) {
        failed += 1;
        continue;
      }

      const existingBySource = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and source = 'issue' and source_key = ?
           limit 1`,
        )
        .bind(projectId, sourceKey)
        .first<{ id: string }>();
      if (existingBySource) {
        skipped += 1;
        continue;
      }

      const existingByTracker = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
           limit 1`,
        )
        .bind(projectId, raw.tracker.provider, raw.tracker.issueId)
        .first<{ id: string }>();
      if (existingByTracker) {
        skipped += 1;
        continue;
      }

      let status = raw.status;
      let workflowStage = status === "running" ? raw.workflowStage : null;
      if (
        status === "running" &&
        (!workflowStage || !workflowStageIds.has(workflowStage))
      ) {
        workflowStage = workflowSnapshot.stages[0]?.id ?? null;
        if (!workflowStage) {
          status = "queued";
          workflowStage = null;
        }
      }

      const stage = dashboardStageFor(status, workflowStage);
      const runId = await digestRunId(projectId, "issue", sourceKey);
      const eventId = crypto.randomUUID();
      const recordedAt = new Date().toISOString();
      const occurredAt = raw.sourceCreatedAt ?? recordedAt;
      const completedAt = ["completed", "cancelled"].includes(status)
        ? occurredAt
        : null;
      const detail =
        status === "queued"
          ? "Linear에서 가져온 이슈가 처리를 기다리고 있습니다."
          : `Linear에서 가져왔으며 ${status} 상태로 설정되었습니다.`;
      const resultSummary =
        status === "completed" ? "Imported from Linear as completed." : null;
      const priority =
        raw.priority != null && raw.priority >= 1 && raw.priority <= 4
          ? raw.priority
          : null;

      const results = await db.batch([
        db
          .prepare(
            `insert into briar_hunt_runs (
               id, project_id, source, source_key, title, stage, status,
               workflow_stage, workflow_snapshot_json, detail, priority,
               repository, branch, commit_sha, tracker_provider,
               tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
               tracker_issue_state, issue_description, result_summary,
               structured_result_json,
               pull_request_urls, target_sha, source_created_at,
               staging_qa_status, production_qa_status, staging_qa_detail,
               production_qa_detail, context_json, started_at, completed_at,
               last_event_at, created_at, updated_at
             ) values (?, ?, 'issue', ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?, ?, ?, ?, ?, null, '[]', null, ?, null, null, null, null, ?, ?, ?, ?, ?, ?)
             on conflict(project_id, source, source_key) do nothing`,
          )
          .bind(
            runId,
            projectId,
            sourceKey,
            title,
            stage,
            status,
            workflowStage,
            stableJson(workflowSnapshot),
            detail,
            priority,
            repository,
            raw.tracker.provider,
            raw.tracker.issueId,
            raw.tracker.identifier,
            raw.tracker.url,
            raw.tracker.state,
            raw.description?.slice(0, 100_000) ?? null,
            resultSummary,
            raw.sourceCreatedAt,
            stableJson({
              origin: "linear-import",
              linearIssueId: raw.tracker.issueId,
            }),
            occurredAt,
            completedAt,
            occurredAt,
            recordedAt,
            recordedAt,
          ),
        db
          .prepare(
            `insert into briar_hunt_events (
               id, run_id, event_key, attempt, stage, status, workflow_stage,
               detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
               pull_request_urls, target_sha, occurred_at, recorded_at
             ) values (?, ?, ?, 1, ?, ?, ?, ?, 'briar-linear-import', null, null, null, ?, '[]', null, ?, ?)
             on conflict(run_id, event_key) do nothing`,
          )
          .bind(
            eventId,
            runId,
            `${sourceKey}:import`,
            stage,
            status,
            workflowStage,
            detail,
            raw.tracker.state,
            occurredAt,
            recordedAt,
          ),
      ]);

      if ((results[0]?.meta.changes ?? 0) === 0) {
        skipped += 1;
      } else {
        imported += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { imported, skipped, failed };
}

export async function getHuntRunForProject(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  return db
    .prepare(`select * from briar_hunt_runs where id = ? and project_id = ?`)
    .bind(runId, projectId)
    .first<HuntRunRow>();
}

export async function updateIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    title: string;
    description: string | null;
    priority: number | null;
    assigneeUserId?: string | null;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_hunt_runs
       set title = ?, issue_description = ?, priority = ?,
           assignee_user_id = case when ? = 1 then ? else assignee_user_id end,
           updated_at = ?
       where id = ? and project_id = ?
       returning *`,
    )
    .bind(
      input.title,
      input.description,
      input.priority,
      input.assigneeUserId === undefined ? 0 : 1,
      input.assigneeUserId ?? null,
      input.updatedAt,
      runId,
      projectId,
    )
    .first<HuntRunRow>();
}

export async function completeIssueResultReview(
  db: D1Database,
  projectId: string,
  runId: string,
  reviewerUserId: string,
  completedAt: string,
) {
  await db
    .prepare(
      `insert into briar_issue_result_reviews (
         run_id, reviewer_user_id, completed_at
       )
       select run.id, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ?
       on conflict (run_id, reviewer_user_id) do nothing`,
    )
    .bind(reviewerUserId, completedAt, runId, projectId)
    .run();

  return db
    .prepare(
      `select review.run_id, user.id as user_id, user.name, user.username,
              user.image, review.completed_at
       from briar_issue_result_reviews review
       join briar_hunt_runs run on run.id = review.run_id
       join "user" user on user.id = review.reviewer_user_id
       where review.run_id = ? and review.reviewer_user_id = ?
         and run.project_id = ?`,
    )
    .bind(runId, reviewerUserId, projectId)
    .first<IssueResultReviewRow>();
}

export async function updateIssueExecutionPreferences(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    provider: ProjectAgentProvider | null;
    model: string | null;
    effort: ModelEffort | null;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_hunt_runs
       set preferred_agent_provider = ?,
           preferred_agent_model = ?,
           preferred_agent_effort = ?,
           updated_at = ?
       where id = ? and project_id = ?
       returning *`,
    )
    .bind(
      input.provider,
      input.model,
      input.effort,
      input.updatedAt,
      runId,
      projectId,
    )
    .first<HuntRunRow>();
}

const runIsFullAuto = (run: Pick<HuntRunRow, "context_json">) => {
  if (!run.context_json) return false;
  try {
    const context: unknown = JSON.parse(run.context_json);
    return Boolean(
      context &&
        typeof context === "object" &&
        !Array.isArray(context) &&
        (context as Record<string, unknown>).fullAuto === true,
    );
  } catch {
    return false;
  }
};

export async function updateIssueCheckpoints(
  db: D1Database,
  projectId: string,
  runId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
  updatedAt: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return "not_found" as const;
  if (runIsFullAuto(run)) return "ineligible" as const;
  if (
    !["backlog", "queued"].includes(run.status) ||
    run.claim_token_hash ||
    run.claimed_at
  ) {
    return "ineligible" as const;
  }

  const currentWorkflow = normalizeAutoHuntWorkflow(
    JSON.parse(run.workflow_snapshot_json),
  );
  const previousIssueCheckpoints = JSON.parse(
    run.issue_checkpoints_json || "[]",
  ) as AutoHuntWorkflowCheckpoint[];
  const previousBoundaries = new Set(
    previousIssueCheckpoints.map(
      (checkpoint) => `${checkpoint.stage}:${checkpoint.position}`,
    ),
  );
  const baseWorkflow = normalizeAutoHuntWorkflow({
    ...currentWorkflow,
    execution: {
      checkpoints: currentWorkflow.execution.checkpoints.filter(
        (checkpoint) =>
          !previousBoundaries.has(`${checkpoint.stage}:${checkpoint.position}`),
      ),
    },
  });
  const normalizedCheckpoints = additionalWorkflowCheckpoints(
    baseWorkflow,
    checkpoints,
  );
  const nextWorkflow = workflowWithAdditionalCheckpoints(
    baseWorkflow,
    normalizedCheckpoints,
  );
  const result = await db
    .prepare(
      `update briar_hunt_runs
       set workflow_snapshot_json = ?, issue_checkpoints_json = ?, updated_at = ?
       where id = ? and project_id = ?
         and workflow_snapshot_json = ?
         and status in ('backlog', 'queued')
         and claim_token_hash is null
         and claimed_at is null`,
    )
    .bind(
      stableJson(nextWorkflow),
      stableJson(normalizedCheckpoints),
      updatedAt,
      runId,
      projectId,
      run.workflow_snapshot_json,
    )
    .run();
  return (result.meta.changes ?? 0) > 0
    ? ("updated" as const)
    : ("ineligible" as const);
}

export async function deleteIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  observedAt: string,
): Promise<"deleted" | "active" | "not_found"> {
  const deletableRun = `run.id = ? and run.project_id = ?
    and run.status <> 'running'
    and not (
      run.status = 'queued'
      and run.lease_expires_at is not null
      and run.lease_expires_at > ?
    )`;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'archives', archive.object_key, ?, ?, ?
         from briar_log_archives archive
         join briar_hunt_runs run on run.id = archive.run_id
         where ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', related.value, ?, ?, ?
         from briar_log_archives archive
         join briar_hunt_runs run on run.id = archive.run_id,
              json_each(archive.related_object_keys_json) related
         where related.type = 'text' and ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key, ?, ?, ?
         from briar_issue_attachments attachment
         join briar_hunt_runs run on run.id = attachment.run_id
         where ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', image.object_key, ?, ?, ?
         from briar_run_evidence_images image
         join briar_hunt_runs run on run.id = image.run_id
         where ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `delete from briar_hunt_runs
         where id = ? and project_id = ?
           and status <> 'running'
           and not (
             status = 'queued'
             and lease_expires_at is not null
             and lease_expires_at > ?
           )
         returning id`,
      )
      .bind(runId, projectId, observedAt),
    db
      .prepare(
        `select id from briar_hunt_runs
         where id = ? and project_id = ?`,
      )
      .bind(runId, projectId),
  ]);
  if ((results[4]?.results?.length ?? 0) > 0) return "deleted";
  return (results[5]?.results?.length ?? 0) > 0 ? "active" : "not_found";
}

export type TransferIssueOutcome =
  | "transferred"
  | "not_found"
  | "active"
  | "same_project"
  | "source_key_conflict"
  | "archive_in_progress"
  | "proposal_approval_in_progress"
  | "execution_approval_boundary";

const isActivelyClaimedRun = (run: HuntRunRow, observedAt: string) =>
  run.status === "running" ||
  (
    run.status === "queued" &&
    run.lease_expires_at != null &&
    run.lease_expires_at > observedAt
  );

const transferredIssueRelationStatements = async (
  db: D1Database,
  input: {
    sourceProjectId: string;
    targetProjectId: string;
    runId: string;
    observedAt: string;
    resetExecutionApproval: boolean;
  },
) => {
  const transcriptQuarantineAvailable = Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table'
         and name = 'briar_channel_issue_transfer_quarantine'`,
    )
    .first<{ available: number }>());
  const channelProposalsAvailable = Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table' and name = 'briar_channel_action_proposals'`,
    )
    .first<{ available: number }>());
  const transcriptSessionQuarantineGuard = transcriptQuarantineAvailable
    ? `and not exists (
         select 1 from briar_channel_issue_transfer_quarantine quarantine
         where quarantine.entity_kind = 'agent_transcript_session'
           and quarantine.entity_id = briar_agent_transcript_sessions.session_id
       )`
    : "";
  const transcriptArchiveQuarantineGuard = transcriptQuarantineAvailable
    ? `and (
         archive_kind <> 'agent_transcript'
         or not exists (
           select 1 from briar_channel_issue_transfer_quarantine quarantine
           where quarantine.entity_kind = 'agent_transcript_archive'
             and quarantine.entity_id = briar_log_archives.id
         )
       )`
    : "";
  const statements = [
    // Older transfer attempts cleared dispatch identity but could leave a
    // retryable run queued, blocked, or failed. Repair that partial state
    // before any retry can be claimed in the target project without a fresh
    // dispatch approval.
    db
      .prepare(
        `update briar_hunt_runs
         set status = 'backlog', stage = 'queued', workflow_stage = null,
             paused_at = null, resume_requested_at = null,
             completed_at = null,
             updated_at = ?
         where id = ? and project_id = ?
           and status in ('queued', 'blocked', 'failed')
           and ? = 1
           and requested_by_user_id is null
           and dispatch_request_id is null
           and claim_token_hash is null and claimed_by is null
           and claimed_at is null and lease_expires_at is null`,
      )
      .bind(
        input.observedAt,
        input.runId,
        input.targetProjectId,
        input.resetExecutionApproval ? 1 : 0,
      ),
    db
      .prepare(
        `insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         )
         select ?, 'run', ?, 'delete', datetime('now')
         where exists (
           select 1 from briar_hunt_runs run
           where run.id = ? and run.project_id = ?
         )`,
      )
      .bind(
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `insert into briar_dashboard_sync_state (project_id, current_version)
         select ?, max(version) from briar_dashboard_changes
         where project_id = ?
         having max(version) is not null
         on conflict (project_id) do update set
           current_version = excluded.current_version`,
      )
      .bind(input.sourceProjectId, input.sourceProjectId),
    db
      .prepare(
        `delete from briar_issue_dependencies
         where project_id = ?
           and (prerequisite_run_id = ? or dependent_run_id = ?)
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_attachments
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_messages
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_run_evidence
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_run_evidence_images
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_agent_reply_jobs
         set project_id = ?, preferred_worker_id = null, claimed_worker_id = null
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_log_archives
         set project_id = ?
         where project_id = ? and run_id = ?
           and archive_kind <> 'execution_audit'
           ${transcriptArchiveQuarantineGuard}
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_archive_cleanup_queue
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_run_pull_requests
         set project_id = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_agent_transcript_sessions
         set project_id = ?
         where project_id = ? and run_id = ?
           ${transcriptSessionQuarantineGuard}
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
  ];
  statements.push(
    // Issue conversation proposals are run-scoped authorization records. Move
    // them with the conversation so the source project cannot read or accept a
    // stale proposal after transfer.
    db
      .prepare(
        `update briar_issue_rework_proposals
         set project_id = ?, updated_at = ?
         where project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.observedAt,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
    db
      .prepare(
        `update briar_issue_action_proposals
         set project_id = ?, updated_at = ?
         where project_id = ? and conversation_run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ?
           )`,
      )
      .bind(
        input.targetProjectId,
        input.observedAt,
        input.sourceProjectId,
        input.runId,
        input.runId,
        input.targetProjectId,
      ),
  );
  if (channelProposalsAvailable) {
    // Channel proposal cards point at the accepted issue. Keep their target
    // project aligned so retries and "View issue" deep links survive transfer;
    // the proposal UPDATE trigger also publishes a channel delta.
    statements.push(
      db
        .prepare(
          `update briar_channel_action_proposals
           set project_id = ?, updated_at = ?
           where result_run_id = ? and status = 'accepted'
             and exists (
               select 1 from briar_hunt_runs run
               where run.id = ? and run.project_id = ?
             )`,
        )
        .bind(
          input.targetProjectId,
          input.observedAt,
          input.runId,
          input.runId,
          input.targetProjectId,
        ),
    );
  }
  return statements;
};

const repairTransferredIssueRelations = async (
  db: D1Database,
  input: Parameters<typeof transferredIssueRelationStatements>[1],
) => db.batch(await transferredIssueRelationStatements(db, input));

export const channelApprovalTablesAvailable = async (db: D1Database) => {
  const result = await db
    .prepare(
      `select count(*) as table_count from sqlite_master
       where type = 'table'
         and name in (
           'briar_channel_action_proposals',
           'briar_channel_issue_approval_audit'
         )`,
    )
    .first<{ table_count: number }>();
  return result?.table_count === 2;
};

export const isChannelApprovedIssue = async (
  db: D1Database,
  run: Pick<HuntRunRow, "id" | "source_key">,
) => {
  if (await channelApprovalTablesAvailable(db)) {
    return Boolean(await db
      .prepare(
        `select 1 as approved
         from briar_channel_issue_approval_audit approval
         where approval.run_id = ? and approval.issue_source_key = ?
           and approval.result_verification in ('atomic', 'legacy_authorized')
         limit 1`,
      )
      .bind(run.id, run.source_key)
      .first<{ approved: number }>());
  }
  const proposalTables = await db.prepare(
    `select name from sqlite_master
     where type = 'table'
       and name in (
         'briar_channel_action_proposals', 'briar_issue_action_proposals'
       )`,
  ).all<{ name: string }>();
  const available = new Set(proposalTables.results.map((row) => row.name));
  // The new Worker may briefly run before migration 0090 if an operator uses
  // the wrong rollout order. Recognize the exact pre-migration accepted shape
  // so a queued transfer still drops back to backlog instead of carrying the
  // source project's execution approval into the target project.
  if (available.has("briar_channel_action_proposals")) {
    const channel = await db
      .prepare(
        `select 1 as approved
         from briar_channel_action_proposals proposal
         where proposal.result_run_id = ? and proposal.status = 'accepted'
           and proposal.action_type = 'request_issue_create'
           and ? = 'briar-channel-proposal:' || proposal.id
         limit 1`,
      )
      .bind(run.id, run.source_key)
      .first<{ approved: number }>();
    if (channel) return true;
  }
  if (available.has("briar_issue_action_proposals")) {
    return Boolean(await db
      .prepare(
        `select 1 as approved
         from briar_issue_action_proposals proposal
         where proposal.result_run_id = ? and proposal.status = 'accepted'
           and proposal.action_type = 'request_issue_create'
           and ? = 'briar-conversation-proposal:' || proposal.id
         limit 1`,
      )
      .bind(run.id, run.source_key)
      .first<{ approved: number }>());
  }
  return false;
};

const channelIssueTransferRecovery = async (
  db: D1Database,
  input: {
    sourceProjectId: string;
    targetProjectId: string;
    run: Pick<HuntRunRow, "id" | "source_key">;
  },
) => {
  if (!(await channelApprovalTablesAvailable(db))) return null;
  const approval = await db
    .prepare(
      `select approval.project_id
       from briar_channel_issue_approval_audit approval
       where approval.run_id = ? and approval.issue_source_key = ?
         and approval.result_verification in ('atomic', 'legacy_authorized')
       limit 1`,
    )
    .bind(
      input.run.id,
      input.run.source_key,
    )
    .first<{ project_id: string }>();
  if (!approval) return null;
  if (approval.project_id === input.sourceProjectId) return "repair" as const;
  const sourceTombstone = await db
    .prepare(
      `select 1 as transferred
       from briar_dashboard_changes
       where project_id = ? and entity_type = 'run' and entity_id = ?
         and operation = 'delete'
       limit 1`,
    )
    .bind(input.sourceProjectId, input.run.id)
    .first<{ transferred: number }>();
  if (sourceTombstone) return "complete" as const;
  const durableTransfer = await db
    .prepare(
      `select 1 as transferred
       from briar_channel_issue_transfer_reconciliation transfer
       where transfer.run_id = ? and transfer.source_project_id = ?
         and transfer.target_project_id = ?
       limit 1`,
    )
    .bind(
      input.run.id,
      input.sourceProjectId,
      input.targetProjectId,
    )
    .first<{ transferred: number }>();
  if (durableTransfer) return "repair" as const;
  // If an older transfer crashed after moving the run but before its relation
  // batch, a durable source-project dispatch still proves the A -> B provenance
  // needed to finish the tombstone and child-row repair.
  const sourceDispatch = await db
    .prepare(
      `select 1 as dispatched
       from briar_execution_audit_events execution
       where execution.run_id = ? and execution.project_id = ?
         and execution.action in ('dispatched', 'reassigned')
         and execution.request_id is not null
       limit 1`,
    )
    .bind(input.run.id, input.sourceProjectId)
    .first<{ dispatched: number }>();
  return sourceDispatch ? "repair" as const : null;
};

/**
 * Move an issue (hunt run) and its project-scoped children to another project
 * in the same organization. Active/leased runs cannot transfer. Source-project
 * dashboard clients receive an explicit delete tombstone; the run UPDATE trigger
 * upserts the issue into the target project.
 */
export async function transferIssue(
  db: D1Database,
  input: {
    sourceProjectId: string;
    targetProjectId: string;
    targetProjectName: string;
    runId: string;
    observedAt: string;
  },
): Promise<TransferIssueOutcome> {
  if (input.sourceProjectId === input.targetProjectId) {
    return "same_project";
  }

  const run = await getHuntRunForProject(
    db,
    input.sourceProjectId,
    input.runId,
  );
  if (!run) {
    const alreadyMoved = await getHuntRunForProject(
      db,
      input.targetProjectId,
      input.runId,
    );
    if (!alreadyMoved) return "not_found";
    // A target row alone is not transfer provenance: it may have always
    // belonged to that project. Only a channel approval whose immutable audit
    // points back to the requested source may repair a partial transfer.
    const recovery = await channelIssueTransferRecovery(db, {
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
      run: alreadyMoved,
    });
    if (!recovery) return "not_found";
    if (recovery === "repair") {
      await repairTransferredIssueRelations(db, {
        ...input,
        resetExecutionApproval: true,
      });
    }
    return "transferred";
  }
  if (isActivelyClaimedRun(run, input.observedAt)) return "active";
  const verifiedArchive = await db
    .prepare(
      `select 1 as archiving from briar_log_archives
       where run_id = ? and status = 'verified'
         and archive_kind <> 'execution_audit'
       limit 1`,
    )
    .bind(input.runId)
    .first<{ archiving: number }>();
  if (verifiedArchive) return "archive_in_progress";
  const channelApprovedIssue = await isChannelApprovedIssue(db, run);
  const executionProposalTable = await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table' and name = 'briar_issue_execution_proposals'`,
    )
    .first<{ available: number }>();
  const conversationalExecutionApproved = Boolean(
    executionProposalTable && run.dispatch_request_id && await db
      .prepare(
        `select 1 as approved
         where exists (
           select 1 from briar_issue_execution_proposals proposal
           where proposal.target_run_id = ? and proposal.project_id = ?
             and proposal.dispatch_request_id = ?
         ) or exists (
           select 1 from briar_issue_execution_approval_audit approval
           where approval.run_id = ? and approval.project_id = ?
             and approval.dispatch_request_id = ?
         )`,
      )
      .bind(
        run.id,
        input.sourceProjectId,
        run.dispatch_request_id,
        run.id,
        input.sourceProjectId,
        run.dispatch_request_id,
      )
      .first<{ approved: number }>(),
  );
  const executionApprovedIssue =
    channelApprovedIssue || conversationalExecutionApproved;
  // A terminal result is historical state, so do not silently turn it into a
  // target-project execution candidate. Rework needs a separate approval-aware
  // flow instead of carrying the source project's execution authority across.
  if (
    executionApprovedIssue &&
    (["completed", "cancelled"] as AutoHuntRunStatus[]).includes(run.status)
  ) {
    return "execution_approval_boundary";
  }

  const conflict = await db
    .prepare(
      `select id from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(input.targetProjectId, run.source, run.source_key)
    .first<{ id: string }>();
  if (conflict) return "source_key_conflict";

  const resetExecutionApproval =
    (["queued", "blocked", "failed"] as AutoHuntRunStatus[]).includes(
      run.status,
    ) && executionApprovedIssue;
  const targetSettings = await getProjectSettings(db, input.targetProjectId);
  const adoptTargetWorkflow =
    run.status === "backlog" || run.status === "queued" ||
    resetExecutionApproval;
  const fullAuto = runIsFullAuto(run);
  const targetBaseWorkflow = parseWorkflow(targetSettings?.workflow_json ?? null);
  const targetStageIds = new Set(targetBaseWorkflow.stages.map((stage) => stage.id));
  const targetBoundaries = new Set(
    targetBaseWorkflow.execution.checkpoints.map(
      (checkpoint) => `${checkpoint.stage}:${checkpoint.position}`,
    ),
  );
  const compatibleIssueCheckpoints = adoptTargetWorkflow && !fullAuto
    ? (JSON.parse(run.issue_checkpoints_json || "[]") as AutoHuntWorkflowCheckpoint[])
        .filter(
          (checkpoint) =>
            targetStageIds.has(checkpoint.stage) &&
            !targetBoundaries.has(`${checkpoint.stage}:${checkpoint.position}`),
        )
    : [];
  const targetWorkflowJson = adoptTargetWorkflow
    ? stableJson(
        fullAuto
          ? { ...targetBaseWorkflow, execution: { checkpoints: [] } }
          : workflowWithAdditionalCheckpoints(
              targetBaseWorkflow,
              compatibleIssueCheckpoints,
            ),
      )
    : run.workflow_snapshot_json;
  const targetRepository = adoptTargetWorkflow
    ? (targetSettings?.github_repository ?? input.targetProjectName)
    : run.repository;
  const refreshWorkflow = adoptTargetWorkflow ? 1 : 0;
  // Move the run, every project-scoped child, proposal, and the source
  // dashboard tombstone in one D1 batch transaction. The target-project
  // predicates on each relation also make a raced no-op update harmless.
  const moveStatement = db
    .prepare(
      `update briar_hunt_runs
       set project_id = ?,
           status = case
             when ? = 1 and status in ('queued', 'blocked', 'failed')
               then 'backlog' else status end,
           stage = case
             when ? = 1 and status in ('queued', 'blocked', 'failed')
               then 'queued' else stage end,
           workflow_stage = case
             when ? = 1 and status in ('queued', 'blocked', 'failed')
               then null else workflow_stage end,
           repository = case when ? = 1 then ? else repository end,
           workflow_snapshot_json = case when ? = 1 then ? else workflow_snapshot_json end,
           issue_checkpoints_json = case when ? = 1 then ? else issue_checkpoints_json end,
           agent_id = null,
           worker_id = null,
           requested_worker_id = null,
           claim_token_hash = null,
           claimed_by = null,
           claimed_at = null,
           lease_expires_at = null,
           claim_attempts = 0,
           last_execution_id = null,
           dispatch_mode = null,
           dispatch_request_id = null,
           dispatched_at = null,
           requested_by_user_id = null,
           requested_agent_provider = null,
           requested_agent_model = null,
           requested_agent_effort = null,
           paused_at = case when ? = 1 then null else paused_at end,
           resume_requested_at = case
             when ? = 1 then null else resume_requested_at end,
           completed_at = case when ? = 1 then null else completed_at end,
           updated_at = ?
       where id = ? and project_id = ?
         and status <> 'running'
         and not (
           status = 'queued'
           and lease_expires_at is not null
           and lease_expires_at > ?
         )
       returning id`,
    )
    .bind(
      input.targetProjectId,
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      refreshWorkflow,
      targetRepository,
      refreshWorkflow,
      targetWorkflowJson,
      refreshWorkflow,
      stableJson(compatibleIssueCheckpoints),
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      resetExecutionApproval ? 1 : 0,
      input.observedAt,
      input.runId,
      input.sourceProjectId,
      input.observedAt,
    );
  let transferResults: D1Result<unknown>[];
  try {
    transferResults = await db.batch([
      moveStatement,
      ...await transferredIssueRelationStatements(db, {
        ...input,
        resetExecutionApproval,
      }),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("verified run archive prevents transfer")
    ) {
      return "archive_in_progress";
    }
    if (
      error instanceof Error &&
      error.message.includes("conversation proposal acceptance in progress")
    ) {
      return "proposal_approval_in_progress";
    }
    throw error;
  }
  const movedRun = transferResults[0].results?.[0] as
    | { id: string }
    | undefined;

  if (!movedRun) {
    const stillThere = await getHuntRunForProject(
      db,
      input.sourceProjectId,
      input.runId,
    );
    if (!stillThere) {
      const alreadyMoved = await getHuntRunForProject(
        db,
        input.targetProjectId,
        input.runId,
      );
      if (!alreadyMoved) return "not_found";
      // This invocation observed the run in the source before another caller
      // atomically completed the same transfer.
    } else {
      return isActivelyClaimedRun(stillThere, input.observedAt)
        ? "active"
        : "not_found";
    }
  }

  return "transferred";
}

export type InboxReadStateRow = {
  message_id: string;
  version: string;
  updated_at: string;
};

export async function listInboxReadStates(
  db: D1Database,
  userId: string,
): Promise<InboxReadStateRow[]> {
  const result = await db
    .prepare(
      `select message_id, version, updated_at
       from briar_inbox_read_states
       where user_id = ?
       order by updated_at desc, message_id`,
    )
    .bind(userId)
    .all<InboxReadStateRow>();
  return result.results ?? [];
}

export async function upsertInboxReadStates(
  db: D1Database,
  userId: string,
  entries: ReadonlyArray<{ messageId: string; version: string }>,
  updatedAt: string,
): Promise<InboxReadStateRow[]> {
  if (entries.length === 0) {
    return listInboxReadStates(db, userId);
  }

  const statements = entries.map((entry) =>
    db
      .prepare(
        `insert into briar_inbox_read_states (
           user_id, message_id, version, updated_at
         ) values (?, ?, ?, ?)
         on conflict(user_id, message_id) do update set
           version = excluded.version,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, entry.messageId, entry.version, updatedAt),
  );
  await db.batch(statements);
  return listInboxReadStates(db, userId);
}
