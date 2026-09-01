import { create, fromJson, toJson } from "@bufbuild/protobuf";
import * as Schema from "effect/Schema";
import { timestampFromDate, ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  DmMemoryBriefState,
  DmMemoryDescriptorSchema,
} from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import {
  BlockMergeBatchResponseSchema,
  CheckpointChannelReplySessionResponseSchema,
  CompleteChannelReplyResponseSchema,
  CompleteIssueReplyResponseSchema,
  CompleteMergeBatchPublicationResponseSchema,
  CheckDmMemoryClaimResponseSchema,
  GetDmMemoryBriefResponseSchema,
  HandoffWorkResponse_Outcome,
  HandoffWorkResponse_State,
  LookupDmMemoryResponseSchema,
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
  type CheckDmMemoryClaimRequest,
  type CheckpointChannelReplySessionRequest,
  type CompleteChannelReplyRequest,
  type CompleteIssueReplyRequest,
  type CompleteMergeBatchPublicationRequest,
  type CompleteProjectAgentTaskRequest,
  type DmMemoryClaimIdentity,
  DmMemoryLearningFailure,
  DmMemoryLearningStage,
  type DmMemoryLearningRequestIdentity,
  type FailDmMemoryLearningRequest,
  type GetDmMemoryBriefRequest,
  type LookupDmMemoryRequest,
  type PrepareReplyAttachmentUploadsRequest,
  type ReserveDmMemoryLearningCallRequest,
  type RecordMergeBatchAuthorityRequest,
  type RecordMergeBatchCandidateEnqueuedRequest,
  type RecordMergeBatchValidationRequest,
  type WorkClaimIdentity,
  type SubmitDmMemoryLearningProposalRequest,
  type SubmitDmMemoryLearningVerificationRequest,
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
  claimDmLearningJob,
  failDmLearningClaim,
  renewDmLearningClaim,
  type DmLearningClaimIdentity,
} from "./dm-memory-learning-claims";
import {
  reserveDmLearningModelCall,
  submitDmLearningProposal,
  submitDmLearningVerification,
} from "./dm-memory-learning-model-calls";
import { dmLearningPolicy } from "./dm-memory-learning-policy";
import { DmLearningError } from "./dm-memory-learning-validation";
import {
  DmLearningProposal,
  DmLearningUsage,
  DmLearningVerification,
} from "../../src/lib/dm-memory-learning-contract";
import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
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
import {
  checkDmMemoryClaim,
  getDmMemoryClaimBrief,
  lookupDmMemoryClaim,
} from "./dm-memory-claim-application";

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
  readonly claimDmLearningJob: typeof claimDmLearningJob;
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
  readonly checkDmMemoryClaim: typeof checkDmMemoryClaim;
  readonly getDmMemoryClaimBrief: typeof getDmMemoryClaimBrief;
  readonly lookupDmMemoryClaim: typeof lookupDmMemoryClaim;
  readonly reserveDmLearningModelCall: typeof reserveDmLearningModelCall;
  readonly submitDmLearningProposal: typeof submitDmLearningProposal;
  readonly submitDmLearningVerification: typeof submitDmLearningVerification;
  readonly renewDmLearningClaim: typeof renewDmLearningClaim;
  readonly failDmLearningClaim: typeof failDmLearningClaim;
};

