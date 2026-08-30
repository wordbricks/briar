import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ApprovalOutcome,
  IssueAttachmentSchema,
  IssueDifficulty,
  IssueSubscriberSchema,
  ResultReviewSchema,
  RunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  CancelRunResponseSchema,
  CompleteResultReviewResponseSchema,
  CreateIssueResponseSchema,
  DeleteIssueResponseSchema,
  DispatchRunResponseSchema,
  IssueExecutionDispatch_DispatchMode,
  IssueExecutionDispatch_Outcome,
  IssueExecutionDispatchSchema,
  MoveRunResponse_Outcome,
  MoveRunResponseSchema,
  ReassignRunResponseSchema,
  ResumeRunResponse_Outcome,
  ResumeRunResponseSchema,
  RetryRunResponseSchema,
  SetIssueDependencyResponse_Outcome,
  SetIssueDependencyResponseSchema,
  SetIssueSubscriptionResponseSchema,
  TransferIssueResponse_Outcome,
  TransferIssueResponseSchema,
  UpdateIssuePreferencesResponseSchema,
  UpdateIssueResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { Code, ConnectError } from "@connectrpc/connect";

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

const moveOutcome = {
  moved: MoveRunResponse_Outcome.MOVED,
  unchanged: MoveRunResponse_Outcome.UNCHANGED,
  already_moved: MoveRunResponse_Outcome.ALREADY_MOVED,
} as const satisfies Record<MoveRunResult["outcome"], MoveRunResponse_Outcome>;

export const appMoveRunResponse = (result: MoveRunResult) => {
  if (result.status == null) return internal("Move result omitted run status");
  return create(MoveRunResponseSchema, {
    runId: result.runId,
    outcome: moveOutcome[result.outcome],
    status: appRunStatus(result.status),
    workflowStage: result.workflowStage ?? undefined,
  });
};

export const appRetryRunResponse = (result: RecoverRunResult) =>
  create(RetryRunResponseSchema, {
    runId: result.runId,
    outcome: result.outcome,
    attempt: requiredUint32(result.attempt, "retry attempt"),
    status: RunStatus.QUEUED,
  });

export const appCancelRunResponse = (result: RecoverRunResult) =>
  create(CancelRunResponseSchema, {
    runId: result.runId,
    outcome: result.outcome,
    attempt: requiredUint32(result.attempt, "cancellation attempt"),
    status: RunStatus.CANCELLED,
  });

const resumeOutcome = {
  approved: ResumeRunResponse_Outcome.APPROVED,
  already_approved: ResumeRunResponse_Outcome.ALREADY_APPROVED,
  resumed: ResumeRunResponse_Outcome.RESUMED,
  already_resumed: ResumeRunResponse_Outcome.ALREADY_RESUMED,
} as const satisfies Record<
  ResumeRunResult["outcome"],
  ResumeRunResponse_Outcome
>;

export const appResumeRunResponse = (result: ResumeRunResult) =>
  create(ResumeRunResponseSchema, {
    runId: result.runId,
    outcome: resumeOutcome[result.outcome],
    workflowStage: result.workflowStage ?? undefined,
    startStage: result.startStage ?? undefined,
    checkpointKey: result.checkpointKey ?? undefined,
    attempt: result.attempt ?? undefined,
    revision: result.revision ?? undefined,
    terminalReviewOnly: result.terminalReviewOnly,
  });

const dispatchMode = {
  any: IssueExecutionDispatch_DispatchMode.ANY,
  specific: IssueExecutionDispatch_DispatchMode.SPECIFIC,
} as const satisfies Record<
  DispatchRunResult["dispatchMode"],
  IssueExecutionDispatch_DispatchMode
>;

const dispatchOutcome = {
  dispatched: IssueExecutionDispatch_Outcome.DISPATCHED,
  already_dispatched: IssueExecutionDispatch_Outcome.ALREADY_DISPATCHED,
} as const satisfies Record<
  DispatchRunResult["outcome"],
  IssueExecutionDispatch_Outcome
>;

export const appIssueExecutionDispatch = (result: DispatchRunResult) =>
  create(IssueExecutionDispatchSchema, {
    runId: result.runId,
    agentId: result.agentId ?? undefined,
    provider: appProvider(result.provider),
    model: result.model ?? undefined,
    effort: result.effort ?? undefined,
    requestedWorkerId: result.requestedWorkerId ?? undefined,
    requestedByUserId: result.requestedByUserId,
    dispatchMode: dispatchMode[result.dispatchMode],
    dispatchedAt: requiredTimestamp(result.dispatchedAt, "issue dispatch"),
    outcome: dispatchOutcome[result.outcome],
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
