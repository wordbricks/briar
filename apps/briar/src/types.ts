import {
  type AutoHuntQaStatus,
  type AutoHuntRunStatus,
  type AutoHuntSource,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowStageId,
} from "./lib/auto-hunt-contract";
import type { StructuredAgentResult } from "./lib/agent-result";
import type { AutoHuntWorkerResult } from "./lib/auto-hunt-agent";
import type { AgentExecutionCostRecord } from "./lib/agent-execution-cost";
import type { AgentUsagePricing } from "./lib/agent-usage-pricing";
import type {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "./lib/agent-execution-metrics";
import type { AutoHuntDispatchEvent } from "./generated/tauri";
import type { ProjectAgentCodexPet } from "./lib/codex-pets";
import type { AgentSkillExecutionProposal } from "./lib/channels-contract";
import type {
  AgentProvider,
  AgentProviderModelCatalog,
  ModelEffort,
} from "./lib/team-llm";
import type {
  TeamAgentScheduleIntervalUnit,
  TeamAgentScheduleNotificationLevel,
  TeamAgentScheduleRecurrence,
} from "./lib/team-agent-schedule";
import type { IssueDifficulty } from "./lib/issue-difficulty";
import type { ManagedComputerSetupProvider } from "./lib/agent-provider";

export type HuntStatus = AutoHuntRunStatus;
export type HuntSource = AutoHuntSource;
export type { AgentSkillExecutionProposal };

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
  difficulty: IssueDifficulty | null;
  assigneeUserId?: string | null;
  parentRunId?: string | null;
  status: "backlog" | "queued";
  attachments: File[];
  attachmentReferences?: string[];
  preferredProvider?: AgentProvider | null;
  preferredModel?: string | null;
  preferredEffort?: ModelEffort | null;
  checkpoints?: AutoHuntWorkflowCheckpoint[];
  fullAuto?: boolean;
  /** Stable idempotency key reused across retries of the same submission. */
  clientIssueId?: string;
};

export type UpdateIssueInput = {
  title: string;
  description: string | null;
  priority: number | null;
  difficulty: IssueDifficulty | null;
  assigneeUserId?: string | null;
  attachments: File[];
  attachmentReferences?: string[];
  keptAttachmentIds?: string[];
};

export type UpdateIssueResult = {
  runId: string;
  title: string;
  description: string | null;
  priority: number | null;
  difficulty: IssueDifficulty | null;
  assigneeUserId: string | null;
  attachments: IssueAttachment[];
};

export type IssueExecutionPreferences = {
  provider: AgentProvider | null;
  model: string | null;
  effort: ModelEffort | null;
};

/** Values a member explicitly chooses before approving issue execution. */
export type IssueExecutionApprovalInput = {
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  workerId: string | null;
};

/** The only mutable choice a member makes when approving a saved Skill run. */
export type AgentSkillExecutionApprovalInput = {
  workerId?: string;
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
  actorName?: string | null;
  qaStatus: AutoHuntQaStatus | null;
  trackerState: string | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  occurredAt: string;
  recordedAt: string;
};

export type IssueMessageAuthor = {
  id: string | null;
  agentId?: string | null;
  name: string;
  image: string | null;
  provider: AgentProvider | null;
};

