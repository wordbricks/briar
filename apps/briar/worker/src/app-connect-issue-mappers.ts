import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ApprovalOutcome,
  IssueAttachmentSchema,
  IssueDifficulty,
  IssueSubscriberSchema,
  MessageAuthorSchema,
  ProposalStatus,
  ReplyJobStatus,
  ResultReviewSchema,
  RunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillExecutionProposalSchema,
  AgentSkillExecutionStatus,
  ProjectAgentSessionEventSchema,
  ProjectAgentSessionEventType,
  ProjectAgentSessionFollowUpSchema,
  ProjectAgentSessionIssueOutcome,
  ProjectAgentSessionIssueSchema,
  ProjectAgentSessionSchema,
  ProjectAgentSessionStatus,
  ProjectAgentSessionTrigger,
  ProjectAgentSessionType,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import {
  AcceptIssueActionProposalResponseSchema,
  AcceptIssueExecutionProposalResponseSchema,
  AcceptIssueReworkProposalResponseSchema,
  AcceptIssueSkillExecutionProposalResponseSchema,
  CancelRunResponseSchema,
  CancelRunResponse_Outcome,
  CompleteResultReviewResponseSchema,
  CreateIssueResponseSchema,
  CreateIssueMessageResponseSchema,
  DeleteIssueResponseSchema,
  DeleteIssueMessageResponseSchema,
  DispatchRunResponseSchema,
  GetIssueAgentReplyResponseSchema,
  IssueAgentReplySchema,
  IssueChangedField,
  IssueCreateProposalSchema,
  IssueExecutionProposalSchema,
  IssueExecutionDispatch_DispatchMode,
  IssueExecutionDispatch_Outcome,
  IssueExecutionDispatchSchema,
  IssueMessageSchema,
  IssueReworkProposalSchema,
  IssueUpdateChangesSchema,
  IssueUpdateProposalSchema,
  ListIssueMessagesResponseSchema,
  MoveRunResponse_Outcome,
  MoveRunResponseSchema,
  ProposedIssueSchema,
  ReassignRunResponseSchema,
  ReworkRunResponse_Outcome,
  ReworkRunResponseSchema,
  ResumeRunResponse_Outcome,
  ResumeRunResponseSchema,
  RetryRunResponseSchema,
  RetryRunResponse_Outcome,
  SetIssueDependencyResponse_Outcome,
  SetIssueDependencyResponseSchema,
  SetIssueSubscriptionResponseSchema,
  SyncIssueMessagesResponseSchema,
  TransferIssueResponse_Outcome,
  TransferIssueResponseSchema,
  UnassignRunResponse_Outcome,
  UnassignRunResponseSchema,
  UpdateIssueCheckpointsResponseSchema,
  UpdateIssueMessageResponseSchema,
  UpdateIssuePreferencesResponseSchema,
  UpdateIssueResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  WorkflowCheckpoint_Position,
  WorkflowCheckpointSpecSchema,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import * as Schema from "effect/Schema";
import {
  IssueCreateProposalAction,
  IssueUpdateProposalAction,
} from "./issue-request-contract";
import { ProjectAgentSessionInput } from "./project-request-contract";
import { strictSchema } from "./schema-codecs";

type CreateIssueResult = Awaited<
  ReturnType<typeof import("./issue-core-routes").createProjectIssue>
>;
type UpdateIssueResult = Awaited<
  ReturnType<typeof import("./issue-core-routes").updateProjectIssue>
>;
type DeleteIssueResult = Awaited<
  ReturnType<typeof import("./issue-core-routes").deleteProjectIssue>
>;
type SetSubscriptionResult = Awaited<
  ReturnType<
    typeof import("./issue-core-routes").setProjectIssueSubscription
  >
>;
type UpdatePreferencesResult = Awaited<
  ReturnType<
    typeof import("./issue-core-routes").updateProjectIssuePreferences
  >
>;
type SetDependencyResult = Awaited<
  ReturnType<typeof import("./issue-core-routes").setProjectIssueDependency>
>;
type CompleteReviewResult = Awaited<
  ReturnType<
    typeof import("./issue-core-routes").completeProjectIssueResultReview
  >
>;
type UpdateCheckpointsResult = Awaited<
  ReturnType<
    typeof import("./issue-core-routes").updateProjectIssueCheckpoints
  >
>;
type TransferIssueResult = Awaited<
  ReturnType<typeof import("./issue-control-routes").transferProjectIssue>
>;
type MoveRunResult = Awaited<
  ReturnType<typeof import("./issue-control-routes").moveProjectIssueRun>
>;
type RecoverRunResult = Awaited<
  ReturnType<typeof import("./issue-control-routes").recoverProjectIssueRun>
>;
type ResumeRunResult = Awaited<
  ReturnType<typeof import("./issue-control-routes").resumeProjectIssueRun>
>;
type DispatchRunResult = Awaited<
  ReturnType<typeof import("./issue-control-routes").dispatchProjectIssueRun>
>;
type ReworkRunResult = Awaited<
  ReturnType<typeof import("./issue-control-routes").reworkProjectIssueRun>
>;
type UnassignRunResult = Awaited<
  ReturnType<typeof import("./issue-control-routes").unassignProjectIssueRun>
>;

const internal = (message: string): never => {
  throw new ConnectError(message, Code.Internal);
};

const requiredTimestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return internal(`Invalid trusted ${field} timestamp`);
  }
  return timestampFromDate(date);
};

