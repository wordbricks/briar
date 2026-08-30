import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  IssueService,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  IssueDifficulty,
  RunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  WorkflowCheckpoint_Position,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import { agentSkillConflictMessage } from "./agent-skills";
import {
  appAcceptIssueActionProposalResponse,
  appAcceptIssueExecutionProposalResponse,
  appAcceptIssueReworkProposalResponse,
  appAcceptIssueSkillExecutionProposalResponse,
  appCancelRunResponse,
  appCompleteResultReviewResponse,
  appCreateIssueResponse,
  appCreateIssueMessageResponse,
  appDeleteIssueResponse,
  appDispatchRunResponse,
  appGetIssueAgentReplyResponse,
  appListIssueMessagesResponse,
  appMoveRunResponse,
  appReassignRunResponse,
  appResetIssueMessagesResponse,
  appResumeRunResponse,
  appRetryRunResponse,
  appSetIssueDependencyResponse,
  appSetIssueSubscriptionResponse,
  appSyncIssueMessagesResponse,
  appTransferIssueResponse,
  appUpdateIssuePreferencesResponse,
  appUpdateIssueResponse,
} from "./app-connect-issue-mappers";
import type { BriarAuth } from "./auth";
import {
  createProjectIssueMessage,
  getProjectIssueAgentReply,
  listProjectIssueMessages,
  syncProjectIssueMessages,
} from "./issue-conversation-routes";
import {
  dispatchProjectIssueRun,
  moveProjectIssueRun,
  recoverProjectIssueRun,
  resumeProjectIssueRun,
  transferProjectIssue,
} from "./issue-control-routes";
import {
  completeProjectIssueResultReview,
  createProjectIssue,
  deleteProjectIssue,
  setProjectIssueDependency,
  setProjectIssueSubscription,
  updateProjectIssue,
  updateProjectIssuePreferences,
} from "./issue-core-routes";
import { HttpError } from "./http-response";
import {
  acceptProjectIssueActionProposal,
  acceptProjectIssueExecutionProposal,
  acceptProjectIssueReworkProposal,
  acceptProjectIssueSkillExecutionProposal,
} from "./issue-proposal-routes";
import {
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { RequestDecodeError, decodeRequestSync } from "./request-schema";
import { runEvidenceResponseMessage } from "./run-evidence-connect";
import { listProjectRunEvidence } from "./run-evidence-routes";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { WorkerConflictError } from "./workers";

export type AppConnectIssueRouteInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectIssueServices = {
  readonly acceptActionProposal: typeof acceptProjectIssueActionProposal;
  readonly acceptExecutionProposal: typeof acceptProjectIssueExecutionProposal;
  readonly acceptReworkProposal: typeof acceptProjectIssueReworkProposal;
  readonly acceptSkillExecutionProposal:
    typeof acceptProjectIssueSkillExecutionProposal;
  readonly completeResultReview: typeof completeProjectIssueResultReview;
  readonly createIssue: typeof createProjectIssue;
  readonly createMessage: typeof createProjectIssueMessage;
  readonly deleteIssue: typeof deleteProjectIssue;
  readonly dispatchRun: typeof dispatchProjectIssueRun;
  readonly getAgentReply: typeof getProjectIssueAgentReply;
  readonly listEvidence: typeof listProjectRunEvidence;
  readonly listMessages: typeof listProjectIssueMessages;
  readonly moveRun: typeof moveProjectIssueRun;
  readonly recoverRun: typeof recoverProjectIssueRun;
  readonly requireSession: typeof requireSession;
  readonly resumeRun: typeof resumeProjectIssueRun;
  readonly setDependency: typeof setProjectIssueDependency;
  readonly setSubscription: typeof setProjectIssueSubscription;
  readonly syncMessages: typeof syncProjectIssueMessages;
  readonly transferIssue: typeof transferProjectIssue;
  readonly updateIssue: typeof updateProjectIssue;
  readonly updatePreferences: typeof updateProjectIssuePreferences;
};

export const appConnectIssueServices: AppConnectIssueServices = {
  acceptActionProposal: acceptProjectIssueActionProposal,
  acceptExecutionProposal: acceptProjectIssueExecutionProposal,
  acceptReworkProposal: acceptProjectIssueReworkProposal,
  acceptSkillExecutionProposal: acceptProjectIssueSkillExecutionProposal,
  completeResultReview: completeProjectIssueResultReview,
  createIssue: createProjectIssue,
  createMessage: createProjectIssueMessage,
  deleteIssue: deleteProjectIssue,
  dispatchRun: dispatchProjectIssueRun,
  getAgentReply: getProjectIssueAgentReply,
  listEvidence: listProjectRunEvidence,
  listMessages: listProjectIssueMessages,
  moveRun: moveProjectIssueRun,
  recoverRun: recoverProjectIssueRun,
  requireSession,
  resumeRun: resumeProjectIssueRun,
  setDependency: setProjectIssueDependency,
  setSubscription: setProjectIssueSubscription,
  syncMessages: syncProjectIssueMessages,
  transferIssue: transferProjectIssue,
  updateIssue: updateProjectIssue,
  updatePreferences: updateProjectIssuePreferences,
};

const decodeUuid = decodeRequestSync(UuidString);

const canonicalUuid = (value: string) => decodeUuid(value).toLowerCase();

const connectCodeFromHttpStatus = (status: number): Code => {
  switch (status) {
    case 400:
    case 411:
    case 422:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
    case 428:
      return Code.FailedPrecondition;
    case 410:
      return Code.OutOfRange;
    case 413:
    case 429:
      return Code.ResourceExhausted;
    case 501:
      return Code.Unimplemented;
    case 503:
      return Code.Unavailable;
    default:
      return Code.Internal;
  }
};

const toConnectError = (error: unknown): ConnectError => {
  if (error instanceof ConnectError) return error;
  if (error instanceof HttpError) {
    return new ConnectError(
      error.message,
      connectCodeFromHttpStatus(error.status),
      undefined,
      undefined,
      error,
    );
  }
  if (error instanceof RequestDecodeError) {
    return new ConnectError(
      "Invalid request",
      Code.InvalidArgument,
      undefined,
      undefined,
      error,
    );
  }
  if (error instanceof WorkerConflictError) {
    return new ConnectError(
      error.message,
      Code.FailedPrecondition,
      undefined,
      undefined,
      error,
    );
  }
  const skillConflict = agentSkillConflictMessage(error);
  if (skillConflict) {
    return new ConnectError(
      skillConflict,
      Code.FailedPrecondition,
      undefined,
      undefined,
      error,
    );
  }
  return new ConnectError(
    "Internal server error",
    Code.Internal,
    undefined,
    undefined,
    error,
  );
};

const rpc = async <A>(run: () => Promise<A>): Promise<A> => {
  try {
    return await run();
  } catch (error) {
    throw toConnectError(error);
  }
};

const providerJson = (provider: AgentProvider) => {
  switch (provider) {
    case AgentProvider.CODEX:
      return "codex";
    case AgentProvider.CLAUDE:
      return "claude";
    case AgentProvider.CURSOR:
      return "cursor";
    case AgentProvider.GROK:
      return "grok";
    case AgentProvider.AGY:
      return "agy";
    case AgentProvider.OPENCODE:
      return "opencode";
    case AgentProvider.OPENROUTER:
      return "openrouter";
    case AgentProvider.UNSPECIFIED:
      return undefined;
  }
};

const optionalProviderBody = (provider: AgentProvider) => {
  const value = providerJson(provider);
  return value === undefined ? {} : { provider: value };
};

const requiredProviderJson = (provider: AgentProvider) => {
  const value = providerJson(provider);
  if (value === undefined) {
    throw new ConnectError("Agent provider is required", Code.InvalidArgument);
  }
  return value;
};

const runStatusJson = (status: RunStatus) => {
  switch (status) {
    case RunStatus.BACKLOG:
      return "backlog";
    case RunStatus.QUEUED:
      return "queued";
    case RunStatus.RUNNING:
      return "running";
    case RunStatus.PAUSED:
      return "paused";
    case RunStatus.BLOCKED:
      return "blocked";
    case RunStatus.FAILED:
      return "failed";
    case RunStatus.COMPLETED:
      return "completed";
    case RunStatus.CANCELLED:
      return "cancelled";
    case RunStatus.UNSPECIFIED:
      throw new ConnectError("Run status is required", Code.InvalidArgument);
  }
};

const difficultyJson = (difficulty: IssueDifficulty | undefined) => {
  switch (difficulty) {
    case IssueDifficulty.EASY:
      return "easy";
    case IssueDifficulty.NORMAL:
      return "normal";
    case IssueDifficulty.HARD:
      return "hard";
    case IssueDifficulty.UNSPECIFIED:
    case undefined:
      return null;
  }
};

const checkpointPositionJson = (position: WorkflowCheckpoint_Position) => {
  switch (position) {
    case WorkflowCheckpoint_Position.BEFORE:
      return "before";
    case WorkflowCheckpoint_Position.AFTER:
      return "after";
    case WorkflowCheckpoint_Position.UNSPECIFIED:
      throw new ConnectError(
        "Checkpoint position is required",
        Code.InvalidArgument,
      );
  }
};

const mutated = async <A>(
  input: AppConnectIssueRouteInput,
  projectIds: readonly string[],
  run: () => Promise<A>,
) => {
  const result = await run();
  for (const projectId of new Set(projectIds.map(canonicalUuid))) {
    scheduleProjectRealtimePublish(
      input.env,
      input.db,
      projectId,
      input.context,
    );
  }
  return result;
};

export const createAppIssueService = (
  input: AppConnectIssueRouteInput,
  services: AppConnectIssueServices = appConnectIssueServices,
): ServiceImpl<typeof IssueService> => ({
  createIssue: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.createIssue({
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        projectId: canonicalUuid(request.projectId),
        userId: session.user.id,
        request: {
          title: request.title,
          description: request.description ?? null,
          priority: request.priority ?? null,
          difficulty: difficultyJson(request.difficulty),
          assigneeUserId: request.assigneeUserId ?? null,
          status: runStatusJson(request.status),
          preferredProvider: request.preferredProvider === undefined
            ? null
            : providerJson(request.preferredProvider) ?? null,
          preferredModel: request.preferredModel ?? null,
          preferredEffort: request.preferredEffort ?? null,
          fullAuto: request.fullAuto,
          checkpoints: request.checkpoints.map((checkpoint) => ({
            key: checkpoint.key,
            stage: checkpoint.stage,
            position: checkpointPositionJson(checkpoint.position),
          })),
        },
        attachments: [],
        attachmentReferences: request.attachmentReferences,
      })
    );
    return appCreateIssueResponse(result);
  }),

  updateIssue: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.updateIssue({
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          title: request.title,
          description: request.description ?? null,
          priority: request.priority ?? null,
          difficulty: difficultyJson(request.difficulty),
          ...(request.assigneeUpdate.case === "assigneeUserId"
            ? { assigneeUserId: request.assigneeUpdate.value }
            : request.assigneeUpdate.case === "clearAssignee"
            ? { assigneeUserId: null }
            : {}),
        },
        attachments: [],
        attachmentReferences: request.attachmentReferences,
        keptAttachmentIds: request.keptAttachmentIds?.values,
      })
    );
    return appUpdateIssueResponse(result);
  }),

  deleteIssue: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.deleteIssue({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        context: input.context,
      })
    );
    return appDeleteIssueResponse(result);
  }),

  transferIssue: (request) => rpc(async () => {
    const targetProjectId = canonicalUuid(request.targetProjectId);
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(
      input,
      [request.projectId, targetProjectId],
      () => services.transferIssue({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: { targetProjectId },
      }),
    );
    return appTransferIssueResponse(result);
  }),

  setIssueSubscription: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.setSubscription({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        subscribed: request.subscribed,
      })
    );
    return appSetIssueSubscriptionResponse(result);
  }),

  updateIssuePreferences: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.updatePreferences({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          provider: request.provider === undefined
            ? null
            : providerJson(request.provider) ?? null,
          model: request.model ?? null,
          effort: request.effort ?? null,
        },
      })
    );
    return appUpdateIssuePreferencesResponse(result);
  }),

  setIssueDependency: (request) => rpc(async () => {
    const projectId = canonicalUuid(request.projectId);
    const dependentRunId = canonicalUuid(request.runId);
    const prerequisiteRunId = canonicalUuid(request.prerequisiteRunId);
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [projectId], () =>
      services.setDependency({
        db: input.db,
        projectId,
        dependentRunId,
        prerequisiteRunId,
        userId: session.user.id,
        enabled: request.enabled,
      })
    );
    return appSetIssueDependencyResponse(result);
  }),

  moveRun: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.moveRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          requestId: canonicalUuid(request.requestId),
          status: runStatusJson(request.status),
          workflowStage: request.workflowStage ?? null,
        },
      })
    );
    return appMoveRunResponse(result);
  }),

  retryRun: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.recoverRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        action: "retry",
        request: {
          requestId: canonicalUuid(request.requestId),
          reason: request.reason ?? null,
        },
      })
    );
    return appRetryRunResponse(result);
  }),

  cancelRun: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.recoverRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        action: "cancel",
        request: {
          requestId: canonicalUuid(request.requestId),
          reason: request.reason ?? null,
        },
      })
    );
    return appCancelRunResponse(result);
  }),

  resumeRun: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.resumeRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          requestId: canonicalUuid(request.requestId),
          checkpointKey: request.checkpointKey,
          attempt: request.attempt,
          revision: request.revision,
        },
      })
    );
    return appResumeRunResponse(result);
  }),

  dispatchRun: (request) => rpc(async () => {
    if (!request.dispatch) {
      throw new ConnectError("Dispatch input is required", Code.InvalidArgument);
    }
    const dispatch = request.dispatch;
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.dispatchRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        reassign: false,
        request: {
          requestId: canonicalUuid(dispatch.requestId),
          agentId: dispatch.agentId
            ? canonicalUuid(dispatch.agentId)
            : null,
          ...optionalProviderBody(dispatch.provider),
          model: dispatch.model ?? null,
          effort: dispatch.effort ?? null,
          persistPreferences: dispatch.persistPreferences,
          workerId: dispatch.workerId ?? null,
        },
      })
    );
    return appDispatchRunResponse(result);
  }),

  reassignRun: (request) => rpc(async () => {
    if (!request.dispatch) {
      throw new ConnectError("Dispatch input is required", Code.InvalidArgument);
    }
    const dispatch = request.dispatch;
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.dispatchRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        reassign: true,
        request: {
          requestId: canonicalUuid(dispatch.requestId),
          agentId: dispatch.agentId
            ? canonicalUuid(dispatch.agentId)
            : null,
          ...optionalProviderBody(dispatch.provider),
          model: dispatch.model ?? null,
          effort: dispatch.effort ?? null,
          persistPreferences: dispatch.persistPreferences,
          workerId: dispatch.workerId ?? null,
        },
      })
    );
    return appReassignRunResponse(result);
  }),

  completeResultReview: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.completeResultReview({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
      })
    );
    return appCompleteResultReviewResponse(result);
  }),

  listIssueMessages: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.listMessages({
      db: input.db,
      archivesBucket: input.env.ARCHIVES,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      userId: session.user.id,
    });
    return appListIssueMessagesResponse(result);
  }),

  syncIssueMessages: (request) => rpc(async () => {
    if (request.cursor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ConnectError(
        "Conversation cursor is outside the safe range",
        Code.InvalidArgument,
      );
    }
    const session = await services.requireSession(input.auth, input.request);
    const applicationInput = {
      db: input.db,
      archivesBucket: input.env.ARCHIVES,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      userId: session.user.id,
    };
    try {
      const result = await services.syncMessages({
        ...applicationInput,
        cursor: Number(request.cursor),
      });
      return appSyncIssueMessagesResponse(result);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 410) throw error;
      const snapshot = await services.listMessages(applicationInput);
      return appResetIssueMessagesResponse(snapshot);
    }
  }),

  createIssueMessage: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.createMessage({
        db: input.db,
        archivesBucket: input.env.ARCHIVES,
        attachmentsBucket: input.env.ATTACHMENTS,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          clientMessageId: canonicalUuid(request.clientMessageId),
          body: request.body,
          parentMessageId: request.parentMessageId
            ? canonicalUuid(request.parentMessageId)
            : null,
          mentionedUserIds: request.mentionedUserIds,
          mentionedAgentIds: request.mentionedAgentIds.map(canonicalUuid),
          agentConversationId: request.agentConversationId ?? null,
        },
        attachments: [],
        attachmentReferences: request.attachmentReferences,
      })
    );
    return appCreateIssueMessageResponse(result);
  }),

  getIssueAgentReply: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.getAgentReply({
      db: input.db,
      archivesBucket: input.env.ARCHIVES,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      triggerMessageId: canonicalUuid(request.triggerMessageId),
      userId: session.user.id,
    });
    return appGetIssueAgentReplyResponse(result);
  }),

  listRunEvidence: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.listEvidence({
      db: input.db,
      archivesBucket: input.env.ARCHIVES,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      userId: session.user.id,
    });
    return runEvidenceResponseMessage(result);
  }),

  acceptIssueReworkProposal: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptReworkProposal({
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        projectId: canonicalUuid(request.projectId),
        conversationRunId: canonicalUuid(request.runId),
        proposalId: canonicalUuid(request.proposalId),
        userId: session.user.id,
      })
    );
    return appAcceptIssueReworkProposalResponse(result);
  }),

  acceptIssueActionProposal: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptActionProposal({
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        projectId: canonicalUuid(request.projectId),
        conversationRunId: canonicalUuid(request.runId),
        proposalId: canonicalUuid(request.proposalId),
        userId: session.user.id,
      })
    );
    return appAcceptIssueActionProposalResponse(result);
  }),

  acceptIssueExecutionProposal: (request) => rpc(async () => {
    if (!request.approval) {
      throw new ConnectError("Execution approval is required", Code.InvalidArgument);
    }
    const approval = request.approval;
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptExecutionProposal({
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        projectId: canonicalUuid(request.projectId),
        conversationRunId: canonicalUuid(request.conversationRunId),
        proposalId: canonicalUuid(request.proposalId),
        userId: session.user.id,
        request: {
          provider: requiredProviderJson(approval.provider),
          model: approval.model ?? null,
          effort: approval.effort ?? null,
          workerId: approval.workerId ?? null,
        },
      })
    );
    return appAcceptIssueExecutionProposalResponse(result);
  }),

  acceptIssueSkillExecutionProposal: (request) => rpc(async () => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptSkillExecutionProposal({
        db: input.db,
        attachmentsBucket: input.env.ATTACHMENTS,
        archivesBucket: input.env.ARCHIVES,
        projectId: canonicalUuid(request.projectId),
        conversationRunId: canonicalUuid(request.conversationRunId),
        proposalId: canonicalUuid(request.proposalId),
        userId: session.user.id,
        request: { workerId: request.workerId ?? null },
      })
    );
    if (result.session != null) {
      scheduleProjectAgentSessionRealtimePublish(
        input.env,
        input.db,
        canonicalUuid(request.projectId),
        input.context,
      );
    }
    return appAcceptIssueSkillExecutionProposalResponse(result);
  }),
});

export function registerAppIssueService(
  router: ConnectRouter,
  input: AppConnectIssueRouteInput,
  services: AppConnectIssueServices = appConnectIssueServices,
) {
  router.service(IssueService, createAppIssueService(input, services));
}

export { IssueService };