export type IssueMessage = {
  id: string;
  runId: string;
  parentMessageId: string | null;
  body: string;
  attachments: IssueAttachment[];
  author: IssueMessageAuthor;
  replyCount: number;
  proposedAction: IssueProposedAction | null;
  /** A separate approval boundary for execution, including create-then-execute. */
  executionProposal: IssueExecutionProposal | null;
  /** A separate approval boundary for a matched saved Project Agent Skill. */
  skillExecutionProposal: AgentSkillExecutionProposal | null;
  /** Client-only state while a newly sent message awaits its server response. */
  optimistic?: boolean;
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

export type IssueUpdateProposal = {
  id: string;
  type: "request_issue_update";
  changes: {
    title?: string;
    description?: string | null;
    priority?: number | null;
  };
  changedFields?: Array<"title" | "description" | "priority">;
  status: "pending" | "accepted";
  acceptedAt: string | null;
  resultRunId: string | null;
};

export type IssueCreateProposal = {
  id: string;
  type: "request_issue_create";
  issue: {
    title: string;
    description: string | null;
    priority: number | null;
  };
  executeAfterCreate?: boolean;
  status: "pending" | "accepted";
  acceptedAt: string | null;
  resultRunId: string | null;
};

export type IssueExecutionProposal = {
  id: string;
  type: "request_issue_execute";
  status: "pending" | "accepted";
  projectId: string;
  runId: string;
  title: string;
  createdAt: string;
  acceptedAt: string | null;
  requestedProvider: AgentProvider | null;
  requestedModel: string | null;
  requestedEffort: ModelEffort | null;
  requestedWorkerId: string | null;
  delegatedByAgentId: string | null;
  delegatedByAgentName: string | null;
};

export type IssueProposedAction =
  | IssueReworkProposal
  | IssueUpdateProposal
  | IssueCreateProposal;

export type IssueMessageSendResult = {
  message: IssueMessage;
  agentReply: Promise<IssueMessage> | null;
  agentReplyJob?: IssueAgentReplyState | null;
  agentReplyJobs?: IssueAgentReplyState[];
};

export type IssueAgentReplyState = {
  id: string;
  triggerMessageId: string;
  parentMessageId: string;
  agentId?: string | null;
  agentName?: string | null;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  workerId: string | null;
  provider: AgentProvider | null;
  error: string | null;
  updatedAt: string;
};

export type IssueConversationSnapshot = {
  cursor: number;
  messages: IssueMessage[];
  agentReplies: IssueAgentReplyState[];
};

export type IssueConversationDelta = {
  cursor: number;
  hasMore: boolean;
  changed: boolean;
  reset: boolean;
  messages?: IssueMessage[];
  agentReplies?: IssueAgentReplyState[];
};

export type IssueConversationNotification = {
  id: string;
  runId: string;
  runTitle: string;
  rootMessageId: string;
  body: string;
  author: IssueMessageAuthor;
  reason: "mention" | "thread_reply" | "subscription";
  createdAt: string;
};

export type IssueSubscriber = {
  userId: string;
  subscribedAt: string;
};

export type ChannelConversationNotification = {
  id: string;
  channelId: string;
  channelName: string;
  rootMessageId: string;
  body: string;
  author: IssueMessageAuthor;
  reason: "mention" | "thread_reply" | "subscription";
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
  workspaceId?: string | null;
  teamId?: string;
  projectId?: string;
  projectName?: string | null;
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
  issueCheckpoints?: AutoHuntWorkflowCheckpoint[];
  fullAuto?: boolean;
  detail: string | null;
  priority: number | null;
  difficulty: IssueDifficulty | null;
  assigneeUserId?: string | null;
  createdByUserId?: string | null;
  subscribers: IssueSubscriber[];
  repository: string;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerReference | null;
  issueDescription: string | null;
  relatedMessage?: RelatedMessageReference | null;
  attachments: IssueAttachment[];
  parent?: IssueDependencyReference | null;
  subIssues?: IssueDependencyReference[];
  relatedIssues?: IssueDependencyReference[];
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

export type RelatedMessageReference = {
  organizationId: string;
  channelId: string;
  messageId: string;
  rootMessageId: string;
};

export type StatusTrayRun = {
  teamId: string;
  teamName: string;
  id: string;
  title: string;
  status: "running";
  workflowStage: AutoHuntWorkflowStageId | null;
  workflowStageLabel: string | null;
  startedAt: string;
  updatedAt: string;
  lastEventAt: string;
};

export type StatusTrayRunsPayload = {
  runs: StatusTrayRun[];
  generatedAt: string;
};

/** Lightweight execution projection used by the organization Usage page. */
export type AgentUsageExecutionAttempt = {
  executionId: string;
  /** Team that owned the run when this claim was created. */
  teamId: string;
  runAttempt: number;
  claimAttempt: number;
  workerId: string | null;
  claimedBy: string | null;
  claimedAt: string;
  recordedAt: string;
};

export type AgentUsageRecord = AgentExecutionUsageRecord & {
  executionId: string;
  /** Team that owned the run when this usage was observed. */
  teamId: string;
  runAttempt: number;
  claimAttempt: number;
  workerId: string | null;
  claimedAt: string;
  recordedAt: string;
};

export type AgentUsageCostRecord = AgentExecutionCostRecord & {
  executionId: string;
  /** Team that owned the run when this cost was observed. */
  teamId: string;
  runAttempt: number;
  claimAttempt: number;
  workerId: string | null;
  claimedAt: string;
  recordedAt: string;
  costSource: "providerReported";
};

export type AgentUsageEstimatedCostRecord = Pick<
  AgentUsageRecord,
  | "executionId"
  | "teamId"
  | "runAttempt"
  | "claimAttempt"
  | "workerId"
  | "claimedAt"
  | "usageKey"
  | "sessionId"
  | "scopeId"
  | "turnId"
  | "agentProvider"
  | "modelProvider"
  | "model"
  | "canonicalModel"
  | "modelSource"
  | "observedAt"
> & {
  usageSource: string;
  pricingKey: string;
  amountUsdTicks: number;
  costSource: "modelPriced";
};

export type {
  AgentExecutionCostEstimate,
  AgentExecutionCostEstimateModel,
  AgentUsagePricing,
} from "./lib/agent-usage-pricing";

export type AgentUsageRun = {
  id: string;
  teamId: string;
  status: HuntStatus;
  executionMetrics: AgentExecutionMetrics | null;
  claimedBy: string | null;
  claimedAt: string | null;
  claimAttempts: number;
  workerId: string | null;
  preferredProvider: AgentProvider | null;
  preferredModel: string | null;
  requestedProvider: AgentProvider | null;
  requestedModel: string | null;
  executionProvider: AgentProvider | null;
  executionModel: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Present on servers with immutable execution-attempt usage ledgers. */
  executionAttempts?: AgentUsageExecutionAttempt[];
  /** Present on servers with immutable execution-attempt usage ledgers. */
  usageRecords?: AgentUsageRecord[];
  /** Present on servers with immutable provider-reported cost ledgers. */
  costRecords?: AgentUsageCostRecord[];
  /** Recalculated from current model prices whenever this report is read. */
  estimatedCostRecords?: AgentUsageEstimatedCostRecord[];
};

export type AgentUsageReport = {
  runs: AgentUsageRun[];
  generatedAt: string;
  pricing: AgentUsagePricing;
};

export type { TeamUsageSummary } from "./lib/team-usage-summary";
/** @deprecated Use TeamUsageSummary instead. */
export type { TeamUsageSummary as ProjectUsageSummary } from "./lib/team-usage-summary";

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
  providers: AgentProvider[];
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
  capabilities: Record<string, unknown> & {
    providerCapabilities?: AgentProviderModelCatalog;
  };
  maxConcurrentSessions: number;
  activeSessions: number;
  availableSessions: number;
  lastHeartbeatAt: string;
  createdAt: string;
};

export type WorkerIcon =
  | { type: "emoji"; value: string }
  | { type: "image"; value: string };

export type TeamExecutionWorkerPolicy = {
  selectionMode: "any" | "allowlist";
  defaultWorkerId: string | null;
  allowedWorkerIds: string[];
  updatedAt: string | null;
};

/** @deprecated Use {@link TeamExecutionWorkerPolicy} instead. */
export type ProjectExecutionWorkerPolicy = TeamExecutionWorkerPolicy;

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
  versions?: Record<string, string>;
  remoteUpdateSupported?: boolean;
  updateRequest?: {
    id: string;
    targetVersion: string;
    status: "requested" | "completed" | "cancelled";
    requestedAt: string;
    handoffState?: "idle" | "draining" | "ready" | "failed";
    handoffError?: string | null;
  } | null;
  bindings: Array<{
    id: string;
    projectId: string;
    projectName: string;
    agentProvider: AgentProvider;
    providers: AgentProvider[];
    state: "online" | "stale" | "disabled";
    acceptingWork: boolean;
    readiness:
      "available" | "busy" | "offline" | "needs_attention" | "disabled";
    readinessDetail: string | null;
  }>;
};

