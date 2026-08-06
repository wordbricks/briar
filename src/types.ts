import {
  autoHuntRunStatuses,
  type AutoHuntQaStatus,
  type AutoHuntRunStatus,
  type AutoHuntSource,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowStageId,
} from "./lib/auto-hunt-contract";
import type { StructuredAgentResult } from "./lib/agent-result";
import type { AgentExecutionMetrics } from "./lib/agent-execution-metrics";
import type { ProjectAgentCodexPet } from "./lib/codex-pets";
import type { AgentProvider, ModelEffort } from "./lib/project-llm";
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
  assigneeUserId?: string | null;
  status: "backlog" | "queued";
  attachments: File[];
  attachmentReferences?: string[];
};

export type CreateProductWorkItemInput = CreateIssueInput & {
  targetProjectIds: string[];
  dependencies?: Array<{
    prerequisiteProjectId: string;
    dependentProjectId: string;
  }>;
};

export type UpdateIssueInput = {
  title: string;
  description: string | null;
  priority: number | null;
  assigneeUserId?: string | null;
};

export type IssueExecutionPreferences = {
  provider: AgentProvider | null;
  model: string | null;
  effort: ModelEffort | null;
};

export type IssueDependencyReference = {
  id: string;
  runNumber: number;
  title: string;
  status: HuntStatus;
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
  attachments?: IssueAttachment[];
  author: IssueMessageAuthor;
  replyCount: number;
  proposedAction?: IssueReworkProposal | null;
  createdAt: string;
  updatedAt: string;
};

export type IssueReworkProposal = {
  id: string;
  type: "request_issue_rework";
  workflowStage: string;
  reason: string;
  status: "pending" | "accepted";
  acceptedAt: string | null;
  appliedRevision: number | null;
};

export type IssueMessageSendResult = {
  message: IssueMessage;
  agentReply: Promise<IssueMessage> | null;
};

export type IssueConversationNotification = {
  id: string;
  runId: string;
  runTitle: string;
  rootMessageId: string;
  body: string;
  author: IssueMessageAuthor;
  reason: "mention" | "thread_reply";
  createdAt: string;
};

export type RunEvidenceImage = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  position: number;
  url: string;
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
  images?: RunEvidenceImage[];
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
  pausedAt?: string | null;
  resumeRequestedAt?: string | null;
  waitingCheckpoint?: { key: string; revision: number } | null;
  checkpoint?: {
    key: string;
    stage: string;
    stageLabel: string;
    position: "before" | "after";
    attempt: number;
    revision: number;
    reachedAt: string | null;
    nextStage: string | null;
    nextStageLabel: string | null;
    terminalReviewOnly: boolean;
  } | null;
  detail: string | null;
  priority: number | null;
  assigneeUserId?: string | null;
  repository: string;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerReference | null;
  issueDescription: string | null;
  attachments: IssueAttachment[];
  prerequisites?: IssueDependencyReference[];
  dependents?: IssueDependencyReference[];
  executionReadiness?: "ready" | "waiting";
  waitingOnPrerequisiteCount?: number;
  resultSummary: string | null;
  structuredResult: StructuredAgentResult | null;
  executionMetrics?: AgentExecutionMetrics | null;
  resultReviews?: IssueResultReview[];
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
  agentId?: string | null;
  preferredProvider?: AgentProvider | null;
  preferredModel?: string | null;
  preferredEffort?: ModelEffort | null;
  requestedProvider?: AgentProvider | null;
  requestedModel?: string | null;
  requestedEffort?: ModelEffort | null;
  requestedWorkerId?: string | null;
  requestedByUserId?: string | null;
  dispatchMode?: "any" | "specific" | null;
  dispatchedAt?: string | null;
  workerId?: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastEventAt: string;
  eventCount: number;
};

export type IssueResultReview = {
  userId: string;
  name: string;
  username: string | null;
  image: string | null;
  completedAt: string;
};

export type ExecutionWorker = {
  id: string;
  deviceId: string;
  ownerUserId: string;
  label: string;
  icon?: WorkerIcon | null;
  agentProvider: AgentProvider;
  providers?: AgentProvider[];
  versions: Record<string, string>;
  state: "online" | "stale" | "disabled";
  readiness:
    | "available"
    | "busy"
    | "offline"
    | "needs_attention"
    | "disabled";
  acceptingWork: boolean;
  readinessDetail: string | null;
  capabilities: Record<string, unknown>;
  maxConcurrentSessions: number;
  activeSessions: number;
  availableSessions: number;
  lastHeartbeatAt: string;
  createdAt: string;
};