const optionalTimestamp = (
  value: string | null | undefined,
  field: string,
) => value == null ? undefined : requiredTimestamp(value, field);

const requiredUint32 = (
  value: number | null | undefined,
  field: string,
) => {
  if (!Number.isSafeInteger(value) || value == null || value < 0 || value > 0xffff_ffff) {
    return internal(`Invalid trusted ${field}`);
  }
  return value;
};

const requiredUint64 = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    return internal(`Invalid trusted ${field}`);
  }
  return BigInt(value);
};

const requiredString = (
  value: string | null | undefined,
  field: string,
) => typeof value === "string" && value.length > 0
  ? value
  : internal(`Invalid trusted ${field}`);

const provider = {
  codex: AgentProvider.CODEX,
  claude: AgentProvider.CLAUDE,
  cursor: AgentProvider.CURSOR,
  grok: AgentProvider.GROK,
  agy: AgentProvider.AGY,
  opencode: AgentProvider.OPENCODE,
  openrouter: AgentProvider.OPENROUTER,
} as const;

const appProvider = (value: keyof typeof provider) => provider[value];

const requiredAppProvider = (
  value: keyof typeof provider | null | undefined,
  field: string,
) => value == null ? internal(`Invalid trusted ${field}`) : appProvider(value);

const runStatus = {
  backlog: RunStatus.BACKLOG,
  queued: RunStatus.QUEUED,
  running: RunStatus.RUNNING,
  paused: RunStatus.PAUSED,
  blocked: RunStatus.BLOCKED,
  failed: RunStatus.FAILED,
  completed: RunStatus.COMPLETED,
  cancelled: RunStatus.CANCELLED,
} as const;

const appRunStatus = (value: keyof typeof runStatus) => runStatus[value];

const difficulty = {
  easy: IssueDifficulty.EASY,
  normal: IssueDifficulty.NORMAL,
  hard: IssueDifficulty.HARD,
} as const;

const appDifficulty = (value: keyof typeof difficulty | null | undefined) =>
  value == null ? undefined : difficulty[value];

const appIssueAttachment = (
  attachment: CreateIssueResult["attachments"][number],
) =>
  create(IssueAttachmentSchema, {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    byteSize: requiredUint64(attachment.byteSize, "attachment byte size"),
    url: attachment.url,
  });

export const appCreateIssueResponse = (result: CreateIssueResult) =>
  create(CreateIssueResponseSchema, {
    runId: result.runId,
    sourceKey: result.sourceKey,
    status: appRunStatus(result.status),
    stage: result.stage,
    attachments: result.attachments.map(appIssueAttachment),
    assigneeUserId: result.assigneeUserId ?? undefined,
    createdByUserId: result.createdByUserId,
    difficulty: appDifficulty(result.difficulty),
  });

export const appUpdateIssueResponse = (result: UpdateIssueResult) =>
  create(UpdateIssueResponseSchema, {
    runId: result.runId,
    title: result.title,
    description: result.description ?? undefined,
    priority: result.priority ?? undefined,
    difficulty: appDifficulty(result.difficulty),
    assigneeUserId: result.assigneeUserId ?? undefined,
    attachments: result.attachments.map(appIssueAttachment),
  });

export const appDeleteIssueResponse = (result: DeleteIssueResult) =>
  create(DeleteIssueResponseSchema, { deleted: result.deleted });

const transferOutcome = {
  transferred: TransferIssueResponse_Outcome.TRANSFERRED,
} as const satisfies Record<
  TransferIssueResult["outcome"],
  TransferIssueResponse_Outcome
>;

export const appTransferIssueResponse = (result: TransferIssueResult) =>
  create(TransferIssueResponseSchema, {
    runId: result.runId,
    sourceProjectId: result.sourceProjectId,
    targetProjectId: result.targetProjectId,
    outcome: transferOutcome[result.outcome],
  });

export const appSetIssueSubscriptionResponse = (
  result: SetSubscriptionResult,
) =>
  create(SetIssueSubscriptionResponseSchema, {
    runId: result.runId,
    subscribers: result.subscribers.map((subscriber) =>
      create(IssueSubscriberSchema, {
        userId: subscriber.userId,
        subscribedAt: requiredTimestamp(
          subscriber.subscribedAt,
          "issue subscription",
        ),
      })
    ),
  });

export const appUpdateIssuePreferencesResponse = (
  result: UpdatePreferencesResult,
) =>
  create(UpdateIssuePreferencesResponseSchema, {
    runId: result.runId,
    provider: result.provider == null ? undefined : appProvider(result.provider),
    model: result.model ?? undefined,
    effort: result.effort ?? undefined,
  });