export type ManagedComputerState =
  | "requested"
  | "provisioning"
  | "bootstrapping"
  | "needs_setup"
  | "ready"
  | "failed"
  | "draining"
  | "stopped"
  | "terminated";

export type ManagedComputerProvider = "aws" | "sandbox";

export type ManagedComputer = {
  id: string;
  organizationId: string;
  requesterUserId: string;
  state: ManagedComputerState;
  provider: ManagedComputerProvider;
  /** Sandbox computers carry the label their worker registered with. */
  label: string | null;
  region: string;
  instanceId: string | null;
  volumeId: string | null;
  deviceId: string | null;
  error: { code: string; message: string } | null;
  retryCount: number;
  retryAvailable: boolean;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
};

export type ManagedComputerProduct = {
  product: {
    currency: "USD";
    monthlyPriceCents: number;
    quantity: 1;
    specification: {
      instanceType: string;
      vcpu: number;
      memoryGiB: number;
      volumeGiB: number;
      maxConcurrentRuns: 1;
      region: string | null;
    };
    modelApiCostsIncluded: false;
  };
  applicationsEnabled: boolean;
  remoteDesktopEnabled: boolean;
  configurationReady: boolean;
  canApply: boolean;
  organizationLimit: number;
  fleetLimit: number;
};

