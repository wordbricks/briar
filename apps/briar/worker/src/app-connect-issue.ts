import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  IssueService,
  SetIssueParentResponse_Outcome,
  SetRelatedIssueResponse_Outcome,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  PreparedUploadSchema,
  UploadReferenceSchema,
} from "@briar/contracts/gen/briar/types/v1/upload_pb";
import {
  appAcceptIssueActionProposalResponse,
  appAcceptIssueExecutionProposalResponse,
  appAcceptIssueReworkProposalResponse,
  appAcceptIssueSkillExecutionProposalResponse,
  appCancelRunResponse,
  appCompleteResultReviewResponse,
  appCreateIssueResponse,
  appCreateIssueMessageResponse,
  appDeleteIssueMessageResponse,
  appDeleteIssueResponse,
  appDispatchRunResponse,
  appGetIssueAgentReplyResponse,
  appListIssueMessagesResponse,
  appMoveRunResponse,
  appReassignRunResponse,
  appResetIssueMessagesResponse,
  appReworkRunResponse,
  appResumeRunResponse,
  appRetryRunResponse,
  appSetIssueDependencyResponse,
  appSetIssueSubscriptionResponse,
  appSyncIssueMessagesResponse,
  appTransferIssueResponse,
  appUnassignRunResponse,
  appUpdateIssueCheckpointsResponse,
  appUpdateIssueMessageResponse,
  appUpdateIssuePreferencesResponse,
  appUpdateIssueResponse,
} from "./app-connect-issue-mappers";
import type { BriarAuth } from "./auth";
import {
  createProjectIssueMessage,
  deleteProjectIssueMessage,
  getProjectIssueAgentReply,
  listProjectIssueMessages,
  syncProjectIssueMessages,
  updateProjectIssueMessage,
} from "./issue-conversation-routes";
import {
  dispatchProjectIssueRun,
  moveProjectIssueRun,
  recoverProjectIssueRun,
  reworkProjectIssueRun,
  resumeProjectIssueRun,
  transferProjectIssue,
  unassignProjectIssueRun,
} from "./issue-control-routes";
import {
  completeProjectIssueResultReview,
  createProjectIssue,
  deleteProjectIssue,
  setProjectIssueDependency,
  setProjectIssueParent,
  setProjectRelatedIssue,
  setProjectIssueSubscription,
  updateProjectIssue,
  updateProjectIssueCheckpoints,
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
import { decodeRequestSync } from "./request-schema";
import { runEvidenceResponseMessage } from "./run-evidence-connect";
import { listProjectRunEvidence } from "./run-evidence-routes";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import {
  appAgentProviderFromProto,
  appCheckpointPosition,
  appRunStatus,
  createIssueApplicationRequest,
  createIssueMessageApplicationRequest,
  requiredAppAgentProviderFromProto,
  updateIssueApplicationRequest,
} from "./app-mutation-request-mappers";
import {
  prepareCreateIssueAttachmentsApplication,
  prepareIssueMessageAttachmentsApplication,
  prepareUpdateIssueAttachmentsApplication,
} from "./issue-attachment-upload-application";

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
  readonly prepareCreateAttachments:
    typeof prepareCreateIssueAttachmentsApplication;
  readonly prepareMessageAttachments:
    typeof prepareIssueMessageAttachmentsApplication;
  readonly prepareUpdateAttachments:
    typeof prepareUpdateIssueAttachmentsApplication;
  readonly deleteMessage: typeof deleteProjectIssueMessage;
  readonly deleteIssue: typeof deleteProjectIssue;
  readonly dispatchRun: typeof dispatchProjectIssueRun;
  readonly getAgentReply: typeof getProjectIssueAgentReply;
  readonly listEvidence: typeof listProjectRunEvidence;
  readonly listMessages: typeof listProjectIssueMessages;
  readonly moveRun: typeof moveProjectIssueRun;
  readonly recoverRun: typeof recoverProjectIssueRun;
  readonly reworkRun: typeof reworkProjectIssueRun;
  readonly requireSession: typeof requireSession;
  readonly resumeRun: typeof resumeProjectIssueRun;
  readonly setDependency: typeof setProjectIssueDependency;
  readonly setParent: typeof setProjectIssueParent;
  readonly setRelated: typeof setProjectRelatedIssue;
  readonly setSubscription: typeof setProjectIssueSubscription;
  readonly syncMessages: typeof syncProjectIssueMessages;
  readonly transferIssue: typeof transferProjectIssue;
  readonly unassignRun: typeof unassignProjectIssueRun;
  readonly updateIssue: typeof updateProjectIssue;
  readonly updateCheckpoints: typeof updateProjectIssueCheckpoints;
  readonly updateMessage: typeof updateProjectIssueMessage;
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
  prepareCreateAttachments: prepareCreateIssueAttachmentsApplication,
  prepareMessageAttachments: prepareIssueMessageAttachmentsApplication,
  prepareUpdateAttachments: prepareUpdateIssueAttachmentsApplication,
  deleteMessage: deleteProjectIssueMessage,
  deleteIssue: deleteProjectIssue,
  dispatchRun: dispatchProjectIssueRun,
  getAgentReply: getProjectIssueAgentReply,
  listEvidence: listProjectRunEvidence,
  listMessages: listProjectIssueMessages,
  moveRun: moveProjectIssueRun,
  recoverRun: recoverProjectIssueRun,
  reworkRun: reworkProjectIssueRun,
  requireSession,
  resumeRun: resumeProjectIssueRun,
  setDependency: setProjectIssueDependency,
  setParent: setProjectIssueParent,
  setRelated: setProjectRelatedIssue,
  setSubscription: setProjectIssueSubscription,
  syncMessages: syncProjectIssueMessages,
  transferIssue: transferProjectIssue,
  unassignRun: unassignProjectIssueRun,
  updateIssue: updateProjectIssue,
  updateCheckpoints: updateProjectIssueCheckpoints,
  updateMessage: updateProjectIssueMessage,
  updatePreferences: updateProjectIssuePreferences,
};