const checkpointPosition = {
  before: WorkflowCheckpoint_Position.BEFORE,
  after: WorkflowCheckpoint_Position.AFTER,
} as const satisfies Record<
  UpdateCheckpointsResult["checkpoints"][number]["position"],
  WorkflowCheckpoint_Position
>;

export const appUpdateIssueCheckpointsResponse = (
  result: UpdateCheckpointsResult,
) =>
  create(UpdateIssueCheckpointsResponseSchema, {
    runId: result.runId,
    checkpoints: result.checkpoints.map((checkpoint) =>
      create(WorkflowCheckpointSpecSchema, {
        key: checkpoint.key,
        stage: checkpoint.stage,
        position: checkpointPosition[checkpoint.position],
      })
    ),
  });

const dependencyOutcome = {
  created: SetIssueDependencyResponse_Outcome.CREATED,
  already_exists: SetIssueDependencyResponse_Outcome.ALREADY_EXISTS,
  removed: SetIssueDependencyResponse_Outcome.REMOVED,
  already_removed: SetIssueDependencyResponse_Outcome.ALREADY_REMOVED,
} as const satisfies Record<
  SetDependencyResult["outcome"],
  SetIssueDependencyResponse_Outcome
>;

export const appSetIssueDependencyResponse = (result: SetDependencyResult) =>
  create(SetIssueDependencyResponseSchema, {
    prerequisiteRunId: result.prerequisiteRunId,
    dependentRunId: result.dependentRunId,
    outcome: dependencyOutcome[result.outcome],
  });

const appMoveOutcome = (outcome: MoveRunResult["outcome"]) => {
  switch (outcome) {
    case "moved":
      return MoveRunResponse_Outcome.MOVED;
    case "unchanged":
      return MoveRunResponse_Outcome.UNCHANGED;
    case "already_moved":
      return MoveRunResponse_Outcome.ALREADY_MOVED;
    case "not_found":
      return internal("Move application returned a not-found result");
  }
};

export const appMoveRunResponse = (result: MoveRunResult) => {
  if (result.status == null) return internal("Move result omitted run status");
  return create(MoveRunResponseSchema, {
    runId: result.runId,
    outcome: appMoveOutcome(result.outcome),
    status: appRunStatus(result.status),
    workflowStage: result.workflowStage ?? undefined,
  });
};

export const appRetryRunResponse = (result: RecoverRunResult) =>
  create(RetryRunResponseSchema, {
    runId: result.runId,
    outcome: result.outcome === "retried"
      ? RetryRunResponse_Outcome.RETRIED
      : result.outcome === "already_retried"
        ? RetryRunResponse_Outcome.ALREADY_RETRIED
        : internal("Retry application returned a cancellation outcome"),
    attempt: requiredUint32(result.attempt, "retry attempt"),
    status: RunStatus.QUEUED,
  });

export const appCancelRunResponse = (result: RecoverRunResult) =>
  create(CancelRunResponseSchema, {
    runId: result.runId,
    outcome: result.outcome === "cancelled"
      ? CancelRunResponse_Outcome.CANCELLED
      : result.outcome === "already_cancelled"
        ? CancelRunResponse_Outcome.ALREADY_CANCELLED
        : internal("Cancel application returned a retry outcome"),
    attempt: requiredUint32(result.attempt, "cancellation attempt"),
    status: RunStatus.CANCELLED,
  });

const appResumeOutcome = (outcome: ResumeRunResult["outcome"]) => {
  switch (outcome) {
    case "approved":
      return ResumeRunResponse_Outcome.APPROVED;
    case "already_approved":
      return ResumeRunResponse_Outcome.ALREADY_APPROVED;
    case "conflict":
      return internal("Resume application returned a conflict result");
    case "not_found":
      return internal("Resume application returned a not-found result");
  }
};

export const appResumeRunResponse = (result: ResumeRunResult) =>
  create(ResumeRunResponseSchema, {
    runId: result.runId,
    outcome: appResumeOutcome(result.outcome),
    workflowStage: result.workflowStage ?? undefined,
    startStage: result.startStage ?? undefined,
    checkpointKey: result.checkpointKey ?? undefined,
    attempt: result.attempt ?? undefined,
    revision: result.revision ?? undefined,
    terminalReviewOnly: result.terminalReviewOnly,
  });

const reworkOutcome = (outcome: ReworkRunResult["outcome"]) => {
  switch (outcome) {
    case "reworked":
      return ReworkRunResponse_Outcome.REWORKED;
    case "already_reworked":
      return ReworkRunResponse_Outcome.ALREADY_REWORKED;
    case "not_found":
      return internal("Rework application returned a not-found result");
  }
};

export const appReworkRunResponse = (result: ReworkRunResult) =>
  create(ReworkRunResponseSchema, {
    runId: result.runId,
    outcome: reworkOutcome(result.outcome),
    attempt: requiredUint32(result.attempt, "rework attempt"),
    revision: requiredUint32(result.revision, "rework revision"),
    workflowStage: requiredString(
      result.workflowStage,
      "rework workflow stage",
    ),
  });

