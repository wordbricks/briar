import { create } from "@bufbuild/protobuf";
import { type HandlerContext } from "@connectrpc/connect";
import {
  RetryRunResponse_Outcome,
  RetryRunRequestSchema,
  ListRunEvidenceRequestSchema,
  RunEvidence_Status,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  ClaimIssueRequestSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./http-response";
import {
  authorizeIssueClaim,
  createWorkerExecutionService,
  type IssueClaimAuthServices,
  type IssueClaimAuthorization,
  type WorkerExecutionServices,
} from "./worker-connect-execution";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const context = {} as HandlerContext;
const db = {} as D1Database;
const archivesBucket = {} as R2Bucket;
const env = {} as Env;
const authenticatedWorker = {} as NonNullable<
  IssueClaimAuthorization["authenticatedWorker"]
>;

describe("WorkerExecutionService execution credential boundary", () => {
  it("selects agent and Worker claim auth without losing the Worker binding", async () => {
    const requireWorkerProjectBinding = vi.fn<
      IssueClaimAuthServices["requireWorkerProjectBinding"]
    >();
    requireWorkerProjectBinding.mockResolvedValue(authenticatedWorker);
    const requireAgentProject = vi.fn<
      IssueClaimAuthServices["requireAgentProject"]
    >();
    requireAgentProject.mockResolvedValue(projectId);
    const request = new Request("https://briar.example", {
      headers: { authorization: "Bearer briar_worker_test" },
    });

    const authorization = await authorizeIssueClaim({
      db,
      request,
      projectId,
    }, { requireAgentProject, requireWorkerProjectBinding });

    expect(authorization).toEqual({ projectId, authenticatedWorker });
    expect(requireWorkerProjectBinding).toHaveBeenCalledWith(
      db,
      request,
      projectId,
    );
    expect(requireAgentProject).not.toHaveBeenCalled();

    const agentRequest = new Request("https://briar.example", {
      headers: { authorization: "Bearer briar_agent_test" },
    });
    await expect(authorizeIssueClaim({
      db,
      request: agentRequest,
      projectId,
    }, { requireAgentProject, requireWorkerProjectBinding })).resolves.toEqual({
      projectId,
    });
    expect(requireAgentProject).toHaveBeenCalledWith(db, agentRequest);
  });

  it("rejects a specific-run claim outside the credential project", async () => {
    const claimIssue = vi.fn<WorkerExecutionServices["claimIssue"]>();
    const service = createWorkerExecutionService({
      request: new Request("https://briar.example"),
      db,
      env,
      archivesBucket,
      requireRunExecutionProject: vi.fn(),
    }, {
      claimIssue,
      authorizeIssueClaim: vi.fn(async () => ({ projectId: otherProjectId })),
    });

    const error = await Promise.resolve(service.claimIssue(create(
      ClaimIssueRequestSchema,
      { projectId, runId, claimedBy: "auto-hunt" },
    ), context)).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect(claimIssue).not.toHaveBeenCalled();
  });

  it("preserves an explicit no-work outcome for a specific run", async () => {
    const claimIssue = vi.fn<WorkerExecutionServices["claimIssue"]>();
    claimIssue.mockResolvedValue(null);
    const service = createWorkerExecutionService({
      request: new Request("https://briar.example"),
      db,
      env,
      archivesBucket,
      requireRunExecutionProject: vi.fn(),
    }, {
      claimIssue,
      authorizeIssueClaim: vi.fn(async () => ({
        projectId,
        authenticatedWorker,
      })),
    });

    const response = await service.claimIssue(create(ClaimIssueRequestSchema, {
      projectId,
      runId,
      claimedBy: " auto-hunt ",
    }), context);

    expect(response.issue).toBeUndefined();
    expect(claimIssue).toHaveBeenCalledWith({
      db,
      env,
      projectId,
      runId,
      claimedBy: "auto-hunt",
      authenticatedWorker,
    });
  });

  it("does not expose a run through a mismatched execution project", async () => {
    const listRunEvidence = vi.fn<WorkerExecutionServices["listRunEvidence"]>();
    const service = createWorkerExecutionService({
      request: new Request("https://briar.example"),
      db,
      env,
      archivesBucket,
      requireRunExecutionProject: vi.fn(async () => otherProjectId),
    }, { listRunEvidence });

    const error = await Promise.resolve(service.listRunEvidence(create(
      ListRunEvidenceRequestSchema,
      { projectId, runId },
    ), context)).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect(listRunEvidence).not.toHaveBeenCalled();
  });

  it("maps execution evidence once into the generated response", async () => {
    const listRunEvidence = vi.fn<WorkerExecutionServices["listRunEvidence"]>();
    listRunEvidence.mockResolvedValue({
      runId,
      attempt: 2,
      revision: 3,
      evidence: [{
        key: "tests",
        attempt: 2,
        revision: 3,
        stage: "verification",
        type: "command",
        status: "passed",
        detail: "focused tests passed",
        command: "bun run test",
        url: null,
        metadata: { suite: "worker" },
        actor: "briar-worker",
        observedAt: "2026-08-31T01:02:03.000Z",
        recordedAt: "2026-08-31T01:02:04.000Z",
        images: [{
          id: "44444444-4444-4444-8444-444444444444",
          filename: "result.png",
          contentType: "image/png",
          byteSize: 2_048,
          sha256: "a".repeat(64),
          position: 0,
          url: `/projects/${projectId}/runs/${runId}/evidence/images/image-1`,
        }],
        requiredRevision: 3,
        canonical: true,
      }],
    });
    const authenticate = vi.fn(async () => projectId);
    const service = createWorkerExecutionService({
      request: new Request("https://briar.example"),
      db,
      env,
      archivesBucket,
      requireRunExecutionProject: authenticate,
    }, { listRunEvidence });

    const response = await service.listRunEvidence(create(
      ListRunEvidenceRequestSchema,
      { projectId, runId },
    ), context);

    expect(authenticate).toHaveBeenCalledWith(runId);
    expect(listRunEvidence).toHaveBeenCalledWith({
      db,
      archivesBucket,
      projectId,
      runId,
    });
    expect(response.evidence?.[0]).toMatchObject({
      key: "tests",
      status: RunEvidence_Status.PASSED,
      metadata: { suite: "worker" },
      images: [{ byteSize: 2_048n }],
      canonical: true,
    });
  });

  it("derives the run-control actor from the authenticated Worker", async () => {
    const recoverRun = vi.fn<WorkerExecutionServices["recoverRun"]>();
    recoverRun.mockResolvedValue({
      runId,
      outcome: "already_retried",
      attempt: 3,
      stage: "queued",
    });
    const worker = {
      binding: { id: "worker-42" },
    } as NonNullable<IssueClaimAuthorization["authenticatedWorker"]>;
    const service = createWorkerExecutionService({
      request: new Request("https://briar.example", {
        headers: { authorization: "Bearer briar_worker_test" },
      }),
      db,
      env,
      archivesBucket,
      requireRunExecutionProject: vi.fn(async () => projectId),
    }, {
      recoverRun,
      requireWorkerProjectBinding: vi.fn(async () => worker),
    });

    const response = await service.retryRun(create(RetryRunRequestSchema, {
      projectId,
      runId,
      requestId: "44444444-4444-4444-8444-444444444444",
      reason: " Retry the provider turn ",
    }), context);

    expect(recoverRun).toHaveBeenCalledWith({
      db,
      projectId,
      runId,
      requestId: "44444444-4444-4444-8444-444444444444",
      reason: "Retry the provider turn",
      action: "retry",
      actor: "briar-worker:worker-42",
    });
    expect(response).toMatchObject({
      runId,
      outcome: RetryRunResponse_Outcome.ALREADY_RETRIED,
      attempt: 3,
      status: RunStatus.QUEUED,
    });
  });
});
