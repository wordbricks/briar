import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import {
  ClaimWorkRequestSchema,
  HandoffWorkRequestSchema,
  HandoffWorkResponse_Outcome,
  IssueClaimIdentitySchema,
  ProjectAgentTaskClaimIdentitySchema,
  RenewWorkLeaseRequestSchema,
  WorkClaimIdentitySchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./http-response";
import { requireWorkerProjectBinding } from "./worker-route-auth";
import {
  createWorkerQueueService,
  type WorkerQueueServices,
} from "./worker-connect-queue";

const projectId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const workId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const workerId = "worker-1";
const claimToken = `briar_claim_${"a".repeat(64)}`;
const context = {} as HandlerContext;

const input = {
  request: new Request("https://briar.example/briar.worker.v1.WorkerQueueService", {
    headers: { Authorization: "Bearer briar_worker_test" },
  }),
  db: {} as D1Database,
  env: {} as Env,
};

const worker = {
  principal: { organizationId, deviceId },
  binding: { id: workerId },
} as Awaited<ReturnType<typeof requireWorkerProjectBinding>>;

const authentication = () => {
  const authenticate = vi.fn<WorkerQueueServices["requireWorkerProjectBinding"]>();
  authenticate.mockResolvedValue(worker);
  return authenticate;
};

const taskIdentity = () => create(WorkClaimIdentitySchema, {
  workId,
  runId: workId,
  claimToken,
  work: {
    case: "projectAgentTask",
    value: create(ProjectAgentTaskClaimIdentitySchema),
  },
});

const issueIdentity = () => create(WorkClaimIdentitySchema, {
  workId,
  runId: workId,
  claimToken,
  work: {
    case: "issue",
    value: create(IssueClaimIdentitySchema),
  },
});

describe("WorkerQueueService lifecycle semantics", () => {
  it("requires the Worker bearer binding before claiming", async () => {
    const authenticate = vi.fn<WorkerQueueServices["requireWorkerProjectBinding"]>();
    authenticate.mockRejectedValue(new HttpError(401, "Invalid Worker token"));
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authenticate,
    });

    const request = create(ClaimWorkRequestSchema, {
      projectId,
      workerId,
      claimedBy: "worker",
    });
    const error = await Promise.resolve(service.claimWork(request, context))
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Unauthenticated);
    expect(authenticate).toHaveBeenCalledWith(
      input.db,
      input.request,
      projectId,
      workerId,
    );
  });

  it("maps a lost task lease to a generated RPC conflict", async () => {
    const authenticate = authentication();
    const renew = vi.fn<WorkerQueueServices["renewProjectAgentTaskLease"]>();
    renew.mockResolvedValue(null);
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authenticate,
      sha256: async () => "b".repeat(64),
      renewProjectAgentTaskLease: renew,
    });

    const request = create(RenewWorkLeaseRequestSchema, {
      projectId,
      workerId,
      work: taskIdentity(),
    });
    const error = await Promise.resolve(service.renewWorkLease(request, context))
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect(renew).toHaveBeenCalledWith(
      input.db,
      projectId,
      workId,
      expect.objectContaining({ workerId, claimTokenHash: "b".repeat(64) }),
    );
  });

  it("preserves handoff correlation and reports an idempotent replay", async () => {
    const authenticate = authentication();
    const handoff = vi.fn<WorkerQueueServices["handoffExecutionWorkerClaim"]>();
    handoff
      .mockResolvedValueOnce({ outcome: "handed_off", activeWorkCount: 1 })
      .mockResolvedValueOnce({ outcome: "already_handed_off", activeWorkCount: 0 });
    const status = vi.fn<WorkerQueueServices["executionWorkerUpdateStatus"]>();
    status.mockResolvedValue(null);
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authenticate,
      sha256: async () => "c".repeat(64),
      handoffExecutionWorkerClaim: handoff,
      executionWorkerUpdateStatus: status,
    });
    const request = create(HandoffWorkRequestSchema, {
      requestId,
      projectId,
      workerId,
      work: issueIdentity(),
      checkpoint: { conversationId: "conversation-1" },
    });

    const first = await service.handoffWork(request, context);
    const replay = await service.handoffWork(request, context);
    expect(first.outcome).toBe(HandoffWorkResponse_Outcome.RELEASED);
    expect(replay.outcome).toBe(HandoffWorkResponse_Outcome.ALREADY_RELEASED);
    expect(replay.requestId).toBe(requestId);
    expect(handoff).toHaveBeenNthCalledWith(
      2,
      input.db,
      expect.objectContaining({
        requestId,
        workId,
        runId: workId,
        claimTokenHash: "c".repeat(64),
        metadata: { conversationId: "conversation-1", workspacePath: null },
      }),
    );
  });
});
