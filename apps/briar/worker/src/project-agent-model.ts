import {
  type ProjectAgentScheduleIntervalUnit,
  type ProjectAgentScheduleNotificationLevel,
  type ProjectAgentScheduleRecurrence,
} from "../../src/lib/project-agent-schedule";
import {
  type AgentSkillEffort,
  type AgentSkillProvider,
  type AgentSkillRow,
} from "./agent-skills";

export type ProjectAgentProvider = AgentSkillProvider;
export type ModelEffort = AgentSkillEffort;

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
  designated_worker_id: string | null;
  designated_worker_label: string | null;
  description: string;
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
  requested_by_user_id: string | null;
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
  planned_update_resume: number;
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
  selected_skill_id: string;
  selected_skill_name: string;
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
  created_by_user_id: string | null;
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
  agent_description: string;
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