const unassignOutcome = {
  unassigned: UnassignRunResponse_Outcome.UNASSIGNED,
  not_assigned: UnassignRunResponse_Outcome.NOT_ASSIGNED,
} as const satisfies Record<
  UnassignRunResult["outcome"],
  UnassignRunResponse_Outcome
>;

export const appUnassignRunResponse = (result: UnassignRunResult) =>
  create(UnassignRunResponseSchema, {
    runId: result.runId,
    outcome: unassignOutcome[result.outcome],
  });

const appDispatchMode = (value: string) => {
  switch (value) {
    case "any":
      return IssueExecutionDispatch_DispatchMode.ANY;
    case "specific":
      return IssueExecutionDispatch_DispatchMode.SPECIFIC;
    default:
      return internal("Invalid trusted issue dispatch mode");
  }
};

const appDispatchOutcome = (value: string) => {
  switch (value) {
    case "dispatched":
      return IssueExecutionDispatch_Outcome.DISPATCHED;
    case "already_dispatched":
      return IssueExecutionDispatch_Outcome.ALREADY_DISPATCHED;
    default:
      return internal("Invalid trusted issue dispatch outcome");
  }
};

export const appIssueExecutionDispatch = (
  result: DispatchRunResult | AcceptExecutionResult["dispatch"],
) =>
  create(IssueExecutionDispatchSchema, {
    runId: result.runId,
    agentId: result.agentId ?? undefined,
    provider: requiredAppProvider(result.provider, "issue dispatch provider"),
    model: result.model ?? undefined,
    effort: result.effort ?? undefined,
    requestedWorkerId: result.requestedWorkerId ?? undefined,
    requestedByUserId: requiredString(
      result.requestedByUserId,
      "issue dispatch requester",
    ),
    dispatchMode: appDispatchMode(result.dispatchMode),
    dispatchedAt: requiredTimestamp(
      requiredString(result.dispatchedAt, "issue dispatch timestamp"),
      "issue dispatch",
    ),
    outcome: appDispatchOutcome(result.outcome),
  });

export const appDispatchRunResponse = (result: DispatchRunResult) =>
  create(DispatchRunResponseSchema, {
    dispatch: appIssueExecutionDispatch(result),
  });

export const appReassignRunResponse = (result: DispatchRunResult) =>
  create(ReassignRunResponseSchema, {
    dispatch: appIssueExecutionDispatch(result),
  });

export const appCompleteResultReviewResponse = (
  result: CompleteReviewResult,
) =>
  create(CompleteResultReviewResponseSchema, {
    review: create(ResultReviewSchema, {
      userId: result.userId,
      name: result.name,
      username: result.username ?? undefined,
      image: result.image ?? undefined,
      completedAt: requiredTimestamp(result.completedAt, "result review"),
    }),
  });

// Exported for proposal response mappers added below; keeping the enum mapping
// here makes the generated wire enum the only transport representation.
export const appApprovalOutcome = (
  value: "accepted" | "already_accepted",
) => value === "accepted"
  ? ApprovalOutcome.ACCEPTED
  : ApprovalOutcome.ALREADY_ACCEPTED;

type ConversationSnapshot = Awaited<
  ReturnType<
    typeof import("./issue-conversation-routes").listProjectIssueMessages
  >
>;
type SyncConversationResult = Awaited<
  ReturnType<
    typeof import("./issue-conversation-routes").syncProjectIssueMessages
  >
>;
type SyncConversationWithSnapshot = SyncConversationResult &
  Partial<Pick<ConversationSnapshot, "messages" | "agentReplies">>;
type IssueMessageResult = ConversationSnapshot["messages"][number];
type IssueAgentReplyResult = ConversationSnapshot["agentReplies"][number];
type CreateMessageResult = Awaited<
  ReturnType<
    typeof import("./issue-conversation-routes").createProjectIssueMessage
  >
>;
type UpdateMessageResult = Awaited<
  ReturnType<
    typeof import("./issue-conversation-routes").updateProjectIssueMessage
  >
>;
type DeleteMessageResult = Awaited<
  ReturnType<
    typeof import("./issue-conversation-routes").deleteProjectIssueMessage
  >
>;
type GetAgentReplyResult = Awaited<
  ReturnType<
    typeof import("./issue-conversation-routes").getProjectIssueAgentReply
  >
>;
type AcceptReworkResult = Awaited<
  ReturnType<
    typeof import("./issue-proposal-routes").acceptProjectIssueReworkProposal
  >
>;
type AcceptActionResult = Awaited<
  ReturnType<
    typeof import("./issue-proposal-routes").acceptProjectIssueActionProposal
  >
>;
type AcceptExecutionResult = Awaited<
  ReturnType<
    typeof import("./issue-proposal-routes").acceptProjectIssueExecutionProposal
  >