export type ManagedComputerRemoteSession = {
  id: string;
  managedComputerId: string;
  agentId: string | null;
  state:
    | "created"
    | "connecting"
    | "connected"
    | "disconnected"
    | "ended"
    | "expired"
    | "rejected";
  connectionGeneration: number;
  tokenExpiresAt: string;
  maxExpiresAt: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  endedAt: string | null;
};

export type ManagedComputerRemoteSessionTicket = {
  session: ManagedComputerRemoteSession;
  socket: { url: string; protocol: string };
  reconnected: boolean;
};

export type OrganizationRole =
  | "owner"
  | "co-owner"
  | "developer"
  | "editor"
  | "viewer";

export type OrganizationAssignableRole = Exclude<OrganizationRole, "owner">;

export type ManagedComputerSetupSessionTicket = {
  session: {
    id: string;
    managedComputerId: string;
    organizationId: string;
    teamId: string;
    status: "pending" | "consumed";
    expiresAt: string;
  };
  setupToken: string;
  socket: { url: string; protocol: string };
  agentConnected: boolean;
  duplicate: boolean;
};

export type { ManagedComputerSetupProvider };

export type HuntRunPlacement = {
  status: Exclude<HuntStatus, "paused">;
  workflowStage: AutoHuntWorkflowStageId | null;
};

export type Team = {
  id: string;
  name: string;
  issueKeyPrefix: string;
  scheduleTabEnabled: boolean;
  icon: string | null;
  iconName: string | null;
  iconColor: string | null;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  createdAt: string;
};

/** @deprecated Use {@link Team} instead. */
export type Project = Team;

/**
 * A team the onboarding flow just connected, either for the first time
 * (`"new"`) or again after it was disconnected (`"reconnect"`).
 */
export type ProjectConnection = {
  kind: "new" | "reconnect";
  project: Team;
  agentToken: string | null;
  workflow?: TeamSettings["workflow"];
};

export type PlanningProjectStatus =
  | "planned"
  | "active"
  | "completed"
  | "cancelled";