export type WorkerIcon =
  | { type: "emoji"; value: string }
  | { type: "image"; value: string };

export type ProjectExecutionWorkerPolicy = {
  selectionMode: "any" | "allowlist";
  defaultWorkerId: string | null;
  allowedWorkerIds: string[];
  updatedAt: string | null;
};

export type OrganizationExecutionWorker = {
  deviceId: string;
  ownerUserId: string;
  ownerName: string;
  label: string;
  icon?: WorkerIcon | null;
  state: "online" | "stale" | "disabled";
  maxConcurrentSessions: number;
  activeSessions: number;
  lastHeartbeatAt: string;
  createdAt: string;
  bindings: Array<{
    id: string;
    projectId: string;
    projectName: string;
    agentProvider: AgentProvider;
    providers?: AgentProvider[];
    state: "online" | "stale" | "disabled";
    acceptingWork: boolean;
    readiness:
      "available" | "busy" | "offline" | "needs_attention" | "disabled";
    readinessDetail: string | null;
  }>;
};

export type HuntRunPlacement = {
  status: Exclude<HuntStatus, "paused">;
  workflowStage: AutoHuntWorkflowStageId | null;
};

export type Project = {
  id: string;
  name: string;
  icon?: string | null;
  productId?: string;
  productName?: string;
  organizationId?: string;
  organizationName?: string;
  role?: "owner" | "admin" | "member";
  createdAt: string;
};

export type Product = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
  projects: Project[];
};

export type ProductWorkItemStatus =
  | "backlog"
  | "queued"
  | "in_progress"
  | "blocked"
  | "failed"
  | "ready_for_review"
  | "completed"
  | "cancelled";

export type ProductWorkItem = {
  id: string;
  productId: string;
  source: HuntSource;
  sourceKey: string;
  title: string;
  description: string | null;
  priority: number | null;
  assigneeUserId: string | null;
  status: ProductWorkItemStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  targets: Array<{
    projectId: string;
    projectName: string;
    runId: string;
    runNumber: number;
    status: HuntStatus;
    required: boolean;
    position: number;
    pullRequestUrls: string[];
  }>;
  dependencies: Array<{
    prerequisiteRunId: string;
    dependentRunId: string;
  }>;
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
  logo: string | null;
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

export type OrganizationInvitationStatus =
  "pending" | "accepted" | "expired" | "revoked";

export type OrganizationInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  initialProjectId: string;
  initialProjectName: string;
  email: string;
  emailHint: string;
  role: "admin" | "member";
  status: OrganizationInvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type OrganizationInvitationPreview = Omit<
  OrganizationInvitation,
  "email"
>;

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
  checkpointPolicy?: {
    availableBoundaries: Array<{
      stage: string;
      stageLabel: string;
      position: "before" | "after";
    }>;
    projectMandatory: AutoHuntWorkflowCheckpoint[];
    userDefaults: AutoHuntWorkflowCheckpoint[];
    effective: AutoHuntWorkflowCheckpoint[];
    projectRevision: number;
    userRevision: number;
  };
};

export type DashboardPayload = {
  project: Project;
  settings: ProjectSettings;
  runs: HuntRun[];
  workers?: ExecutionWorker[];
  organizationProviders?: AgentProvider[];
  executionPolicy?: ProjectExecutionWorkerPolicy;
  members?: OrganizationMember[];
  conversationNotifications?: IssueConversationNotification[];
  cursor?: number;
  generatedAt: string;
};

export type DashboardDeltaPayload = {
  cursor: number;
  hasMore: boolean;
  runs: HuntRun[];
  deletedRunIds: string[];
  workers: ExecutionWorker[];
  organizationProviders: AgentProvider[];
  project?: Project;
  settings?: ProjectSettings;
  executionPolicy?: ProjectExecutionWorkerPolicy;
  members?: OrganizationMember[];
  conversationNotifications?: IssueConversationNotification[];
  generatedAt: string;
};

export type SessionUser = {
  id: string;
  username?: string | null;
  name: string;
  email: string;
  image?: string | null;
};