>;
type AcceptSkillExecutionResult = Awaited<
  ReturnType<
    typeof import("./issue-proposal-routes").acceptProjectIssueSkillExecutionProposal
  >
>;
type IssueExecutionProposalResult = NonNullable<
  IssueMessageResult["executionProposal"]
>;
type AgentSkillExecutionProposalResult = NonNullable<
  IssueMessageResult["skillExecutionProposal"]
>;
type ProjectAgentSessionResult = NonNullable<
  AcceptSkillExecutionResult["session"]
>;

const proposalStatus = {
  pending: ProposalStatus.PENDING,
  accepted: ProposalStatus.ACCEPTED,
  declined: ProposalStatus.DECLINED,
} as const;

const appProposalStatus = (value: keyof typeof proposalStatus) =>
  proposalStatus[value];

const replyJobStatus = {
  queued: ReplyJobStatus.QUEUED,
  running: ReplyJobStatus.RUNNING,
  completed: ReplyJobStatus.COMPLETED,
  failed: ReplyJobStatus.FAILED,
} as const satisfies Record<IssueAgentReplyResult["status"], ReplyJobStatus>;

const trustedProposalMetadata = {
  id: Schema.String,
  status: Schema.Literals(["pending", "accepted", "declined"]),
  acceptedAt: Schema.NullOr(Schema.String),
  resultRunId: Schema.NullOr(Schema.String),
};

const TrustedReworkProposal = strictSchema(Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("request_issue_rework"),
  workflowStage: Schema.String,
  reason: Schema.String,
  status: Schema.Literals(["pending", "accepted", "declined"]),
  acceptedAt: Schema.NullOr(Schema.String),
  appliedRevision: Schema.NullOr(Schema.Int),
}));

const TrustedUpdateProposal = strictSchema(Schema.Struct({
  ...IssueUpdateProposalAction.fields,
  ...trustedProposalMetadata,
  changedFields: Schema.Array(
    Schema.Literals(["title", "description", "priority"]),
  ),
}));

const TrustedCreateProposal = strictSchema(Schema.Struct({
  ...IssueCreateProposalAction.fields,
  ...trustedProposalMetadata,
}));

const TrustedProposedAction = Schema.Union([
  TrustedReworkProposal,
  TrustedUpdateProposal,
  TrustedCreateProposal,
]);
type TrustedProposedAction = typeof TrustedProposedAction.Type;

const decodeTrustedProposedAction = Schema.decodeUnknownSync(
  TrustedProposedAction,
);

const trustedProposedAction = (value: unknown) => {
  try {
    return decodeTrustedProposedAction(value);
  } catch {
    return internal("Issue application returned an invalid proposed action");
  }
};

const appIssueReworkProposal = (
  proposal: Extract<
    TrustedProposedAction,
    { readonly type: "request_issue_rework" }
  >,
) =>
  create(IssueReworkProposalSchema, {
    id: proposal.id,
    workflowStage: proposal.workflowStage,
    reason: proposal.reason,
    status: appProposalStatus(proposal.status),
    acceptedAt: optionalTimestamp(proposal.acceptedAt, "rework acceptance"),
    appliedRevision: proposal.appliedRevision ?? undefined,
  });

const changedField = {
  title: IssueChangedField.TITLE,
  description: IssueChangedField.DESCRIPTION,
  priority: IssueChangedField.PRIORITY,
} as const satisfies Record<
  Extract<
    TrustedProposedAction,
    { readonly type: "request_issue_update" }
  >["changedFields"][number],
  IssueChangedField
>;

const appIssueUpdateProposal = (
  proposal: Extract<
    TrustedProposedAction,
    { readonly type: "request_issue_update" }
  >,
) =>
  create(IssueUpdateProposalSchema, {
    id: proposal.id,
    changes: create(IssueUpdateChangesSchema, {
      title: proposal.changes.title,
      description: proposal.changes.description ?? undefined,
      priority: proposal.changes.priority ?? undefined,
    }),
    changedFields: proposal.changedFields.map((field) => changedField[field]),
    status: appProposalStatus(proposal.status),
    acceptedAt: optionalTimestamp(proposal.acceptedAt, "update acceptance"),
    resultRunId: proposal.resultRunId ?? undefined,
  });

const appIssueCreateProposal = (
  proposal: Extract<
    TrustedProposedAction,
    { readonly type: "request_issue_create" }
  >,
) =>
  create(IssueCreateProposalSchema, {
    id: proposal.id,
    issue: create(ProposedIssueSchema, {
      title: proposal.issue.title,
      description: proposal.issue.description ?? undefined,
      priority: proposal.issue.priority ?? undefined,
      status: appRunStatus(proposal.issue.status),
    }),
    executeAfterCreate: proposal.executeAfterCreate,
    status: appProposalStatus(proposal.status),
    acceptedAt: optionalTimestamp(proposal.acceptedAt, "create acceptance"),
    resultRunId: proposal.resultRunId ?? undefined,
  });