export type PlanningProject = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  teamId: string;
  teamName: string;
  name: string;
  description: string;
  status: PlanningProjectStatus;
  leadUserId: string | null;
  leadName: string | null;
  startDate: string | null;
  targetDate: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
};

export type TeamAgent = {
  id: string;
  teamId: string;
  name: string;
  avatar: string | null;
  codexPet: ProjectAgentCodexPet | null;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  computerUsePolicy?: "disabled" | "unattended";
  designatedWorkerId?: string | null;
  designatedWorkerLabel?: string | null;
  description?: string;
  responsibility: string;
  skill: string;
  skills: TeamAgentSkill[];
  calendarColor: string;
  createdAt: string;
  updatedAt: string;
};

/** @deprecated Use {@link TeamAgent} instead. */
export type ProjectAgent = TeamAgent;

export type TeamAgentSkillKind = "issue_processing" | "custom";
export type TeamAgentSkillExecutionMode = "conversation" | "task";
export type TeamAgentSkillApprovalPolicy =
  | "invoke_is_consent"
  | "explicit";

/** @deprecated Use TeamAgentSkillKind instead. */
export type ProjectAgentSkillKind = TeamAgentSkillKind;
/** @deprecated Use TeamAgentSkillExecutionMode instead. */
export type ProjectAgentSkillExecutionMode = TeamAgentSkillExecutionMode;
/** @deprecated Use TeamAgentSkillApprovalPolicy instead. */
export type ProjectAgentSkillApprovalPolicy = TeamAgentSkillApprovalPolicy;

export type TeamAgentSkill = {
  id: string;
  agentId: string;
  name: string;
  description: string;
  body: string;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  kind: TeamAgentSkillKind;
  executionMode: TeamAgentSkillExecutionMode;
  approvalPolicy: TeamAgentSkillApprovalPolicy;
  position: number;
  createdAt: string;
  updatedAt: string;
};

/** @deprecated Use {@link TeamAgentSkill} instead. */
export type ProjectAgentSkill = TeamAgentSkill;

export type TeamAgentSkillInput = Pick<
  TeamAgentSkill,
  | "name"
  | "description"
  | "body"
  | "provider"
  | "model"
  | "effort"
  | "kind"
  | "executionMode"
  | "approvalPolicy"
  | "position"
> & {
  id?: string;
};

/** @deprecated Use {@link TeamAgentSkillInput} instead. */
export type ProjectAgentSkillInput = TeamAgentSkillInput;

export type CreateTeamAgentInput = {
  name: string | null;
  avatar?: string | null;
  codexPet?: ProjectAgentCodexPet | null;
  provider: AgentProvider;
  model: string | null;
  effort?: ModelEffort | null;
  computerUsePolicy?: "disabled" | "unattended";
  designatedWorkerId?: string | null;
  description?: string;
  responsibility: string;
  skills?: TeamAgentSkillInput[];
  calendarColor: string;
};

/** @deprecated Use {@link CreateTeamAgentInput} instead. */
export type CreateProjectAgentInput = CreateTeamAgentInput;

