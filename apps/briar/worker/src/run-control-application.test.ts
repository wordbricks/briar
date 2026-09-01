import { describe, expect, it, vi } from "vitest";
import {
  recoverRunApplication,
  reworkRunApplication,
  resumeRunApplication,
} from "./run-control-application";

const db = {} as D1Database;
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

describe("run control application", () => {
  it("preserves an idempotent retry result", async () => {
    const recoverRun = vi.fn(async () => ({
      outcome: "already_retried" as const,
      attempt: 3,
      stage: "queued" as const,
    }));
    await expect(recoverRunApplication({
      db,
      projectId,
      runId,
      action: "retry",
      requestId,
      reason: "Retry the failed provider turn",
      actor: "briar-worker:worker-1",
    }, { recoverRun })).resolves.toEqual({
      runId,
      outcome: "already_retried",
      attempt: 3,
      stage: "queued",
    });
    expect(recoverRun).toHaveBeenCalledWith(db, projectId, expect.objectContaining({
      runId,
      requestId,
      actor: "briar-worker:worker-1",
    }));
  });

  it("maps a stale resume identity to a checkpoint conflict", async () => {
    const resumeRun = vi.fn(async () => ({
      outcome: "conflict" as const,
      checkpointKey: "after-review",
      attempt: 2,
      revision: 3,
      nextStage: null,
      terminalReviewOnly: false,
    }));
    await expect(resumeRunApplication({
      db,
      projectId,
      runId,
      requestId,
      checkpointKey: "after-review",
      attempt: 2,
      revision: 3,
      actor: "briar-workflow",
    }, { resumeRun })).rejects.toMatchObject({
      status: 409,
      code: "CHECKPOINT_CONFLICT",
    });
  });

  it("requires checkpoint identity before reworking a paused run", async () => {
    const reworkRun = vi.fn();
    await expect(reworkRunApplication({
      db,
      projectId,
      runId,
      requestId,
      workflowStage: "implementing",
      reason: "Apply the requested changes",
      actor: "briar-workflow",
    }, {
      getRun: vi.fn(async () => ({ paused_at: "2026-08-31T00:00:00.000Z" }) as never),
      reworkRun,
    })).rejects.toMatchObject({
      status: 409,
      code: "CHECKPOINT_CONFLICT",
    });
    expect(reworkRun).not.toHaveBeenCalled();
  });
});