const appIssueExecutionProposal = (
  proposal: IssueExecutionProposalResult,
) =>
  create(IssueExecutionProposalSchema, {
    id: proposal.id,
    status: appProposalStatus(proposal.status),
    projectId: proposal.projectId,
    runId: proposal.runId,
    title: proposal.title,
    createdAt: requiredTimestamp(proposal.createdAt, "execution proposal creation"),
    acceptedAt: optionalTimestamp(
      proposal.acceptedAt,
      "execution proposal acceptance",
    ),
    requestedProvider: proposal.requestedProvider == null
      ? undefined
      : appProvider(proposal.requestedProvider),
    requestedModel: proposal.requestedModel ?? undefined,
    requestedEffort: proposal.requestedEffort ?? undefined,
    requestedWorkerId: proposal.requestedWorkerId ?? undefined,
    delegatedByAgentId: proposal.delegatedByAgentId ?? undefined,
    delegatedByAgentName: proposal.delegatedByAgentName ?? undefined,
  });

const skillExecutionMode = {
  conversation: AgentSkillExecutionMode.CONVERSATION,
  task: AgentSkillExecutionMode.TASK,
} as const satisfies Record<
  AgentSkillExecutionProposalResult["executionMode"],
  AgentSkillExecutionMode
>;

const skillApprovalPolicy = {
  invoke_is_consent: AgentSkillApprovalPolicy.INVOKE_IS_CONSENT,
  explicit: AgentSkillApprovalPolicy.EXPLICIT,
} as const satisfies Record<
  AgentSkillExecutionProposalResult["approvalPolicy"],
  AgentSkillApprovalPolicy
>;

const skillExecutionStatus = {
  waiting: AgentSkillExecutionStatus.WAITING,
  running: AgentSkillExecutionStatus.RUNNING,
  completed: AgentSkillExecutionStatus.COMPLETED,
  failed: AgentSkillExecutionStatus.FAILED,
} as const satisfies Record<
  AgentSkillExecutionProposalResult["executionStatus"],
  AgentSkillExecutionStatus
>;

const appAgentSkillExecutionProposal = (
  proposal: AgentSkillExecutionProposalResult,
) =>
  create(AgentSkillExecutionProposalSchema, {
    id: proposal.id,
    status: appProposalStatus(proposal.status),
    projectId: proposal.projectId,
    agentId: proposal.agentId,
    agentName: proposal.agentName,
    skillId: proposal.skillId,
    skillName: proposal.skillName,
    request: proposal.request,
    provider: appProvider(proposal.provider),
    model: proposal.model ?? undefined,
    effort: proposal.effort ?? undefined,
    executionMode: skillExecutionMode[proposal.executionMode],
    approvalPolicy: skillApprovalPolicy[proposal.approvalPolicy],
    executionStatus: skillExecutionStatus[proposal.executionStatus],
    createdAt: requiredTimestamp(proposal.createdAt, "skill proposal creation"),
    acceptedAt: optionalTimestamp(
      proposal.acceptedAt,
      "skill proposal acceptance",
    ),
    requestedWorkerId: proposal.requestedWorkerId ?? undefined,
    requestedWorkerLabel: proposal.requestedWorkerLabel ?? undefined,
    resultSessionId: proposal.resultSessionId ?? undefined,
    resultMessageId: proposal.resultMessageId ?? undefined,
    error: proposal.error ?? undefined,
    delegatedByAgentId: proposal.delegatedByAgentId ?? undefined,
    delegatedByAgentName: proposal.delegatedByAgentName ?? undefined,
  });

const appMessageAuthor = (author: IssueMessageResult["author"]) =>
  create(MessageAuthorSchema, {
    id: author.id ?? undefined,
    agentId: author.agentId ?? undefined,
    name: author.name,
    image: author.image ?? undefined,
    provider: author.provider == null ? undefined : appProvider(author.provider),
  });

const appIssueMessage = (message: IssueMessageResult) => {
  const proposal = message.proposedAction == null
    ? undefined
    : trustedProposedAction(message.proposedAction);
  const proposedAction = proposal === undefined
    ? { case: undefined } as const
    : proposal.type === "request_issue_rework"
    ? { case: "reworkProposal", value: appIssueReworkProposal(proposal) } as const
    : proposal.type === "request_issue_update"
    ? { case: "updateProposal", value: appIssueUpdateProposal(proposal) } as const
    : { case: "createProposal", value: appIssueCreateProposal(proposal) } as const;
  return create(IssueMessageSchema, {
    id: message.id,
    runId: message.runId,
    parentMessageId: message.parentMessageId ?? undefined,
    body: message.body,
    attachments: message.attachments.map(appIssueAttachment),
    author: appMessageAuthor(message.author),
    replyCount: message.replyCount,
    proposedAction,
    executionProposal: message.executionProposal == null
      ? undefined
      : appIssueExecutionProposal(message.executionProposal),
    skillExecutionProposal: message.skillExecutionProposal == null
      ? undefined
      : appAgentSkillExecutionProposal(message.skillExecutionProposal),
    createdAt: requiredTimestamp(message.createdAt, "issue message creation"),
    updatedAt: requiredTimestamp(message.updatedAt, "issue message update"),
  });
};

