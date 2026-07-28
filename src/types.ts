import {
  autoHuntRunStatuses,
  type AutoHuntQaStatus,
  type AutoHuntRunStatus,
  type AutoHuntSource,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowStageId,
} from "./lib/auto-hunt-contract";
import type { StructuredAgentResult } from "./lib/agent-result";
import type { ProjectAgentCodexPet } from "./lib/codex-pets";
import type { AgentProvider } from "./lib/project-llm";
import type {
  ProjectAgentScheduleIntervalUnit,
  ProjectAgentScheduleNotificationLevel,
  ProjectAgentScheduleRecurrence,
} from "./lib/project-agent-schedule";

export const huntStatuses = autoHuntRunStatuses;
export type HuntStatus = AutoHuntRunStatus;
export type HuntSource = AutoHuntSource;

export type TrackerReference = {
  provider: string;
  issueId: string | null;
  identifier: string | null;
  url: string | null;
  state: string | null;
};

export type IssueAttachment = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  url: string;
};

export type CreateIssueInput = {
  title: string;
  description: string | null;
  priority: number | null;
  status: "backlog" | "queued";
  attachments: File[];
};

export type UpdateIssueInput = {
  title: string;
  description: string | null;
  priority: number | null;
};

export type HuntEvent = {
  id: string;
  attempt: number;
  revision: number;
  status: HuntStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  detail: string | null;
  actor: string;
  qaStatus: AutoHuntQaStatus | null;
  trackerState: string | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  occurredAt: string;
  recordedAt: string;
};

export type IssueMessageAuthor = {
  id: string | null;
  name: string;
  image: string | null;
  provider: AgentProvider | null;
};

export type IssueMessage = {
  id: string;
  runId: string;
  parentMessageId: string | null;
  body: string;
  author: IssueMessageAuthor;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IssueMessageSendResult = {
  message: IssueMessage;
  agentReply: Promise<IssueMessage> | null;
};

export type RunEvidence = {
  key: string;
  attempt: number;
  revision: number;
  stage: string;
  type: string;
  status: "pending" | "passed" | "failed" | "skipped";
  detail: string | null;
  command: string | null;
  url: string | null;
  metadata: Record<string, unknown> | null;
  actor: string;
  observedAt: string;
  recordedAt: string;
  images?: Array<{
    id: string;
    filename: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    position: number;
    url: string;
  }>;
  requiredRevision: number;
  canonical: boolean;
};

export type HuntRun = {
  id: string;
  runNumber: number;
  currentAttempt: number;
  currentRevision: number;
  source: HuntSource;
  sourceKey: string;
  title: string;
  status: HuntStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  workflow: AutoHuntWorkflow;
  progress: number;
  detail: string | null;
  priority: number | null;
  repository: string;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerReference | null;
  issueDescription: string | null;
  attachments: IssueAttachment[];
  resultSummary: string | null;
  structuredResult: StructuredAgentResult | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  sourceCreatedAt: string | null;
  stagingQaStatus: AutoHuntQaStatus | null;
  productionQaStatus: AutoHuntQaStatus | null;
  stagingQaDetail: string | null;
  productionQaDetail: string | null;
  context: Record<string, unknown> | null;
  claimedBy: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  claimAttempts: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  events: HuntEvent[];
};

export type HuntRunPlacement = {
  status: HuntStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
};

export type Project = {
  id: string;
  name: string;
  organizationId?: string;
  organizationName?: string;
  role?: "owner" | "admin" | "member";
  createdAt: string;
};

export type ProjectAgent = {
  id: string;
  projectId: string;
  name: string;
  avatar: string | null;
  codexPet: ProjectAgentCodexPet | null;
  provider: AgentProvider;
  model: string | null;
  responsibility: string;
  skill: string;
  calendarColor: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectAgentInput = {
  name: string | null;
  avatar?: string | null;
  codexPet?: ProjectAgentCodexPet | null;
  provider: AgentProvider;
  model: string | null;
  responsibility: string;
  calendarColor: string;
};

export type ProjectAgentSchedule = {
  id: string;
  projectId: string;
  agentId: string;
  agentName: string;
  agentProvider: AgentProvider;
  name: string;
  recurrence: ProjectAgentScheduleRecurrence;
  timeOfDay: string;
  dayOfWeek: number | null;
  intervalValue?: number;
  intervalUnit?: ProjectAgentScheduleIntervalUnit;
  daysOfWeek?: number[];
  notificationLevel?: ProjectAgentScheduleNotificationLevel;
  timeZone: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectAgentScheduleInput = {
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

export type UpdateProjectAgentScheduleInput = CreateProjectAgentScheduleInput;

export type ProjectAgentScheduleRun = {
  id: string;
  projectId: string;
  scheduleId: string;
  scheduleName: string;
  agent: Pick<
    ProjectAgent,
    "id" | "name" | "provider" | "model" | "responsibility" | "skill"
  >;
  workflow: AutoHuntWorkflow;
  status: "running" | "completed" | "failed";
  scheduledFor: string;
  leaseExpiresAt: string | null;
  startedAt: string;
  completedAt: string | null;
  resultSummary: string | null;
  structuredResult: StructuredAgentResult | null;
  error: string | null;
};

export type ClaimedProjectAgentScheduleRun = ProjectAgentScheduleRun & {
  status: "running";
  claimToken: string;
};

export type UpdateProjectAgentInput = CreateProjectAgentInput;

export type Organization = {
  id: string;
  name: string;
  handle: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

export type OrganizationMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

export type ProjectSettings = {
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

export type DashboardPayload = {
  project: Project;
  settings: ProjectSettings;
  runs: HuntRun[];
  generatedAt: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};
