import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedWorkerProject } from "./worker-route-auth";
import {
  recordWorkerRunEventApplication,
  transitionWorkerWorkflowStageApplication,
  type WorkerRunEvent,
  type WorkerRunExecutionApplicationServices,
  type WorkerRunExecutionPrincipal,
} from "./worker-run-execution-application";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const claimToken = `briar_claim_${"a".repeat(64)}`;
const claimTokenHash = "claim-token-hash";
const db = {} as D1Database;
const worker = {
  binding: { id: "worker-1" },
} as AuthenticatedWorkerProject;
const workerPrincipal = {
  kind: "worker",
  worker,
} as const satisfies WorkerRunExecutionPrincipal;

const run = {
  id: runId,
  source: "issue",
  source_key: "BRIAR-42",
  title: "Repair the workflow",
  status: "running",
  worker_id: "worker-1",
  agent_id: "agent-1",
  claim_token_hash: claimTokenHash,
  lease_expires_at: "2099-01-01T00:00:00.000Z",
  current_attempt: 2,
  current_revision: 3,
} as never;

const runningEvent = (overrides: Partial<WorkerRunEvent> = {}): WorkerRunEvent => ({
  status: "running",
  workflowStage: "implementing",
  eventKey: "BRIAR-42:implementing:started",
  occurredAt: "2026-08-31T01:02:03.000Z",
  actor: "briar-worker:worker-1",
  repository: "wordbricks/briar",
  detail: null,
  priority: null,
  branch: null,
  commitSha: null,
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  structuredResult: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  context: null,
  ...overrides,
});

describe("Worker run execution application", () => {
  it("rejects a stale claim before recording an event", async () => {
    const recordEvent = vi.fn();
    await expect(recordWorkerRunEventApplication({
      db,
      projectId,
      principal: workerPrincipal,
      target: {
        kind: "work",
        work: { workId: runId, runId, claimToken },
      },
      event: runningEvent(),
    }, {
      getRun: vi.fn(async () => run),
      sha256: vi.fn(async () => "stale-token-hash"),
      recordEvent,
    })).rejects.toThrow("claim token is no longer active");
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("keeps blocked handoff invariants in the domain application", async () => {
    await expect(recordWorkerRunEventApplication({
      db,
      projectId,
      principal: { kind: "agent" },
      target: {
        kind: "sourceIdentity",
        source: "issue",
        sourceKey: "BRIAR-42",
        title: "Repair the workflow",
      },
      event: runningEvent({
        status: "blocked",
        workflowStage: null,
        detail: "GitHub credentials expired.",
      }),
    })).rejects.toThrow("structured blocked result");
  });

  it("records a claimed completion and its execution audit together", async () => {
    const recordEvent = vi.fn(async () => runId);
    const auditEvent = vi.fn();
    const assertQueuedClaim = vi.fn();
    const summary = "The workflow completed with all checks passing.";
    const result = await recordWorkerRunEventApplication({
      db,
      projectId,
      principal: workerPrincipal,
      target: {
        kind: "work",
        work: { workId: runId, runId, claimToken },
      },
      event: runningEvent({
        status: "completed",
        workflowStage: null,
        resultSummary: summary,
        structuredResult: {
          summary,
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
      }),
    }, {
      getRun: vi.fn(async () => run),
      sha256: vi.fn(async () => claimTokenHash),
      assertQueuedClaim,
      recordEvent,
      projectOrganizationId: vi.fn(async () => "organization-1"),
      auditEvent,
    });

    expect(result).toEqual({
      runId,
      status: "completed",
      workflowStage: null,
    });
    expect(assertQueuedClaim).toHaveBeenCalledWith(
      db,
      projectId,
      expect.objectContaining({ status: "completed" }),
      claimTokenHash,
      expect.any(String),
    );
    expect(auditEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      organizationId: "organization-1",
      projectId,
      runId,
      workerId: "worker-1",
      action: "completed",
    }));
  });

  it("owns checkpoint auto-resume and merge readiness orchestration", async () => {
    const attemptGithubAutoResume = vi.fn();
    const registerReadyMergeCandidates = vi.fn(async () => []);
    const completeStage = vi.fn(async () => ({
      outcome: "paused" as const,
      attempt: 2,
      revision: 3,
      stage: "pr_open",
      checkpoint: {
        key: "after-pr-open",
        stage: "pr_open",
        position: "after" as const,
        revision: 3,
      },
    }));
    const services = {
      getRun: vi.fn(async () => run),
      sha256: vi.fn(async () => claimTokenHash),
      completeStage,
      attemptGithubAutoResume,
      getMergeQueueProfile: vi.fn(async () => ({
        enabled: 1,
        readiness_stage_id: "pr_open",
      } as never)),
      registerReadyMergeCandidates,
    } satisfies Partial<WorkerRunExecutionApplicationServices>;

    const result = await transitionWorkerWorkflowStageApplication({
      db,
      projectId,
      principal: workerPrincipal,
      transition: {
        work: { workId: runId, runId, claimToken },
        requestId: "33333333-3333-4333-8333-333333333333",
        stage: "pr_open",
        action: "complete",
        attempt: 2,
        revision: 3,
      },
      actor: "briar-worker:worker-1",
    }, services);

    expect(result.outcome).toBe("paused");
    expect(attemptGithubAutoResume).toHaveBeenCalledWith(
      db,
      projectId,
      runId,
    );
    expect(registerReadyMergeCandidates).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        projectId,
        runId,
        attempt: 2,
        revision: 3,
      }),
    );
  });
});