const appIssueAgentReply = (reply: IssueAgentReplyResult) =>
  create(IssueAgentReplySchema, {
    id: reply.id,
    triggerMessageId: reply.triggerMessageId,
    parentMessageId: reply.parentMessageId,
    agentId: reply.agentId ?? undefined,
    agentName: reply.agentName ?? undefined,
    status: replyJobStatus[reply.status],
    attempts: reply.attempts,
    error: reply.error ?? undefined,
    workerId: reply.workerId ?? undefined,
    provider: reply.provider == null ? undefined : appProvider(reply.provider),
    updatedAt: requiredTimestamp(reply.updatedAt, "agent reply update"),
  });

export const appListIssueMessagesResponse = (result: ConversationSnapshot) =>
  create(ListIssueMessagesResponseSchema, {
    cursor: requiredUint64(result.cursor, "conversation cursor"),
    messages: result.messages.map(appIssueMessage),
    agentReplies: result.agentReplies.map(appIssueAgentReply),
  });

export const appSyncIssueMessagesResponse = (
  result: SyncConversationWithSnapshot,
) =>
  create(SyncIssueMessagesResponseSchema, {
    cursor: requiredUint64(result.cursor, "conversation cursor"),
    hasMore: result.hasMore,
    changed: result.changed,
    reset: false,
    messages: (result.messages ?? []).map(appIssueMessage),
    agentReplies: (result.agentReplies ?? []).map(appIssueAgentReply),
  });

export const appResetIssueMessagesResponse = (snapshot: ConversationSnapshot) =>
  create(SyncIssueMessagesResponseSchema, {
    cursor: requiredUint64(snapshot.cursor, "conversation cursor"),
    hasMore: false,
    changed: true,
    reset: true,
    messages: snapshot.messages.map(appIssueMessage),
    agentReplies: snapshot.agentReplies.map(appIssueAgentReply),
  });

export const appCreateIssueMessageResponse = (result: CreateMessageResult) =>
  create(CreateIssueMessageResponseSchema, {
    message: appIssueMessage(result.message),
    agentReplies: result.agentReplies.map(appIssueAgentReply),
    agentReply: result.agentReply == null
      ? undefined
      : appIssueAgentReply(result.agentReply),
  });

export const appUpdateIssueMessageResponse = (result: UpdateMessageResult) =>
  create(UpdateIssueMessageResponseSchema, {
    message: appIssueMessage(result.message),
  });

export const appDeleteIssueMessageResponse = (result: DeleteMessageResult) =>
  create(DeleteIssueMessageResponseSchema, { deleted: result.deleted });

export const appGetIssueAgentReplyResponse = (result: GetAgentReplyResult) =>
  create(GetIssueAgentReplyResponseSchema, {
    agentReply: appIssueAgentReply(result.agentReply),
    agentReplies: result.agentReplies.map(appIssueAgentReply),
    messages: result.messages.map(appIssueMessage),
    message: result.message == null ? undefined : appIssueMessage(result.message),
  });

export const appAcceptIssueReworkProposalResponse = (
  result: AcceptReworkResult,
) => {
  const proposal = trustedProposedAction(result.proposal);
  if (proposal.type !== "request_issue_rework") {
    return internal("Rework approval returned a different proposal kind");
  }
  return create(AcceptIssueReworkProposalResponseSchema, {
    proposal: appIssueReworkProposal(proposal),
    outcome: appApprovalOutcome(result.outcome),
    attempt: requiredUint32(result.attempt, "rework attempt"),
    revision: requiredUint32(result.revision, "rework revision"),
    workflowStage: requiredString(result.workflowStage, "rework workflow stage"),
  });
};

export const appAcceptIssueActionProposalResponse = (
  result: AcceptActionResult,
) => {
  const proposal = trustedProposedAction(result.proposal);
  const proposalOneof = proposal.type === "request_issue_update"
    ? { case: "update", value: appIssueUpdateProposal(proposal) } as const
    : proposal.type === "request_issue_create"
    ? { case: "create", value: appIssueCreateProposal(proposal) } as const
    : internal("Issue action approval returned a rework proposal");
  const executionProposal = "executionProposal" in result
    ? result.executionProposal
    : undefined;
  return create(AcceptIssueActionProposalResponseSchema, {
    proposal: proposalOneof,
    outcome: appApprovalOutcome(result.outcome),
    resultRunId: result.resultRunId ?? undefined,
    executionProposal: executionProposal == null
      ? undefined
      : appIssueExecutionProposal(executionProposal),
  });
};

export const appAcceptIssueExecutionProposalResponse = (
  result: AcceptExecutionResult,
) =>
  create(AcceptIssueExecutionProposalResponseSchema, {
    proposal: appIssueExecutionProposal(result.proposal),
    outcome: appApprovalOutcome(result.outcome),
    projectId: result.projectId,
    runId: result.runId,
    dispatch: appIssueExecutionDispatch(result.dispatch),
  });

