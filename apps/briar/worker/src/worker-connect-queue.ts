import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  BlockMergeBatchResponseSchema,
  CheckpointChannelReplySessionResponseSchema,
  CompleteChannelReplyResponseSchema,
  CompleteIssueReplyResponseSchema,
  CompleteMergeBatchPublicationResponseSchema,
  HandoffWorkResponse_Outcome,
  HandoffWorkResponse_State,
  MergeBatchState,
  MergeBatchValidationFailureCode,
  RecordMergeBatchAuthorityResponseSchema,
  RecordMergeBatchCandidateEnqueuedResponseSchema,
  RecordMergeBatchValidationResponseSchema,
  PrepareReplyAttachmentUploadsResponseSchema,
  ReplyCompletionDisposition,
  RenewWorkLeaseResponseSchema,
  WorkerQueueService,
  type BlockMergeBatchRequest,
  type CheckpointChannelReplySessionRequest,
  type CompleteChannelReplyRequest,
  type CompleteIssueReplyRequest,
  type CompleteMergeBatchPublicationRequest,
  type CompleteProjectAgentTaskRequest,
  type PrepareReplyAttachmentUploadsRequest,
  type RecordMergeBatchAuthorityRequest,
  type RecordMergeBatchCandidateEnqueuedRequest,
  type RecordMergeBatchValidationRequest,
  type WorkClaimIdentity,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type {
  ConnectRouter,
  HandlerContext,
  ServiceImpl,
} from "@connectrpc/connect";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import {
  checkpointChannelReplySession,
  getClaimedChannelReply,
  getChannelReplySession,
  renewChannelReplyLease,
} from "./channels";
import { sha256 } from "./crypto-digest";
import {
  renewIssueAgentReplyLease,
  renewProjectAgentTaskLease,
} from "./db";
import { HttpError } from "./http-response";
import { claimNextIssueReplyWork } from "./issue-reply-worker-routes";
import {
  releaseMergeBatchLease,
  renewMergeBatchLease,
  type MergeBatchState as MergeBatchStateDomain,
} from "./merge-batches";
import {
  blockMergeBatchWork,
  claimNextMergeBatchWork,
  completeMergeBatchPublicationWork,
  recordMergeBatchAuthorityWork,
  recordMergeBatchCandidateEnqueuedWork,
  recordMergeBatchValidationWork,
} from "./merge-batch-worker";
import {
  claimNextProjectAgentTaskWork,
  completeProjectAgentTaskWork,
} from "./project-agent-task-worker";
import {
  decodeProjectAgentTaskFailure,
  decodeProjectAgentTaskSuccess,
} from "./project-request-contract";
import { claimNextQueueWork } from "./queue-claim-routes";
import {
  channelActivityCredential,
  issueActivityCredential,
} from "./realtime-scheduling";
import { decodeWorkerUpdateHandoff } from "./worker-update-contract";
import {
  failExecutionWorkerUpdateHandoff,
  handoffExecutionWorkerClaim,
  executionWorkerUpdateStatus,
  leaseExpiryFrom,
  renewHuntRunLease,
  auditExecutionEvent,
  type WorkerConflictError,
} from "./workers";
import {
  type AuthenticatedWorkerProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";
import { decodeWorkerClaimInput } from "./worker-request-contract";

import { workerClaimMessage } from "./worker-connect-mappers";
import {
  completeChannelReplyApplication,
  completeIssueReplyApplication,
  prepareReplyAttachmentUploadsApplication,
} from "./worker-reply-completion-application";
import {
  completeChannelReplyInputFromProto,
  completeIssueReplyInputFromProto,
  prepareReplyAttachmentUploadsInputFromProto,
} from "./worker-reply-completion-mappers";
import { rethrowReplyCompletionHttpError } from "./reply-completion-http-error";

export type WorkerConnectQueueInput = {
  readonly request: Request;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type WorkerQueueServices = {
  readonly requireWorkerProjectBinding: typeof requireWorkerProjectBinding;
  readonly claimNextMergeBatchWork: typeof claimNextMergeBatchWork;
  readonly claimNextIssueReplyWork: typeof claimNextIssueReplyWork;
  readonly claimNextProjectAgentTaskWork: typeof claimNextProjectAgentTaskWork;
  readonly completeProjectAgentTaskWork: typeof completeProjectAgentTaskWork;
  readonly claimNextChannelReplyWork: typeof claimNextChannelReplyWork;
  readonly claimNextQueueWork: typeof claimNextQueueWork;
  readonly sha256: typeof sha256;
  readonly renewHuntRunLease: typeof renewHuntRunLease;
  readonly renewProjectAgentTaskLease: typeof renewProjectAgentTaskLease;
  readonly renewIssueAgentReplyLease: typeof renewIssueAgentReplyLease;
  readonly renewChannelReplyLease: typeof renewChannelReplyLease;
  readonly getClaimedChannelReply: typeof getClaimedChannelReply;
  readonly checkpointChannelReplySession: typeof checkpointChannelReplySession;
  readonly renewMergeBatchLease: typeof renewMergeBatchLease;
  readonly getChannelReplySession: typeof getChannelReplySession;
  readonly issueActivityCredential: typeof issueActivityCredential;
  readonly channelActivityCredential: typeof channelActivityCredential;
  readonly auditExecutionEvent: typeof auditExecutionEvent;
  readonly releaseMergeBatchLease: typeof releaseMergeBatchLease;
  readonly handoffExecutionWorkerClaim: typeof handoffExecutionWorkerClaim;
  readonly failExecutionWorkerUpdateHandoff: typeof failExecutionWorkerUpdateHandoff;
  readonly executionWorkerUpdateStatus: typeof executionWorkerUpdateStatus;
  readonly recordMergeBatchCandidateEnqueuedWork:
    typeof recordMergeBatchCandidateEnqueuedWork;
  readonly recordMergeBatchAuthorityWork: typeof recordMergeBatchAuthorityWork;
  readonly recordMergeBatchValidationWork: typeof recordMergeBatchValidationWork;
  readonly completeMergeBatchPublicationWork:
    typeof completeMergeBatchPublicationWork;
  readonly blockMergeBatchWork: typeof blockMergeBatchWork;
  readonly prepareReplyAttachmentUploadsApplication:
    typeof prepareReplyAttachmentUploadsApplication;
  readonly completeIssueReplyApplication: typeof completeIssueReplyApplication;
  readonly completeChannelReplyApplication: typeof completeChannelReplyApplication;
};

const workerQueueServices: WorkerQueueServices = {
  requireWorkerProjectBinding,
  claimNextMergeBatchWork,
  claimNextIssueReplyWork,
  claimNextProjectAgentTaskWork,
  completeProjectAgentTaskWork,
  claimNextChannelReplyWork,
  claimNextQueueWork,
  sha256,
  renewHuntRunLease,
  renewProjectAgentTaskLease,
  renewIssueAgentReplyLease,
  renewChannelReplyLease,
  getClaimedChannelReply,
  checkpointChannelReplySession,
  renewMergeBatchLease,
  getChannelReplySession,
  issueActivityCredential,
  channelActivityCredential,
  auditExecutionEvent,
  releaseMergeBatchLease,
  handoffExecutionWorkerClaim,
  failExecutionWorkerUpdateHandoff,
  executionWorkerUpdateStatus,
  recordMergeBatchCandidateEnqueuedWork,
  recordMergeBatchAuthorityWork,
  recordMergeBatchValidationWork,
  completeMergeBatchPublicationWork,
  blockMergeBatchWork,
  prepareReplyAttachmentUploadsApplication,
  completeIssueReplyApplication,
  completeChannelReplyApplication,
};

const requiredWork = (value: WorkClaimIdentity | undefined) => {
  if (!value || value.work.case === undefined) {
    throw new HttpError(400, "Worker claim identity is required");
  }
  if (!value.workId || !value.runId || !value.claimToken) {
    throw new HttpError(400, "Worker claim identity is incomplete");
  }
  return value;
};

const timestamp = (value: string | null, field: string) => {
  if (value === null) throw new Error(`Worker ${field} timestamp is missing`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Worker ${field} timestamp`);
  }
  return timestampFromDate(date);
};

const mergeBatchState = (value: MergeBatchStateDomain): MergeBatchState => {
  switch (value) {
    case "collecting": return MergeBatchState.COLLECTING;
    case "frozen": return MergeBatchState.FROZEN;
    case "enqueueing": return MergeBatchState.ENQUEUEING;
    case "waiting_tail": return MergeBatchState.WAITING_TAIL;
    case "validating": return MergeBatchState.VALIDATING;
    case "publishing": return MergeBatchState.PUBLISHING;
    case "awaiting_merge": return MergeBatchState.AWAITING_MERGE;
    case "blocked": return MergeBatchState.BLOCKED;
    case "draining": return MergeBatchState.DRAINING;
    case "completed": return MergeBatchState.COMPLETED;
    case "failed": return MergeBatchState.FAILED;
  }
};

const activityMessage = (
  value: { token: string; expiresAt: string } | null,
) => value
  ? {
      token: value.token,
      expiresAt: timestamp(value.expiresAt, "activity expiry"),
    }
  : undefined;

const authenticatedWorker = (
  input: WorkerConnectQueueInput,
  projectId: string,
  workerId: string,
  services: WorkerQueueServices,
) => services.requireWorkerProjectBinding(
  input.db,
  input.request,
  projectId,
  workerId,
);

async function claimWork(
  input: WorkerConnectQueueInput,
  request: {
    projectId: string;
    workerId: string;
    claimedBy: string;
    repliesOnly: boolean;
  },
  services: WorkerQueueServices,
) {
  const claimInput = decodeWorkerClaimInput({
    projectId: request.projectId,
    workerId: request.workerId,
    claimedBy: request.claimedBy,
  });
  const worker = await authenticatedWorker(
    input,
    claimInput.projectId,
    claimInput.workerId,
    services,
  );
  if (!request.repliesOnly) {
    const mergeBatch = await services.claimNextMergeBatchWork({
      db: input.db,
      projectId: claimInput.projectId,
      workerId: claimInput.workerId,
      claimedBy: claimInput.claimedBy,
      authenticatedWorker: worker,
    });
    if (mergeBatch) return { work: workerClaimMessage(mergeBatch) };
  }

  const issueReply = await services.claimNextIssueReplyWork({
    projectId: claimInput.projectId,
    db: input.db,
    env: input.env,
    context: input.context,
    authenticatedWorker: worker,
  });
  if (issueReply) return { work: workerClaimMessage(issueReply) };

  if (!request.repliesOnly) {
    const agentTask = await services.claimNextProjectAgentTaskWork({
      projectId: claimInput.projectId,
      db: input.db,
      env: input.env,
      context: input.context,
      authenticatedWorker: worker,
    });
    if (agentTask) return { work: workerClaimMessage(agentTask) };
  }

  const channelReply = await services.claimNextChannelReplyWork({
    input: {
      organizationId: worker.principal.organizationId,
      workerId: claimInput.workerId,
    },
    db: input.db,
    env: input.env,
    context: input.context,
    authenticatedWorker: worker,
  });
  if (channelReply) return { work: workerClaimMessage(channelReply) };

  if (!request.repliesOnly) {
    const issue = await services.claimNextQueueWork({
      db: input.db,
      env: input.env,
      projectId: claimInput.projectId,
      claimedBy: claimInput.claimedBy,
      authenticatedWorker: worker,
    });
    if (issue) return { work: workerClaimMessage(issue) };
  }

  return { retryAfterMs: 15_000 };
}

async function renewIssueLease(
  input: WorkerConnectQueueInput,
  worker: AuthenticatedWorkerProject,
  projectId: string,
  identity: WorkClaimIdentity,
  services: WorkerQueueServices,
) {
  const observedAt = new Date().toISOString();
  let renewed;
  try {
    renewed = await services.renewHuntRunLease(input.db, projectId, {
      runId: identity.runId,
      claimTokenHash: await services.sha256(identity.claimToken),
      observedAt,
      workerId: worker.binding.id,
    });
  } catch (error) {
    const conflict = error as Partial<WorkerConflictError>;
    if (conflict.name === "WorkerConflictError") {
      const project = await input.db
        .prepare(`select organization_id from briar_projects where id = ?`)
        .bind(projectId)
        .first<{ organization_id: string }>();
      if (project) {
        await services.auditExecutionEvent(input.db, {
          organizationId: project.organization_id,
          projectId,
          runId: identity.runId,
          workerId: worker.binding.id,
          action: "lease_lost",
          detail: { reason: conflict.message ?? "Worker claim conflict" },
          occurredAt: observedAt,
        });
      }
      throw new HttpError(409, conflict.message ?? "Worker claim is no longer active");
    }
    throw error;
  }
  return create(RenewWorkLeaseResponseSchema, {
    leaseExpiresAt: timestamp(renewed.lease_expires_at, "lease expiry"),
    work: { case: "issue", value: {} },
  });
}

async function renewWorkLease(
  input: WorkerConnectQueueInput,
  request: { projectId: string; workerId: string; work?: WorkClaimIdentity },
  services: WorkerQueueServices,
) {
  const identity = requiredWork(request.work);
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  const observedAt = new Date().toISOString();
  const leaseExpiresAt = leaseExpiryFrom(observedAt);
  const claimTokenHash = await services.sha256(identity.claimToken);

  switch (identity.work.case) {
    case "issue":
      return renewIssueLease(input, worker, request.projectId, identity, services);
    case "projectAgentTask": {
      const renewed = await services.renewProjectAgentTaskLease(
        input.db,
        request.projectId,
        identity.workId,
        {
          workerId: worker.binding.id,
          claimTokenHash,
          leaseExpiresAt,
          updatedAt: observedAt,
        },
      );
      if (!renewed) {
        throw new HttpError(409, "Agent task claim is no longer active");
      }
      return create(RenewWorkLeaseResponseSchema, {
        leaseExpiresAt: timestamp(renewed.lease_expires_at, "lease expiry"),
        work: { case: "projectAgentTask", value: {} },
      });
    }
    case "issueReply": {
      const renewed = await services.renewIssueAgentReplyLease(
        input.db,
        request.projectId,
        identity.workId,
        {
          workerId: worker.binding.id,
          claimTokenHash,
          leaseExpiresAt,
          updatedAt: observedAt,
        },
      );
      if (!renewed) throw new HttpError(409, "Reply claim is no longer active");
      const nextActivity = input.env.CHANNEL_ACTIVITY_REALTIME
        ? await services.issueActivityCredential(
            input.env,
            worker.principal.organizationId,
            renewed,
            {
              workerId: worker.binding.id,
              deviceId: worker.principal.deviceId,
            },
          )
        : null;
      return create(RenewWorkLeaseResponseSchema, {
        leaseExpiresAt: timestamp(renewed.lease_expires_at, "lease expiry"),
        work: {
          case: "issueReply",
          value: { activity: activityMessage(nextActivity) },
        },
      });
    }
    case "channelReply": {
      if (
        identity.work.value.organizationId !== worker.principal.organizationId
      ) {
        throw new HttpError(403, "Worker is not enabled for this organization");
      }
      const renewed = await services.renewChannelReplyLease(input.db, {
        jobId: identity.workId,
        deviceId: worker.principal.deviceId,
        workerId: worker.binding.id,
        claimTokenHash,
        observedAt,
        leaseExpiresAt,
      });
      if (!renewed) throw new HttpError(409, "Reply claim is no longer active");
      const nextActivity = input.env.CHANNEL_ACTIVITY_REALTIME
        ? await services.channelActivityCredential(input.env, renewed, {
            workerId: worker.binding.id,
            deviceId: worker.principal.deviceId,
          })
        : null;
      const session = renewed.session_id
        ? await services.getChannelReplySession(input.db, renewed.session_id)
        : null;
      return create(RenewWorkLeaseResponseSchema, {
        leaseExpiresAt: timestamp(renewed.lease_expires_at, "lease expiry"),
        work: {
          case: "channelReply",
          value: {
            retainedUntil: session
              ? timestamp(session.retained_until, "session retention")
              : undefined,
            activity: activityMessage(nextActivity),
          },
        },
      });
    }
    case "mergeBatch": {
      const renewed = await services.renewMergeBatchLease(input.db, {
        batchId: identity.workId,
        projectId: request.projectId,
        workerId: worker.binding.id,
        claimTokenHash,
        authenticatedAt: observedAt,
        leaseExpiresAt,
      });
      if (!renewed) {
        throw new HttpError(409, "Merge batch claim is no longer active");
      }
      return create(RenewWorkLeaseResponseSchema, {
        leaseExpiresAt: timestamp(renewed, "lease expiry"),
        work: {
          case: "mergeBatch",
          value: { batchId: identity.workId },
        },
      });
    }
    default:
      throw new HttpError(400, "Worker claim identity variant is required");
  }
}

async function handoffWork(
  input: WorkerConnectQueueInput,
  request: {
    requestId: string;
    projectId: string;
    workerId: string;
    work?: WorkClaimIdentity;
    checkpoint?: { conversationId?: string; workspacePath?: string };
  },
  services: WorkerQueueServices,
) {
  const identity = requiredWork(request.work);
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  const observedAt = new Date().toISOString();
  const claimTokenHash = await services.sha256(identity.claimToken);

  if (identity.work.case === "mergeBatch") {
    const released = await services.releaseMergeBatchLease(input.db, {
      batchId: identity.workId,
      projectId: request.projectId,
      workerId: worker.binding.id,
      claimTokenHash,
      authenticatedAt: observedAt,
    });
    return {
      outcome: released
        ? HandoffWorkResponse_Outcome.RELEASED
        : HandoffWorkResponse_Outcome.ALREADY_RELEASED,
      requestId: request.requestId,
      state: HandoffWorkResponse_State.DRAINING,
      activeWorkCount: 0,
      ready: false,
    };
  }

  const workType = identity.work.case;
  const decoded = decodeWorkerUpdateHandoff({
    requestId: request.requestId,
    projectId: request.projectId,
    workType,
    workId: identity.workId,
    runId: identity.runId,
    claimToken: identity.claimToken,
    checkpoint: {
      conversationId: request.checkpoint?.conversationId ?? null,
      workspacePath: request.checkpoint?.workspacePath ?? null,
    },
  });
  let outcome;
  try {
    outcome = await services.handoffExecutionWorkerClaim(input.db, {
      requestId: decoded.requestId,
      organizationId: worker.principal.organizationId,
      deviceId: worker.principal.deviceId,
      projectId: decoded.projectId,
      workerId: worker.binding.id,
      workType: decoded.workType,
      workId: decoded.workId,
      runId: decoded.runId ?? null,
      claimTokenHash,
      metadata: decoded.checkpoint,
      observedAt,
    });
  } catch (error) {
    try {
      await services.failExecutionWorkerUpdateHandoff(input.db, {
        requestId: decoded.requestId,
        organizationId: worker.principal.organizationId,
        deviceId: worker.principal.deviceId,
        projectId: decoded.projectId,
        workerId: worker.binding.id,
        workType: decoded.workType,
        workId: decoded.workId,
        runId: decoded.runId ?? null,
        claimTokenHash,
        metadata: decoded.checkpoint,
        error: error instanceof Error ? error.message : String(error),
        observedAt,
      });
    } catch (failureError) {
      console.error(
        `worker update handoff failure could not be recorded: ${
          failureError instanceof Error ? failureError.message : String(failureError)
        }`,
      );
    }
    throw error;
  }
  if (outcome.outcome === "not_ready") {
    throw new HttpError(409, "Worker update handoff is not draining");
  }
  if (outcome.outcome === "not_active") {
    throw new HttpError(409, "Worker claim is no longer active");
  }
  const status = await services.executionWorkerUpdateStatus(input.db, {
    deviceId: worker.principal.deviceId,
    requestId: decoded.requestId,
    observedAt: new Date().toISOString(),
  });
  return {
    outcome: outcome.outcome === "already_handed_off"
      ? HandoffWorkResponse_Outcome.ALREADY_RELEASED
      : HandoffWorkResponse_Outcome.RELEASED,
    requestId: decoded.requestId,
    state: status?.request.handoffState === "ready"
      ? HandoffWorkResponse_State.READY
      : HandoffWorkResponse_State.DRAINING,
    activeWorkCount: outcome.activeWorkCount,
    ready: status?.ready ?? false,
  };
}

const channelReplyConversationId = (value: string | undefined) => {
  if (value === undefined) return null;
  const conversationId = value.trim();
  if (conversationId.length < 1 || conversationId.length > 1_024) {
    throw new HttpError(
      400,
      "Channel reply conversation ID must contain 1-1024 characters",
    );
  }
  return conversationId;
};

async function checkpointChannelReplySessionRpc(
  input: WorkerConnectQueueInput,
  request: CheckpointChannelReplySessionRequest,
  services: WorkerQueueServices,
) {
  const identity = requiredWork(request.work);
  if (identity.work.case !== "channelReply") {
    throw new HttpError(400, "Channel reply claim identity is required");
  }
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  const organizationId = identity.work.value.organizationId;
  if (organizationId !== worker.principal.organizationId) {
    throw new HttpError(403, "Worker is not enabled for this organization");
  }

  const observedAt = new Date().toISOString();
  const claimTokenHash = await services.sha256(identity.claimToken);
  const claimed = await services.getClaimedChannelReply(input.db, {
    jobId: identity.workId,
    deviceId: worker.principal.deviceId,
    workerId: worker.binding.id,
    claimTokenHash,
    observedAt,
  });
  if (
    !claimed || claimed.organization_id !== organizationId ||
    claimed.channel_id !== identity.runId
  ) {
    throw new HttpError(409, "Channel reply claim is no longer active");
  }

  const session = await services.checkpointChannelReplySession(input.db, {
    jobId: identity.workId,
    deviceId: worker.principal.deviceId,
    workerId: worker.binding.id,
    claimTokenHash,
    conversationId: channelReplyConversationId(request.conversationId),
    observedAt,
  });
  if (!session) {
    throw new HttpError(409, "Channel reply session is no longer active");
  }
  return create(CheckpointChannelReplySessionResponseSchema, {
    retainedUntil: timestamp(session.retained_until, "session retention"),
  });
}

async function completeProjectAgentTask(
  input: WorkerConnectQueueInput,
  request: CompleteProjectAgentTaskRequest,
  services: WorkerQueueServices,
) {
  const identity = requiredWork(request.work);
  if (
    identity.work.case !== "projectAgentTask" ||
    identity.workId !== identity.runId
  ) {
    throw new HttpError(400, "Project Agent task claim identity is required");
  }
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  const result = request.result;
  if (result.case === "success") {
    const success = decodeProjectAgentTaskSuccess({
      summary: result.value.summary,
      conversationId: result.value.conversationId,
    });
    return services.completeProjectAgentTaskWork({
      db: input.db,
      env: input.env,
      context: input.context,
      projectId: request.projectId,
      taskId: identity.workId,
      workerId: worker.binding.id,
      claimTokenHash: await services.sha256(identity.claimToken),
      result: {
        case: "success",
        summary: success.summary,
        conversationId: success.conversationId ?? null,
      },
    });
  }
  if (result.case === "failure") {
    const failure = decodeProjectAgentTaskFailure({
      error: result.value.error,
    });
    return services.completeProjectAgentTaskWork({
      db: input.db,
      env: input.env,
      context: input.context,
      projectId: request.projectId,
      taskId: identity.workId,
      workerId: worker.binding.id,
      claimTokenHash: await services.sha256(identity.claimToken),
      result: { case: "failure", error: failure.error },
    });
  }
  throw new HttpError(400, "Project Agent task result is required");
}

async function mergeBatchIdentity(
  input: WorkerConnectQueueInput,
  request: {
    projectId: string;
    workerId: string;
    work?: WorkClaimIdentity;
  },
  services: WorkerQueueServices,
) {
  const work = requiredWork(request.work);
  if (work.work.case !== "mergeBatch" || work.workId !== work.runId) {
    throw new HttpError(400, "Merge batch claim identity is required");
  }
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  return {
    batchId: work.workId,
    projectId: request.projectId,
    workerId: worker.binding.id,
    claimTokenHash: await services.sha256(work.claimToken),
  };
}

async function recordMergeBatchCandidateEnqueuedRpc(
  input: WorkerConnectQueueInput,
  request: RecordMergeBatchCandidateEnqueuedRequest,
  services: WorkerQueueServices,
) {
  const identity = await mergeBatchIdentity(input, request, services);
  const result = await services.recordMergeBatchCandidateEnqueuedWork(
    input.db,
    identity,
    {
      candidateId: request.candidateId,
      expectedHeadSha: request.expectedHeadSha,
      expectedBaseSha: request.expectedBaseSha,
      queueEntryId: request.queueEntryId,
    },
  );
  return create(RecordMergeBatchCandidateEnqueuedResponseSchema, {
    batchId: result.batchId,
    candidateId: result.candidateId,
    state: mergeBatchState(result.state),
  });
}

async function recordMergeBatchAuthorityRpc(
  input: WorkerConnectQueueInput,
  request: RecordMergeBatchAuthorityRequest,
  services: WorkerQueueServices,
) {
  const identity = await mergeBatchIdentity(input, request, services);
  const result = await services.recordMergeBatchAuthorityWork(
    input.db,
    identity,
    {
      integrationRef: request.integrationRef,
      integrationSha: request.integrationSha,
      baseSha: request.baseSha,
    },
  );
  return create(RecordMergeBatchAuthorityResponseSchema, {
    batchId: result.batchId,
    state: mergeBatchState(result.state),
    mergeGroupSha: result.mergeGroupSha,
  });
}

const validationFailure = (
  value: MergeBatchValidationFailureCode | undefined,
) => {
  switch (value) {
    case undefined:
    case MergeBatchValidationFailureCode.UNSPECIFIED:
      return null;
    case MergeBatchValidationFailureCode.CI_FAILED:
      return "ci_failed" as const;
    case MergeBatchValidationFailureCode.OUTPUT_LIMIT:
      return "output_limit" as const;
    default:
      throw new HttpError(400, "Unknown merge batch validation failure code");
  }
};

async function recordMergeBatchValidationRpc(
  input: WorkerConnectQueueInput,
  request: RecordMergeBatchValidationRequest,
  services: WorkerQueueServices,
) {
  if (!request.validationResults) {
    throw new HttpError(400, "Merge batch validation results are required");
  }
  const identity = await mergeBatchIdentity(input, request, services);
  const result = await services.recordMergeBatchValidationWork(
    input.db,
    identity,
    {
      mergeGroupSha: request.mergeGroupSha,
      validationResults: request.validationResults.results.map((item) => ({
        context: item.context,
        passed: item.passed,
        exitCode: item.exitCode,
        failureCode: validationFailure(item.failureCode),
        log: item.log,
        logSha256: item.logSha256,
        logTruncated: item.logTruncated,
      })),
    },
  );
  return create(RecordMergeBatchValidationResponseSchema, {
    batchId: result.batchId,
    state: mergeBatchState(result.state),
    validatedAt: timestamp(result.validatedAt, "validation"),
  });
}

async function completeMergeBatchPublicationRpc(
  input: WorkerConnectQueueInput,
  request: CompleteMergeBatchPublicationRequest,
  services: WorkerQueueServices,
) {
  const identity = await mergeBatchIdentity(input, request, services);
  const result = await services.completeMergeBatchPublicationWork(
    input.db,
    identity,
    { mergeGroupSha: request.mergeGroupSha },
  );
  return create(CompleteMergeBatchPublicationResponseSchema, {
    batchId: result.batchId,
    state: mergeBatchState(result.state),
    publishedAt: timestamp(result.publishedAt, "publication"),
  });
}

async function blockMergeBatchRpc(
  input: WorkerConnectQueueInput,
  request: BlockMergeBatchRequest,
  services: WorkerQueueServices,
) {
  const identity = await mergeBatchIdentity(input, request, services);
  const result = await services.blockMergeBatchWork(input.db, identity, {
    code: request.code,
    detail: request.detail,
  });
  return create(BlockMergeBatchResponseSchema, {
    batchId: result.batchId,
    state: mergeBatchState(result.state),
  });
}

const replyCompletionDisposition = (
  value: "completed" | "requeued" | "failed",
) => {
  switch (value) {
    case "completed": return ReplyCompletionDisposition.COMPLETED;
    case "requeued": return ReplyCompletionDisposition.REQUEUED;
    case "failed": return ReplyCompletionDisposition.FAILED;
  }
};

async function replyCompletionOperation<Value>(
  operation: () => Promise<Value>,
) {
  try {
    return await operation();
  } catch (error) {
    return rethrowReplyCompletionHttpError(error);
  }
}

const preventCapabilityCaching = (context: HandlerContext) => {
  context.responseHeader.set("Cache-Control", "private, no-store");
};

async function prepareReplyAttachmentUploadsRpc(
  input: WorkerConnectQueueInput,
  request: PrepareReplyAttachmentUploadsRequest,
  context: HandlerContext,
  services: WorkerQueueServices,
) {
  preventCapabilityCaching(context);
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  const prepared = await replyCompletionOperation(() =>
    services.prepareReplyAttachmentUploadsApplication({
      db: input.db,
      env: input.env,
      context: input.context,
      worker,
      request: prepareReplyAttachmentUploadsInputFromProto(request),
    })
  );
  return create(PrepareReplyAttachmentUploadsResponseSchema, {
    replayed: prepared.replayed,
    uploads: prepared.uploads.map((upload) => ({
      clientId: upload.clientId,
      reference: { attachmentId: upload.attachmentId },
      uploadUrl: new URL(
        `/reply-attachment-uploads/${encodeURIComponent(upload.attachmentId)}`,
        input.request.url,
      ).toString(),
      uploadCapability: upload.uploadCapability,
      expiresAt: timestamp(upload.expiresAt, "reply upload expiry"),
    })),
  });
}

async function completeIssueReplyRpc(
  input: WorkerConnectQueueInput,
  request: CompleteIssueReplyRequest,
  services: WorkerQueueServices,
) {
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  const completed = await replyCompletionOperation(() =>
    services.completeIssueReplyApplication({
      db: input.db,
      env: input.env,
      context: input.context,
      worker,
      request: completeIssueReplyInputFromProto(request),
    })
  );
  return create(CompleteIssueReplyResponseSchema, {
    replayed: completed.replayed,
    disposition: replyCompletionDisposition(completed.disposition),
  });
}

async function completeChannelReplyRpc(
  input: WorkerConnectQueueInput,
  request: CompleteChannelReplyRequest,
  services: WorkerQueueServices,
) {
  const worker = await authenticatedWorker(
    input,
    request.projectId,
    request.workerId,
    services,
  );
  const completed = await replyCompletionOperation(() =>
    services.completeChannelReplyApplication({
      db: input.db,
      env: input.env,
      context: input.context,
      worker,
      request: completeChannelReplyInputFromProto(request),
    })
  );
  return create(CompleteChannelReplyResponseSchema, {
    replayed: completed.replayed,
    disposition: replyCompletionDisposition(completed.disposition),
    retainedUntil: completed.retainedUntil
      ? timestamp(completed.retainedUntil, "channel reply retention")
      : undefined,
  });
}

export function createWorkerQueueService(
  input: WorkerConnectQueueInput,
  overrides: Partial<WorkerQueueServices> = {},
): ServiceImpl<typeof WorkerQueueService> {
  const services = { ...workerQueueServices, ...overrides };
  return {
    claimWork: (request) => claimWork(input, request, services),
    renewWorkLease: (request) => renewWorkLease(input, request, services),
    checkpointChannelReplySession: (request) => checkpointChannelReplySessionRpc(input, request, services),
    handoffWork: (request) => handoffWork(input, request, services),
    completeProjectAgentTask: (request) => completeProjectAgentTask(input, request, services),
    recordMergeBatchCandidateEnqueued: (request) => recordMergeBatchCandidateEnqueuedRpc(input, request, services),
    recordMergeBatchAuthority: (request) => recordMergeBatchAuthorityRpc(input, request, services),
    recordMergeBatchValidation: (request) => recordMergeBatchValidationRpc(input, request, services),
    completeMergeBatchPublication: (request) => completeMergeBatchPublicationRpc(input, request, services),
    blockMergeBatch: (request) => blockMergeBatchRpc(input, request, services),
    prepareReplyAttachmentUploads: (request, context) => prepareReplyAttachmentUploadsRpc(input, request, context, services),
    completeIssueReply: (request) => completeIssueReplyRpc(input, request, services),
    completeChannelReply: (request) => completeChannelReplyRpc(input, request, services),
  };
}

export function registerWorkerQueueService(
  router: ConnectRouter,
  input: WorkerConnectQueueInput,
) {
  router.service(WorkerQueueService, createWorkerQueueService(input));
}
