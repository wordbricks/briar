import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import {
  BlockMergeBatchRequestSchema,
  ChannelReplyClaimIdentitySchema,
  ClaimWorkRequestSchema,
  CheckpointChannelReplySessionRequestSchema,
  CompleteMergeBatchPublicationRequestSchema,
  CompleteProjectAgentTaskRequestSchema,
  HandoffWorkRequestSchema,
  HandoffWorkResponse_Outcome,
  IssueClaimIdentitySchema,
  IssueReplyClaimIdentitySchema,
  MergeBatchClaimIdentitySchema,
  MergeBatchState,
  MergeBatchValidationFailureCode,
  ProjectAgentTaskClaimIdentitySchema,
  PrepareReplyAttachmentUploadsRequestSchema,
  RecordMergeBatchAuthorityRequestSchema,
  RecordMergeBatchCandidateEnqueuedRequestSchema,
  RecordMergeBatchValidationRequestSchema,
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
const channelId = "66666666-6666-4666-8666-666666666666";
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

const issueReplyIdentity = () => create(WorkClaimIdentitySchema, {
  workId,
  runId: workId,
  claimToken: `briar_reply_claim_${"a".repeat(64)}`,
  work: {
    case: "issueReply",
    value: create(IssueReplyClaimIdentitySchema),
  },
});

const channelReplyIdentity = () => create(WorkClaimIdentitySchema, {
  workId,
  runId: channelId,
  claimToken,
  work: {
    case: "channelReply",
    value: create(ChannelReplyClaimIdentitySchema, { organizationId }),
  },
});

const mergeBatchIdentity = () => create(WorkClaimIdentitySchema, {
  workId,
  runId: workId,
  claimToken: `briar_merge_claim_${"a".repeat(64)}`,
  work: {
    case: "mergeBatch",
    value: create(MergeBatchClaimIdentitySchema),
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

  it("checkpoints only the exact active channel reply claim", async () => {
    const claimed = vi.fn<WorkerQueueServices["getClaimedChannelReply"]>();
    claimed.mockResolvedValue({
      id: workId,
      organization_id: organizationId,
      channel_id: channelId,
    } as NonNullable<Awaited<ReturnType<
      WorkerQueueServices["getClaimedChannelReply"]
    >>>);
    const checkpoint = vi.fn<
      WorkerQueueServices["checkpointChannelReplySession"]
    >();
    checkpoint.mockResolvedValue({
      retained_until: "2026-08-31T02:00:00.000Z",
    } as NonNullable<Awaited<ReturnType<
      WorkerQueueServices["checkpointChannelReplySession"]
    >>>);
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authentication(),
      sha256: async () => "f".repeat(64),
      getClaimedChannelReply: claimed,
      checkpointChannelReplySession: checkpoint,
    });
    const request = create(CheckpointChannelReplySessionRequestSchema, {
      projectId,
      workerId,
      work: channelReplyIdentity(),
      conversationId: " conversation-1 ",
    });

    const response = await service.checkpointChannelReplySession(
      request,
      context,
    );
    expect(response.retainedUntil).toEqual(expect.objectContaining({
      seconds: BigInt(Date.parse("2026-08-31T02:00:00.000Z") / 1_000),
    }));
    expect(claimed).toHaveBeenCalledWith(input.db, {
      jobId: workId,
      deviceId,
      workerId,
      claimTokenHash: "f".repeat(64),
      observedAt: expect.any(String),
    });
    expect(checkpoint).toHaveBeenCalledWith(input.db, {
      jobId: workId,
      deviceId,
      workerId,
      claimTokenHash: "f".repeat(64),
      conversationId: "conversation-1",
      observedAt: expect.any(String),
    });

    const mismatched = create(CheckpointChannelReplySessionRequestSchema, {
      ...request,
      work: create(WorkClaimIdentitySchema, {
        ...channelReplyIdentity(),
        runId: "77777777-7777-4777-8777-777777777777",
      }),
    });
    const error = await Promise.resolve(
      service.checkpointChannelReplySession(mismatched, context),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect(checkpoint).toHaveBeenCalledTimes(1);
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

  it("completes a typed project task claim through the application boundary", async () => {
    const authenticate = authentication();
    const complete = vi.fn<WorkerQueueServices["completeProjectAgentTaskWork"]>();
    complete.mockResolvedValue({ replayed: true });
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authenticate,
      sha256: async () => "d".repeat(64),
      completeProjectAgentTaskWork: complete,
    });
    const request = create(CompleteProjectAgentTaskRequestSchema, {
      projectId,
      workerId,
      work: taskIdentity(),
      result: {
        case: "success",
        value: {
          summary: "Completed the approved task.",
          conversationId: "conversation-1",
        },
      },
    });

    await expect(service.completeProjectAgentTask(request, context))
      .resolves.toEqual({ replayed: true });
    expect(complete).toHaveBeenCalledWith({
      db: input.db,
      env: input.env,
      context: undefined,
      projectId,
      taskId: workId,
      workerId,
      claimTokenHash: "d".repeat(64),
      result: {
        case: "success",
        summary: "Completed the approved task.",
        conversationId: "conversation-1",
      },
    });
  });

  it("returns no-store upload capabilities from the generated prepare RPC", async () => {
    const prepare = vi.fn<
      WorkerQueueServices["prepareReplyAttachmentUploadsApplication"]
    >().mockResolvedValue({
      replayed: false,
      uploads: [{
        clientId: "artifact",
        attachmentId: "77777777-7777-4777-8777-777777777777",
        uploadCapability: "opaque-capability",
        expiresAt: "2026-08-31T01:10:00.000Z",
      }],
    });
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authentication(),
      prepareReplyAttachmentUploadsApplication: prepare,
    });
    const handlerContext = {
      responseHeader: new Headers(),
    } as HandlerContext;
    const request = create(PrepareReplyAttachmentUploadsRequestSchema, {
      requestId,
      projectId,
      workerId,
      work: issueReplyIdentity(),
      attachments: [{
        clientId: "artifact",
        filename: "artifact.html",
        contentType: "text/html",
        byteSize: 12n,
        sha256: new Uint8Array(32).fill(1),
      }],
    });

    const response = await service.prepareReplyAttachmentUploads(
      request,
      handlerContext,
    );
    expect(handlerContext.responseHeader.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(response).toMatchObject({
      replayed: false,
      uploads: [{
        clientId: "artifact",
        reference: {
          attachmentId: "77777777-7777-4777-8777-777777777777",
        },
        uploadUrl:
          "https://briar.example/reply-attachment-uploads/77777777-7777-4777-8777-777777777777",
        uploadCapability: "opaque-capability",
      }],
    });
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      db: input.db,
      env: input.env,
      worker,
      request: expect.objectContaining({
        requestId,
        projectId,
        workerId,
        attachments: [expect.objectContaining({
          contentType: "text/html",
          byteSize: 12,
        })],
      }),
    }));
  });

  it("reports a full merge-batch progression through one typed claim identity", async () => {
    const authenticate = authentication();
    const candidate = vi.fn<
      WorkerQueueServices["recordMergeBatchCandidateEnqueuedWork"]
    >().mockResolvedValue({
      batchId: workId,
      candidateId: "candidate-1",
      state: "waiting_tail",
    });
    const authority = vi.fn<
      WorkerQueueServices["recordMergeBatchAuthorityWork"]
    >().mockResolvedValue({
      batchId: workId,
      state: "validating",
      mergeGroupSha: "b".repeat(40),
    });
    const validation = vi.fn<
      WorkerQueueServices["recordMergeBatchValidationWork"]
    >().mockResolvedValue({
      batchId: workId,
      state: "publishing",
      validatedAt: "2026-08-31T01:00:00.000Z",
    });
    const publication = vi.fn<
      WorkerQueueServices["completeMergeBatchPublicationWork"]
    >().mockResolvedValue({
      batchId: workId,
      state: "completed",
      publishedAt: "2026-08-31T01:01:00.000Z",
    });
    const block = vi.fn<WorkerQueueServices["blockMergeBatchWork"]>()
      .mockResolvedValue({
        batchId: workId,
        state: "blocked",
      });
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authenticate,
      sha256: async () => "e".repeat(64),
      recordMergeBatchCandidateEnqueuedWork: candidate,
      recordMergeBatchAuthorityWork: authority,
      recordMergeBatchValidationWork: validation,
      completeMergeBatchPublicationWork: publication,
      blockMergeBatchWork: block,
    });
    const common = {
      projectId,
      workerId,
      work: mergeBatchIdentity(),
    };

    const enqueued = await service.recordMergeBatchCandidateEnqueued(
      create(RecordMergeBatchCandidateEnqueuedRequestSchema, {
        ...common,
        candidateId: "candidate-1",
        expectedHeadSha: "a".repeat(40),
        expectedBaseSha: "c".repeat(40),
        queueEntryId: "queue-entry-1",
      }),
      context,
    );
    const prepared = await service.recordMergeBatchAuthority(
      create(RecordMergeBatchAuthorityRequestSchema, {
        ...common,
        integrationRef: `refs/heads/briar/merge-queue/${workId}`,
        integrationSha: "b".repeat(40),
        baseSha: "c".repeat(40),
      }),
      context,
    );
    const validated = await service.recordMergeBatchValidation(
      create(RecordMergeBatchValidationRequestSchema, {
        ...common,
        mergeGroupSha: "b".repeat(40),
        validationResults: {
          results: [{
            context: "merge-queue",
            passed: true,
            exitCode: 0,
            log: "passed",
            logSha256: "d".repeat(64),
          }],
        },
      }),
      context,
    );
    const published = await service.completeMergeBatchPublication(
      create(CompleteMergeBatchPublicationRequestSchema, {
        ...common,
        mergeGroupSha: "b".repeat(40),
      }),
      context,
    );
    const blocked = await service.blockMergeBatch(
      create(BlockMergeBatchRequestSchema, {
        ...common,
        code: "authority_changed",
        detail: "The sealed pull request changed",
      }),
      context,
    );

    expect(enqueued.state).toBe(MergeBatchState.WAITING_TAIL);
    expect(prepared.state).toBe(MergeBatchState.VALIDATING);
    expect(validated.state).toBe(MergeBatchState.PUBLISHING);
    expect(published.state).toBe(MergeBatchState.COMPLETED);
    expect(blocked.state).toBe(MergeBatchState.BLOCKED);
    expect(candidate).toHaveBeenCalledWith(
      input.db,
      {
        batchId: workId,
        projectId,
        workerId,
        claimTokenHash: "e".repeat(64),
      },
      expect.objectContaining({ candidateId: "candidate-1" }),
    );
    expect(validation).toHaveBeenCalledWith(
      input.db,
      expect.objectContaining({ batchId: workId, claimTokenHash: "e".repeat(64) }),
      expect.objectContaining({
        validationResults: [expect.objectContaining({
          context: "merge-queue",
          failureCode: null,
        })],
      }),
    );
  });

  it("rejects an unknown protobuf validation failure enum", async () => {
    const application = vi.fn<
      WorkerQueueServices["recordMergeBatchValidationWork"]
    >();
    const service = createWorkerQueueService(input, {
      requireWorkerProjectBinding: authentication(),
      sha256: async () => "e".repeat(64),
      recordMergeBatchValidationWork: application,
    });
    const request = create(RecordMergeBatchValidationRequestSchema, {
      projectId,
      workerId,
      work: mergeBatchIdentity(),
      mergeGroupSha: "b".repeat(40),
      validationResults: {
        results: [{
          context: "merge-queue",
          passed: false,
          exitCode: 1,
          failureCode: 999 as MergeBatchValidationFailureCode,
          log: "failed",
          logSha256: "d".repeat(64),
        }],
      },
    });

    const error = await Promise.resolve(
      service.recordMergeBatchValidation(request, context),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect(application).not.toHaveBeenCalled();
  });
});