const projectAgentSessionType = {
  task: ProjectAgentSessionType.TASK,
  dispatch: ProjectAgentSessionType.DISPATCH,
} as const;

const projectAgentSessionTrigger = {
  manual: ProjectAgentSessionTrigger.MANUAL,
  scheduled: ProjectAgentSessionTrigger.SCHEDULED,
} as const;

const projectAgentSessionStatus = {
  running: ProjectAgentSessionStatus.RUNNING,
  completed: ProjectAgentSessionStatus.COMPLETED,
  failed: ProjectAgentSessionStatus.FAILED,
  skipped: ProjectAgentSessionStatus.SKIPPED,
  interrupted: ProjectAgentSessionStatus.INTERRUPTED,
} as const;

const projectAgentSessionIssueOutcome = {
  pending: ProjectAgentSessionIssueOutcome.PENDING,
  completed: ProjectAgentSessionIssueOutcome.COMPLETED,
  blocked: ProjectAgentSessionIssueOutcome.BLOCKED,
  failed: ProjectAgentSessionIssueOutcome.FAILED,
  skipped: ProjectAgentSessionIssueOutcome.SKIPPED,
} as const;

const projectAgentSessionEventType = {
  started: ProjectAgentSessionEventType.STARTED,
  completed: ProjectAgentSessionEventType.COMPLETED,
  failed: ProjectAgentSessionEventType.FAILED,
  skipped: ProjectAgentSessionEventType.SKIPPED,
  interrupted: ProjectAgentSessionEventType.INTERRUPTED,
  stopped: ProjectAgentSessionEventType.STOPPED,
} as const;

const TrustedProjectAgentSession = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  requestedByUserId: Schema.NullOr(Schema.String),
  ...ProjectAgentSessionInput.fields,
});
const decodeTrustedProjectAgentSession = Schema.decodeUnknownSync(
  TrustedProjectAgentSession,
);

const appProjectAgentSession = (session: ProjectAgentSessionResult) => {
  let decoded: typeof TrustedProjectAgentSession.Type;
  try {
    decoded = decodeTrustedProjectAgentSession(session);
  } catch {
    return internal("Issue application returned an invalid Agent session");
  }
  return create(ProjectAgentSessionSchema, {
    id: decoded.id,
    projectId: decoded.projectId,
    dispatchGroupId: decoded.dispatchGroupId,
    agentId: decoded.agentId ?? undefined,
    agentName: decoded.agentName ?? undefined,
    skillId: decoded.skillId ?? undefined,
    sessionType: projectAgentSessionType[decoded.sessionType],
    trigger: decoded.trigger == null
      ? undefined
      : projectAgentSessionTrigger[decoded.trigger],
    scheduleId: decoded.scheduleId ?? undefined,
    scheduleRunId: decoded.scheduleRunId ?? undefined,
    parentSessionId: decoded.parentSessionId ?? undefined,
    request: decoded.request ?? undefined,
    followUps: decoded.followUps.map((followUp) =>
      create(ProjectAgentSessionFollowUpSchema, {
        id: followUp.id,
        message: followUp.message,
        sentAt: requiredTimestamp(followUp.sentAt, "Agent follow-up"),
      })
    ),
    status: projectAgentSessionStatus[decoded.status],
    issues: decoded.issues.map((issue) =>
      create(ProjectAgentSessionIssueSchema, {
        runId: issue.runId,
        runNumber: issue.runNumber,
        sourceKey: issue.sourceKey,
        title: issue.title,
        outcome: projectAgentSessionIssueOutcome[issue.outcome],
        summary: issue.summary ?? undefined,
      })
    ),
    startedAt: requiredTimestamp(decoded.startedAt, "Agent session start"),
    completedAt: optionalTimestamp(decoded.completedAt, "Agent session completion"),
    conversationId: decoded.conversationId ?? undefined,
    requestedWorkerId: decoded.requestedWorkerId ?? undefined,
    workerId: decoded.workerId ?? undefined,
    requestedByUserId: decoded.requestedByUserId ?? undefined,
    summary: decoded.summary ?? undefined,
    error: decoded.error ?? undefined,
    events: decoded.events.map((event) =>
      create(ProjectAgentSessionEventSchema, {
        id: event.id,
        type: projectAgentSessionEventType[event.type],
        occurredAt: requiredTimestamp(event.occurredAt, "Agent session event"),
      })
    ),
    updatedAt: requiredTimestamp(decoded.updatedAt, "Agent session update"),
    archived: false,
  });
};

export const appAcceptIssueSkillExecutionProposalResponse = (
  result: AcceptSkillExecutionResult,
) =>
  create(AcceptIssueSkillExecutionProposalResponseSchema, {
    outcome: appApprovalOutcome(result.outcome),
    proposal: appAgentSkillExecutionProposal(result.proposal),
    projectId: result.projectId,
    session: result.session == null
      ? undefined
      : appProjectAgentSession(result.session),
  });