const decodeUuid = decodeRequestSync(UuidString);

const canonicalUuid = (value: string) => decodeUuid(value).toLowerCase();

const preparedIssueAttachmentsResponse = (
  input: AppConnectIssueRouteInput,
  result: Awaited<ReturnType<typeof prepareCreateIssueAttachmentsApplication>>,
) => create(IssueService.method.prepareCreateIssueAttachments.output, {
  replayed: result.replayed,
  uploads: result.uploads.map((upload) =>
    create(PreparedUploadSchema, {
      clientId: upload.clientId,
      reference: create(UploadReferenceSchema, { uploadId: upload.uploadId }),
      uploadUrl: new URL(
        `/app-api/uploads/${encodeURIComponent(upload.uploadId)}`,
        input.request.url,
      ).toString(),
      uploadCapability: upload.uploadCapability,
      expiresAt: timestampFromDate(new Date(upload.expiresAt)),
    })
  ),
});

const optionalProviderBody = (provider: AgentProvider) => {
  const value = appAgentProviderFromProto(provider);
  return value === undefined ? {} : { provider: value };
};

const parentOutcome = (
  outcome: "created" | "updated" | "already_exists" | "removed" |
    "already_removed",
) => {
  switch (outcome) {
    case "created": return SetIssueParentResponse_Outcome.CREATED;
    case "updated": return SetIssueParentResponse_Outcome.UPDATED;
    case "already_exists": return SetIssueParentResponse_Outcome.ALREADY_EXISTS;
    case "removed": return SetIssueParentResponse_Outcome.REMOVED;
    case "already_removed": return SetIssueParentResponse_Outcome.ALREADY_REMOVED;
  }
};