export type TeamAgentSchedule = {
  id: string;
  teamId: string;
  agentId: string;
  agentName: string;
  agentProvider: AgentProvider;
  name: string;
  recurrence: TeamAgentScheduleRecurrence;
  timeOfDay: string;
  dayOfWeek: number | null;
  intervalValue?: number;
  intervalUnit?: TeamAgentScheduleIntervalUnit;
  daysOfWeek?: number[];
  notificationLevel?: TeamAgentScheduleNotificationLevel;
  timeZone: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** @deprecated Use {@link TeamAgentSchedule} instead. */
export type ProjectAgentSchedule = TeamAgentSchedule;

export type CreateTeamAgentScheduleInput = {
  agentId: string;
  name: string;
  recurrence: TeamAgentScheduleRecurrence;
  timeOfDay: string;
  dayOfWeek: number | null;
  intervalValue?: number;
  intervalUnit?: TeamAgentScheduleIntervalUnit;
  daysOfWeek?: number[];
  notificationLevel?: TeamAgentScheduleNotificationLevel;
  timeZone: string;
};

/** @deprecated Use {@link CreateTeamAgentScheduleInput} instead. */
export type CreateProjectAgentScheduleInput = CreateTeamAgentScheduleInput;

export type UpdateTeamAgentScheduleInput = CreateTeamAgentScheduleInput;

/** @deprecated Use {@link UpdateTeamAgentScheduleInput} instead. */
export type UpdateProjectAgentScheduleInput = UpdateTeamAgentScheduleInput;

export type TeamAgentScheduleRun = {
  id: string;
  teamId: string;
  scheduleId: string;
  scheduleName: string;
  agent: Pick<
    TeamAgent,
    | "id"
    | "name"
    | "provider"
    | "model"
    | "effort"
    | "computerUsePolicy"
    | "description"
    | "responsibility"
    | "skill"
    | "skills"
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

/** @deprecated Use {@link TeamAgentScheduleRun} instead. */
export type ProjectAgentScheduleRun = TeamAgentScheduleRun;

export type ClaimedTeamAgentScheduleRun = TeamAgentScheduleRun & {
  status: "running";
  claimToken: string;
};

/** @deprecated Use {@link ClaimedTeamAgentScheduleRun} instead. */
export type ClaimedProjectAgentScheduleRun = ClaimedTeamAgentScheduleRun;

export type UpdateTeamAgentInput = Omit<
  CreateTeamAgentInput,
  "skills"
> & {
  skills: TeamAgentSkillInput[];
};

/** @deprecated Use {@link UpdateTeamAgentInput} instead. */
export type UpdateProjectAgentInput = UpdateTeamAgentInput;

export type Organization = {
  id: string;
  name: string;
  handle: string;
  logo: string | null;
  role: OrganizationRole;
  createdAt: string;
};

export type OrganizationMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: OrganizationRole;
  projectIds?: string[];
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
  role: OrganizationAssignableRole;
  status: OrganizationInvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type OrganizationInvitationPreview = Omit<
  OrganizationInvitation,
  "email"
>;

export type TeamSettings = {
  velenOrg: string | null;
  dataSource: string | null;
  linear: {
    enabled: boolean;
    source: string | null;
    teamKey: string | null;
  };
  githubRepositoryId: number | null;
  githubRepository: string | null;
  workflow: AutoHuntWorkflow;
  checkpointPolicy?: {
    availableBoundaries: Array<{
      stage: string;
      stageLabel: string;
      position: "before" | "after";
    }>;
    teamMandatory: AutoHuntWorkflowCheckpoint[];
    userDefaults: AutoHuntWorkflowCheckpoint[];
    effective: AutoHuntWorkflowCheckpoint[];
    teamRevision: number;
    userRevision: number;
  };
};

/** @deprecated Use {@link TeamSettings} instead. */
export type ProjectSettings = TeamSettings;

export type MergeQueueProfile = {
  teamId: string;
  repositoryId: number;
  repository: string;
  baseBranch: "main";
  enabled: boolean;
  readinessStageId: string;
  validationCommands: string[];
  quietWindowMs: number;
  maxBatchSize: number;
  updatedAt: string;
};

export type MergeQueueBatchState =
  | "collecting"
  | "frozen"
  | "enqueueing"
  | "waiting_tail"
  | "validating"
  | "publishing"
  | "awaiting_merge"
  | "blocked"
  | "draining"
  | "completed"
  | "failed";

export type MergeQueueCandidateState =
  | "ready"
  | "frozen"
  | "enqueued"
  | "merged"
  | "dequeued"
  | "failed";

export type MergeQueueStatus = {
  batches: Array<{
    id: string;
    state: MergeQueueBatchState;
    candidateCount: number;
    quietUntil: string;
    frozenAt: string | null;
    mergeGroupSha: string | null;
    failureCode: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  candidates: Array<{
    id: string;
    batchId: string | null;
    runId: string;
    pullRequestNumber: number;
    pullRequestUrl: string;
    state: MergeQueueCandidateState;
    ordinal: number | null;
    readyAt: string;
    failureCode: string | null;
    updatedAt: string;
  }>;
};

export type DashboardPayload = {
  team: Team;
  settings: TeamSettings;
  runs: HuntRun[];
  workers?: ExecutionWorker[];
  organizationProviders?: AgentProvider[];
  executionPolicy?: TeamExecutionWorkerPolicy;
  members?: OrganizationMember[];
  conversationNotifications?: IssueConversationNotification[];
  channelNotifications?: ChannelConversationNotification[];
  cursor?: number;
  generatedAt: string;
};

/**
 * What the Agents page and everything under it read of a team's board: the
 * team it acts in, the runs an Auto Hunt dispatch may pick from, and the
 * workers and policy that decide which providers are runnable.
 *
 * `null` where one of these is expected means "no board on screen", which is
 * the condition the page disables its actions on. The store publishes it as
 * `teamAgentBoardAtom`; a `loadDashboard` response satisfies it as well.
 */
export type TeamAgentBoard = Pick<
  DashboardPayload,
  "team" | "runs" | "workers" | "executionPolicy"
>;

export type DashboardDeltaPayload = {
  cursor: number;
  hasMore: boolean;
  reset: boolean;
  runs: HuntRun[];
  deletedRunIds: string[];
  workers: ExecutionWorker[];
  organizationProviders: AgentProvider[];
  team?: Team;
  settings?: TeamSettings;
  executionPolicy?: TeamExecutionWorkerPolicy;
  members?: OrganizationMember[];
  conversationNotifications?: IssueConversationNotification[];
  channelNotifications?: ChannelConversationNotification[];
  generatedAt: string;
};

export type SessionUser = {
  id: string;
  username?: string | null;
  name: string;
  email: string;
  image?: string | null;
};

/*
  One Auto Hunt agent session: a dispatch group or a single task, the issues it
  touched and how it ended.

  It belongs here rather than in the hook that stores it because
  `state/issues/actions.ts` adopts a remote session and would otherwise have to
  import a React hook for a type.
*/
export type AutoHuntSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "interrupted";
export type AutoHuntSessionIssueOutcome =
  | "pending"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";
export type AutoHuntSessionEventType =
  | "started"
  | "completed"
  | "failed"
  | "skipped"
  | "interrupted"
  | "stopped";

export type AutoHuntSessionIssue = {
  runId: string;
  runNumber: number;
  sourceKey: string;
  title: string;
  outcome: AutoHuntSessionIssueOutcome;
  summary: string | null;
};

export type AutoHuntSessionEvent = {
  id: string;
  type: AutoHuntSessionEventType;
  occurredAt: string;
};

export type AutoHuntSessionFollowUp = {
  id: string;
  message: string;
  sentAt: string;
};

export type AutoHuntSession = {
  id: string;
  dispatchGroupId: string;
  projectId: string;
  agentId?: string;
  agentName?: string | null;
  skillId?: string | null;
  sessionType: "task" | "dispatch";
  trigger?: "manual" | "scheduled";
  scheduleId?: string;
  scheduleRunId?: string;
  parentSessionId?: string;
  request?: string;
  followUps?: AutoHuntSessionFollowUp[];
  status: AutoHuntSessionStatus;
  issues: AutoHuntSessionIssue[];
  startedAt: string;
  completedAt: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
  requestedWorkerId?: string | null;
  workerId?: string | null;
  requestedByUserId?: string | null;
  summary: string | null;
  error: string | null;
  events: AutoHuntSessionEvent[];
  dispatchEvents: AutoHuntDispatchEvent[];
  workers: AutoHuntWorkerResult[];
  updatedAt: string;
  localOwner?: boolean;
  archived?: boolean;
  detailLoaded?: boolean;
};