const workerQueueServices: WorkerQueueServices = {
  requireWorkerProjectBinding,
  claimNextMergeBatchWork,
  claimNextIssueReplyWork,
  claimNextProjectAgentTaskWork,
  completeProjectAgentTaskWork,
  claimNextChannelReplyWork,
  claimNextQueueWork,
  claimDmLearningJob,
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
  checkDmMemoryClaim,
  getDmMemoryClaimBrief,
  lookupDmMemoryClaim,
  reserveDmLearningModelCall,
  submitDmLearningProposal,
  submitDmLearningVerification,
  renewDmLearningClaim,
  failDmLearningClaim,
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

const rethrowDmLearningError = (error: unknown): never => {
  if (!(error instanceof DmLearningError)) throw error;
  const status = error.code === "stale" || error.code === "scope_revoked"
    ? 409
    : error.code === "invalid_proposal" ||
        error.code === "verification_rejected"
    ? 422
    : error.code === "budget_exhausted"
    ? 429
    : 503;
  throw new HttpError(
    status,
    "Memory learning could not complete",
    `memory_${error.code}`,
  );
};

const dmLearningPolicyFor = (input: WorkerConnectQueueInput, organizationId: string) => {
  const policy = dmLearningPolicy(input.env, organizationId);
  if (!policy) throw new DmLearningError("model_configuration");
  return policy;
};

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

    const policy = dmLearningPolicy(
      input.env,
      worker.principal.organizationId,
    );
    if (policy) {
      const learning = await services.claimDmLearningJob(input.db, {
        organizationId: worker.principal.organizationId,
        deviceId: worker.principal.deviceId,
        workerId: claimInput.workerId,
        projectId: claimInput.projectId,
        policy,
        now: new Date().toISOString(),
      });
      if (learning) return { work: workerClaimMessage(learning) };
    }
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
    case "dmMemory": {
      if (
        identity.work.value.organizationId !==
          worker.principal.organizationId
      ) {
        throw new HttpError(403, "Worker is not enabled for this organization");
      }
      try {
        const renewed = await services.renewDmLearningClaim(input.db, {
          identity: {
            organizationId: worker.principal.organizationId,
            deviceId: worker.principal.deviceId,
            workerId: worker.binding.id,
            jobId: identity.workId,
            claimTokenHash,
          },
          policy: dmLearningPolicyFor(
            input,
            worker.principal.organizationId,
          ),
          inputHash: identity.work.value.inputHash,
          now: observedAt,
        });
        return create(RenewWorkLeaseResponseSchema, {
          leaseExpiresAt: timestamp(renewed, "lease expiry"),
          work: { case: "dmMemory", value: {} },
        });
      } catch (error) {
        return rethrowDmLearningError(error);
      }
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

  if (identity.work.case === "dmMemory") {
    if (
      identity.work.value.organizationId !== worker.principal.organizationId
    ) {
      throw new HttpError(403, "Worker is not enabled for this organization");
    }
    const released = await services.failDmLearningClaim(
      input.db,
      {
        organizationId: worker.principal.organizationId,
        deviceId: worker.principal.deviceId,
        workerId: worker.binding.id,
        jobId: identity.workId,
        claimTokenHash,
      },
      "model_unavailable",
      observedAt,
    );
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
      reference: { uploadId: upload.attachmentId },
      uploadUrl: new URL(
        `/uploads/${encodeURIComponent(upload.attachmentId)}`,
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

const dmMemoryDescriptorMessage = (value: {
  protocol: 1;
  memorySpaceId: string;
  memoryRevision: number;
  revocationEpoch: number;
  searchEnabled: boolean;
  briefState: "available" | "disabled";
}) => create(DmMemoryDescriptorSchema, {
  protocol: value.protocol,
  memorySpaceId: value.memorySpaceId,
  memoryRevision: BigInt(value.memoryRevision),
  revocationEpoch: BigInt(value.revocationEpoch),
  searchEnabled: value.searchEnabled,
  briefState: value.briefState === "available"
    ? DmMemoryBriefState.AVAILABLE
    : DmMemoryBriefState.DISABLED,
});

const dmMemoryScope = async (
  input: WorkerConnectQueueInput,
  claim: DmMemoryClaimIdentity | undefined,
  services: WorkerQueueServices,
) => {
  if (!claim) throw new HttpError(400, "DM memory claim is required");
  const work = requiredWork(claim.work);
  if (work.work.case !== "channelReply") {
    throw new HttpError(400, "DM memory requires a channel reply claim");
  }
  if (claim.revocationEpoch > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(400, "DM memory revocation epoch is too large");
  }
  const worker = await authenticatedWorker(
    input,
    claim.projectId,
    claim.workerId,
    services,
  );
  return {
    jobId: work.workId,
    workerId: claim.workerId,
    deviceId: worker.principal.deviceId,
    claimToken: work.claimToken,
    revocationEpoch: Number(claim.revocationEpoch),
  };
};

async function checkDmMemoryClaimRpc(
  input: WorkerConnectQueueInput,
  request: CheckDmMemoryClaimRequest,
  services: WorkerQueueServices,
) {
  const scope = await dmMemoryScope(input, request.claim, services);
  const memory = await services.checkDmMemoryClaim(input.db, input.env, scope);
  return create(CheckDmMemoryClaimResponseSchema, {
    memory: dmMemoryDescriptorMessage(memory),
  });
}

async function getDmMemoryBriefRpc(
  input: WorkerConnectQueueInput,
  request: GetDmMemoryBriefRequest,
  services: WorkerQueueServices,
) {
  const scope = await dmMemoryScope(input, request.claim, services);
  const result = await services.getDmMemoryClaimBrief(input.db, input.env, scope);
  return create(GetDmMemoryBriefResponseSchema, {
    memory: dmMemoryDescriptorMessage(result.memory),
    brief: fromJson(ValueSchema, result.brief),
  });
}

async function lookupDmMemoryRpc(
  input: WorkerConnectQueueInput,
  request: LookupDmMemoryRequest,
  services: WorkerQueueServices,
) {
  const scope = await dmMemoryScope(input, request.claim, services);
  if (!request.requestId || !request.request) {
    throw new HttpError(400, "DM memory lookup request is incomplete");
  }
  const response = await services.lookupDmMemoryClaim(
    input.db,
    input.env,
    scope,
    request.requestId,
    toJson(ValueSchema, request.request),
  );
  return create(LookupDmMemoryResponseSchema, {
    response: fromJson(ValueSchema, response),
  });
}

const learningJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  bytes: Uint8Array,
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    throw new HttpError(400, "Invalid memory learning payload");
  }
};

const learningJsonBytes = (value: unknown) =>
  new TextEncoder().encode(dmMemoryCanonicalJson(value));

const learningNumber = (value: bigint, field: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new HttpError(400, `${field} exceeds JavaScript's safe integer range`);
  }
  return number;
};

const learningUsage = (
  value: { inputTokens: bigint; outputTokens: bigint; costMicroUsd?: bigint } |
    undefined,
) => {
  if (!value) throw new HttpError(400, "Memory learning usage is required");
  return Schema.decodeSync(DmLearningUsage)({
    inputTokens: learningNumber(value.inputTokens, "input_tokens"),
    outputTokens: learningNumber(value.outputTokens, "output_tokens"),
    costMicroUsd: value.costMicroUsd === undefined
      ? null
      : learningNumber(value.costMicroUsd, "cost_micro_usd"),
  });
};

const learningStage = (value: DmMemoryLearningStage) => {
  switch (value) {
    case DmMemoryLearningStage.PROPOSING: return "proposing" as const;
    case DmMemoryLearningStage.VERIFYING: return "verifying" as const;
    default: throw new HttpError(400, "Memory learning stage is required");
  }
};

const learningFailure = (value: DmMemoryLearningFailure) => {
  switch (value) {
    case DmMemoryLearningFailure.INVALID_PROPOSAL: return "invalid_proposal" as const;
    case DmMemoryLearningFailure.VERIFICATION_REJECTED: return "verification_rejected" as const;
    case DmMemoryLearningFailure.STALE: return "stale" as const;
    case DmMemoryLearningFailure.SCOPE_REVOKED: return "scope_revoked" as const;
    case DmMemoryLearningFailure.BUDGET_EXHAUSTED: return "budget_exhausted" as const;
    case DmMemoryLearningFailure.MODEL_UNAVAILABLE: return "model_unavailable" as const;
    case DmMemoryLearningFailure.MODEL_TIMEOUT: return "model_timeout" as const;
    case DmMemoryLearningFailure.MODEL_CREDENTIALS: return "model_credentials" as const;
    case DmMemoryLearningFailure.MODEL_CONFIGURATION: return "model_configuration" as const;
    case DmMemoryLearningFailure.INPUT_CAPACITY: return "input_capacity" as const;
    default: throw new HttpError(400, "Memory learning failure code is required");
  }
};

async function dmLearningScope(
  input: WorkerConnectQueueInput,
  claim: DmMemoryLearningRequestIdentity | undefined,
  services: WorkerQueueServices,
) {
  if (!claim) throw new HttpError(400, "Memory learning claim is required");
  const work = requiredWork(claim.work);
  const worker = await authenticatedWorker(
    input,
    claim.projectId,
    claim.workerId,
    services,
  );
  if (
    work.work.case !== "dmMemory" || work.workId !== work.runId ||
    work.work.value.organizationId !== worker.principal.organizationId ||
    !work.work.value.inputHash
  ) {
    throw new HttpError(400, "Memory learning claim identity is invalid");
  }
  return {
    identity: {
      organizationId: worker.principal.organizationId,
      deviceId: worker.principal.deviceId,
      workerId: worker.binding.id,
      jobId: work.workId,
      claimTokenHash: await services.sha256(work.claimToken),
    } satisfies DmLearningClaimIdentity,
    inputHash: work.work.value.inputHash,
    organizationId: worker.principal.organizationId,
  };
}

async function reserveDmMemoryLearningCallRpc(
  input: WorkerConnectQueueInput,
  request: ReserveDmMemoryLearningCallRequest,
  services: WorkerQueueServices,
) {
  try {
    const scope = await dmLearningScope(input, request.claim, services);
    const result = await services.reserveDmLearningModelCall(input.db, {
      ...scope,
      policy: dmLearningPolicyFor(input, scope.organizationId),
      callId: request.callId,
      stage: learningStage(request.stage),
      now: new Date().toISOString(),
    });
    return create(WorkerQueueService.method.reserveDmMemoryLearningCall.output, {
      json: learningJsonBytes(result),
    });
  } catch (error) {
    return rethrowDmLearningError(error);
  }
}

async function submitDmMemoryLearningProposalRpc(
  input: WorkerConnectQueueInput,
  request: SubmitDmMemoryLearningProposalRequest,
  services: WorkerQueueServices,
) {
  try {
    const scope = await dmLearningScope(input, request.claim, services);
    const result = await services.submitDmLearningProposal(input.db, {
      ...scope,
      policy: dmLearningPolicyFor(input, scope.organizationId),
      callId: request.callId,
      proposal: learningJson(DmLearningProposal, request.proposalJson),
      usage: learningUsage(request.usage),
      now: new Date().toISOString(),
    });
    return create(WorkerQueueService.method.submitDmMemoryLearningProposal.output, {
      json: learningJsonBytes(result),
    });
  } catch (error) {
    return rethrowDmLearningError(error);
  }
}

async function submitDmMemoryLearningVerificationRpc(
  input: WorkerConnectQueueInput,
  request: SubmitDmMemoryLearningVerificationRequest,
  services: WorkerQueueServices,
) {
  try {
    const scope = await dmLearningScope(input, request.claim, services);
    const result = await services.submitDmLearningVerification(input.db, {
      ...scope,
      policy: dmLearningPolicyFor(input, scope.organizationId),
      callId: request.callId,
      proposalId: request.proposalId,
      proposalHash: request.proposalHash,
      verification: learningJson(
        DmLearningVerification,
        request.verificationJson,
      ),
      usage: learningUsage(request.usage),
      now: new Date().toISOString(),
    });
    return create(
      WorkerQueueService.method.submitDmMemoryLearningVerification.output,
      { json: learningJsonBytes(result) },
    );
  } catch (error) {
    return rethrowDmLearningError(error);
  }
}

async function failDmMemoryLearningRpc(
  input: WorkerConnectQueueInput,
  request: FailDmMemoryLearningRequest,
  services: WorkerQueueServices,
) {
  try {
    const scope = await dmLearningScope(input, request.claim, services);
    if ((request.callId === undefined) !== (request.usage === undefined)) {
      throw new HttpError(400, "Memory learning accounting is incomplete");
    }
    const released = await services.failDmLearningClaim(
      input.db,
      scope.identity,
      learningFailure(request.code),
      new Date().toISOString(),
      request.callId && request.usage
        ? { callId: request.callId, usage: learningUsage(request.usage) }
        : undefined,
    );
    return create(WorkerQueueService.method.failDmMemoryLearning.output, {
      released,
    });
  } catch (error) {
    return rethrowDmLearningError(error);
  }
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
    checkDmMemoryClaim: (request) => checkDmMemoryClaimRpc(input, request, services),
    getDmMemoryBrief: (request) => getDmMemoryBriefRpc(input, request, services),
    lookupDmMemory: (request) => lookupDmMemoryRpc(input, request, services),
    reserveDmMemoryLearningCall: (request) =>
      reserveDmMemoryLearningCallRpc(input, request, services),
    submitDmMemoryLearningProposal: (request) =>
      submitDmMemoryLearningProposalRpc(input, request, services),
    submitDmMemoryLearningVerification: (request) =>
      submitDmMemoryLearningVerificationRpc(input, request, services),
    failDmMemoryLearning: (request) =>
      failDmMemoryLearningRpc(input, request, services),
  };
}

export function registerWorkerQueueService(
  router: ConnectRouter,
  input: WorkerConnectQueueInput,
) {
  router.service(WorkerQueueService, createWorkerQueueService(input));
}