const relatedOutcome = (
  outcome: "created" | "already_exists" | "removed" | "already_removed",
) => {
  switch (outcome) {
    case "created": return SetRelatedIssueResponse_Outcome.CREATED;
    case "already_exists": return SetRelatedIssueResponse_Outcome.ALREADY_EXISTS;
    case "removed": return SetRelatedIssueResponse_Outcome.REMOVED;
    case "already_removed": return SetRelatedIssueResponse_Outcome.ALREADY_REMOVED;
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
  prepareCreateIssueAttachments: async (request, context) => {
    context.responseHeader.set("Cache-Control", "private, no-store");
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.prepareCreateAttachments({
      db: input.db,
      signingSecret: input.env.BETTER_AUTH_SECRET,
      projectId: canonicalUuid(request.projectId),
      userId: session.user.id,
      preparationRequestId: canonicalUuid(request.preparationRequestId),
      mutationId: canonicalUuid(request.clientIssueId),
      attachments: request.attachments,
    });
    return preparedIssueAttachmentsResponse(input, result);
  },

  createIssue: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.createIssue({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        userId: session.user.id,
        clientIssueId: canonicalUuid(request.clientIssueId),
        planningProjectId: request.planningProjectId
          ? canonicalUuid(request.planningProjectId)
          : undefined,
        request: createIssueApplicationRequest(request),
        attachmentIds: request.attachments.map((attachment) =>
          canonicalUuid(attachment.uploadId)
        ),
      })
    );
    return appCreateIssueResponse(result);
  },

  prepareUpdateIssueAttachments: async (request, context) => {
    context.responseHeader.set("Cache-Control", "private, no-store");
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.prepareUpdateAttachments({
      db: input.db,
      signingSecret: input.env.BETTER_AUTH_SECRET,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      userId: session.user.id,
      preparationRequestId: canonicalUuid(request.preparationRequestId),
      mutationId: canonicalUuid(request.requestId),
      attachments: request.attachments,
    });
    return preparedIssueAttachmentsResponse(input, result);
  },

  updateIssue: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.updateIssue({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        requestId: canonicalUuid(request.requestId),
        request: updateIssueApplicationRequest(request),
        attachmentIds: request.attachments.map((attachment) =>
          canonicalUuid(attachment.uploadId)
        ),
        keptAttachmentIds: request.keptAttachmentIds?.values.map(canonicalUuid),
      })
    );
    return appUpdateIssueResponse(result);
  },

  deleteIssue: async (request) => {
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
  },

  transferIssue: async (request) => {
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
  },

  setIssueSubscription: async (request) => {
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
  },

  updateIssuePreferences: async (request) => {
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
            : appAgentProviderFromProto(request.provider) ?? null,
          model: request.model ?? null,
          effort: request.effort ?? null,
        },
      })
    );
    return appUpdateIssuePreferencesResponse(result);
  },

  updateIssueCheckpoints: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.updateCheckpoints({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          checkpoints: request.checkpoints.map((checkpoint) => ({
            key: checkpoint.key,
            stage: checkpoint.stage,
            position: appCheckpointPosition(checkpoint.position),
          })),
        },
      })
    );
    return appUpdateIssueCheckpointsResponse(result);
  },

  setIssueDependency: async (request) => {
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
  },

  setIssueParent: async (request) => {
    const projectId = canonicalUuid(request.projectId);
    const childRunId = canonicalUuid(request.childRunId);
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [projectId], () =>
      services.setParent({
        db: input.db,
        projectId,
        childRunId,
        parentRunId: request.parentRunId === undefined
          ? null
          : canonicalUuid(request.parentRunId),
        userId: session.user.id,
      })
    );
    return create(IssueService.method.setIssueParent.output, {
      childRunId: result.childRunId,
      parentRunId: result.parentRunId ?? undefined,
      outcome: parentOutcome(result.outcome),
    });
  },

  setRelatedIssue: async (request) => {
    const projectId = canonicalUuid(request.projectId);
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [projectId], () =>
      services.setRelated({
        db: input.db,
        projectId,
        runId: canonicalUuid(request.runId),
        relatedRunId: canonicalUuid(request.relatedRunId),
        enabled: request.enabled,
        userId: session.user.id,
      })
    );
    return create(IssueService.method.setRelatedIssue.output, {
      runId: result.runId,
      relatedRunId: result.relatedRunId,
      outcome: relatedOutcome(result.outcome),
    });
  },

  moveRun: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.moveRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          requestId: canonicalUuid(request.requestId),
          status: appRunStatus(request.status),
          workflowStage: request.workflowStage ?? null,
        },
      })
    );
    return appMoveRunResponse(result);
  },

  retryRun: async (request) => {
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
  },

  cancelRun: async (request) => {
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
  },

  resumeRun: async (request) => {
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
  },

  reworkRun: async (request) => {
    if (!request.checkpoint) {
      throw new ConnectError(
        "Checkpoint identity is required",
        Code.InvalidArgument,
      );
    }
    const checkpoint = request.checkpoint;
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.reworkRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: {
          requestId: canonicalUuid(request.requestId),
          workflowStage: request.workflowStage,
          reason: request.reason,
          checkpointKey: checkpoint.key,
          attempt: checkpoint.attempt,
          revision: checkpoint.revision,
        },
      })
    );
    return appReworkRunResponse(result);
  },

  unassignRun: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.unassignRun({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: { requestId: canonicalUuid(request.requestId) },
      })
    );
    return appUnassignRunResponse(result);
  },

  dispatchRun: async (request) => {
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
  },

  reassignRun: async (request) => {
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
  },

  completeResultReview: async (request) => {
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
  },

  listIssueMessages: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.listMessages({
      db: input.db,
      archivesBucket: input.env.ARCHIVES,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      userId: session.user.id,
    });
    return appListIssueMessagesResponse(result);
  },

  syncIssueMessages: async (request) => {
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
  },

  prepareIssueMessageAttachments: async (request, context) => {
    context.responseHeader.set("Cache-Control", "private, no-store");
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.prepareMessageAttachments({
      db: input.db,
      signingSecret: input.env.BETTER_AUTH_SECRET,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      userId: session.user.id,
      preparationRequestId: canonicalUuid(request.preparationRequestId),
      mutationId: canonicalUuid(request.clientMessageId),
      attachments: request.attachments,
    });
    return preparedIssueAttachmentsResponse(input, result);
  },

  createIssueMessage: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.createMessage({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        userId: session.user.id,
        request: createIssueMessageApplicationRequest(request),
        attachmentIds: request.attachments.map((attachment) =>
          canonicalUuid(attachment.uploadId)
        ),
      })
    );
    return appCreateIssueMessageResponse(result);
  },

  updateIssueMessage: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.updateMessage({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        messageId: canonicalUuid(request.messageId),
        userId: session.user.id,
        request: {
          body: request.body,
          mentionedUserIds: request.mentionedUserIds,
        },
      })
    );
    return appUpdateIssueMessageResponse(result);
  },

  deleteIssueMessage: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.deleteMessage({
        db: input.db,
        projectId: canonicalUuid(request.projectId),
        runId: canonicalUuid(request.runId),
        messageId: canonicalUuid(request.messageId),
        userId: session.user.id,
      })
    );
    return appDeleteIssueMessageResponse(result);
  },

  getIssueAgentReply: async (request) => {
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
  },

  listRunEvidence: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.listEvidence({
      db: input.db,
      archivesBucket: input.env.ARCHIVES,
      projectId: canonicalUuid(request.projectId),
      runId: canonicalUuid(request.runId),
      userId: session.user.id,
    });
    return runEvidenceResponseMessage(result);
  },

  acceptIssueReworkProposal: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptReworkProposal({
        db: input.db,
        archivesBucket: input.env.ARCHIVES,
        projectId: canonicalUuid(request.projectId),
        conversationRunId: canonicalUuid(request.runId),
        proposalId: canonicalUuid(request.proposalId),
        userId: session.user.id,
      })
    );
    return appAcceptIssueReworkProposalResponse(result);
  },

  acceptIssueActionProposal: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptActionProposal({
        db: input.db,
        archivesBucket: input.env.ARCHIVES,
        projectId: canonicalUuid(request.projectId),
        conversationRunId: canonicalUuid(request.runId),
        proposalId: canonicalUuid(request.proposalId),
        userId: session.user.id,
      })
    );
    return appAcceptIssueActionProposalResponse(result);
  },

  acceptIssueExecutionProposal: async (request) => {
    if (!request.approval) {
      throw new ConnectError("Execution approval is required", Code.InvalidArgument);
    }
    const approval = request.approval;
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptExecutionProposal({
        db: input.db,
        archivesBucket: input.env.ARCHIVES,
        projectId: canonicalUuid(request.projectId),
        conversationRunId: canonicalUuid(request.conversationRunId),
        proposalId: canonicalUuid(request.proposalId),
        userId: session.user.id,
        request: {
          provider: requiredAppAgentProviderFromProto(approval.provider),
          model: approval.model ?? null,
          effort: approval.effort ?? null,
          workerId: approval.workerId ?? null,
        },
      })
    );
    return appAcceptIssueExecutionProposalResponse(result);
  },

  acceptIssueSkillExecutionProposal: async (request) => {
    const session = await services.requireSession(input.auth, input.request);
    const result = await mutated(input, [request.projectId], () =>
      services.acceptSkillExecutionProposal({
        db: input.db,
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
  },
});

export function registerAppIssueService(
  router: ConnectRouter,
  input: AppConnectIssueRouteInput,
  services: AppConnectIssueServices = appConnectIssueServices,
) {
  router.service(IssueService, createAppIssueService(input, services));
}

export { IssueService };
