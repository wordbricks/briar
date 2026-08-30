import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  HandoffWorkResponse_Outcome,
  HandoffWorkResponse_State,
  RenewWorkLeaseResponseSchema,
  WorkerQueueService,
  type CompleteProjectAgentTaskRequest,
  type WorkClaimIdentity,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import {
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
  claimNextMergeBatchWork,
} from "./merge-batch-routes";
import {
  releaseMergeBatchLease,
  renewMergeBatchLease,
} from "./merge-batches";
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
import { withConnectErrors } from "./app-connect-errors";
import { workerClaimMessage } from "./worker-connect-mappers";

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
  readonly renewMergeBatchLease: typeof renewMergeBatchLease;
  readonly getChannelReplySession: typeof getChannelReplySession;
  readonly issueActivityCredential: typeof issueActivityCredential;
  readonly channelActivityCredential: typeof channelActivityCredential;
  readonly auditExecutionEvent: typeof auditExecutionEvent;
  readonly releaseMergeBatchLease: typeof releaseMergeBatchLease;
  readonly handoffExecutionWorkerClaim: typeof handoffExecutionWorkerClaim;
  readonly failExecutionWorkerUpdateHandoff: typeof failExecutionWorkerUpdateHandoff;
  readonly executionWorkerUpdateStatus: typeof executionWorkerUpdateStatus;
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
  renewMergeBatchLease,
  getChannelReplySession,
  issueActivityCredential,
  channelActivityCredential,
  auditExecutionEvent,
  releaseMergeBatchLease,
  handoffExecutionWorkerClaim,
  failExecutionWorkerUpdateHandoff,
  executionWorkerUpdateStatus,
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

export function createWorkerQueueService(
  input: WorkerConnectQueueInput,
  overrides: Partial<WorkerQueueServices> = {},
): ServiceImpl<typeof WorkerQueueService> {
  const services = { ...workerQueueServices, ...overrides };
  return {
    claimWork: (request) =>
      withConnectErrors(() => claimWork(input, request, services)),
    renewWorkLease: (request) =>
      withConnectErrors(() => renewWorkLease(input, request, services)),
    handoffWork: (request) =>
      withConnectErrors(() => handoffWork(input, request, services)),
    completeProjectAgentTask: (request) =>
      withConnectErrors(() => completeProjectAgentTask(input, request, services)),
  };
}

export function registerWorkerQueueService(
  router: ConnectRouter,
  input: WorkerConnectQueueInput,
) {
  router.service(WorkerQueueService, createWorkerQueueService(input));
}
