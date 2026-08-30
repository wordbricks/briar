import type { AutoHuntWorkflowStageId } from "../../src/lib/auto-hunt-contract";
import {
  getHuntRunForProject,
  HuntTransitionError,
  recoverHuntRun,
  reworkHuntRun,
} from "./db";
import { HttpError } from "./http-response";
import { resumeRunWithCheckpointIdentity } from "./workflow-resume";

export type RunControlApplicationServices = {
  readonly getRun: typeof getHuntRunForProject;
  readonly recoverRun: typeof recoverHuntRun;
  readonly resumeRun: typeof resumeRunWithCheckpointIdentity;
  readonly reworkRun: typeof reworkHuntRun;
};

const runControlApplicationServices: RunControlApplicationServices = {
  getRun: getHuntRunForProject,
  recoverRun: recoverHuntRun,
  resumeRun: resumeRunWithCheckpointIdentity,
  reworkRun: reworkHuntRun,
};

export async function recoverRunApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly runId: string;
    readonly action: "retry" | "cancel";
    readonly requestId: string;
    readonly reason: string | null;
    readonly actor: string;
  },
  overrides: Partial<RunControlApplicationServices> = {},
) {
  const services = { ...runControlApplicationServices, ...overrides };
  const result = await services.recoverRun(input.db, input.projectId, {
    runId: input.runId,
    action: input.action,
    requestId: input.requestId,
    actor: input.actor,
    reason: input.reason,
    occurredAt: new Date().toISOString(),
  });
  if (result.outcome === "not_found") {
    throw new HttpError(404, "Run not found");
  }
  if (result.outcome === "ineligible") {
    throw new HttpError(
      409,
      input.action === "retry"
        ? "Only blocked or failed runs can be retried"
        : "Completed or cancelled runs cannot be cancelled",
    );
  }
  return { runId: input.runId, ...result };
}

export async function resumeRunApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly runId: string;
    readonly requestId: string;
    readonly checkpointKey: string;
    readonly attempt: number;
    readonly revision: number;
    readonly actor: string;
  },
  overrides: Partial<RunControlApplicationServices> = {},
) {
  const services = { ...runControlApplicationServices, ...overrides };
  const result = await services.resumeRun(
    input.db,
    input.projectId,
    input.runId,
    {
      requestId: input.requestId,
      checkpointKey: input.checkpointKey,
      attempt: input.attempt,
      revision: input.revision,
    },
    input.actor,
  );
  if (result.outcome === "not_found") {
    throw new HttpError(404, "Run not found");
  }
  if (result.outcome === "conflict") {
    throw new HttpError(
      409,
      "The paused checkpoint changed before it could be resumed",
      "CHECKPOINT_CONFLICT",
    );
  }
  return {
    runId: input.runId,
    ...result,
    workflowStage: result.nextStage,
    startStage: result.nextStage,
  };
}

export async function reworkRunApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly runId: string;
    readonly requestId: string;
    readonly workflowStage: AutoHuntWorkflowStageId;
    readonly reason: string;
    readonly actor: string;
    readonly checkpoint?: {
      readonly key: string;
      readonly attempt: number;
      readonly revision: number;
    };
  },
  overrides: Partial<RunControlApplicationServices> = {},
) {
  const services = { ...runControlApplicationServices, ...overrides };
  if (!input.checkpoint) {
    const run = await services.getRun(input.db, input.projectId, input.runId);
    if (!run) throw new HttpError(404, "Run not found");
    if (run.paused_at) {
      throw new HttpError(
        409,
        "Paused run rework requires checkpoint identity",
        "CHECKPOINT_CONFLICT",
      );
    }
  }
  try {
    const result = await services.reworkRun(input.db, input.projectId, {
      runId: input.runId,
      workflowStage: input.workflowStage,
      requestId: input.requestId,
      actor: input.actor,
      reason: input.reason,
      occurredAt: new Date().toISOString(),
      checkpoint: input.checkpoint,
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    return { runId: input.runId, ...result };
  } catch (error) {
    if (error instanceof HuntTransitionError) {
      throw new HttpError(
        409,
        error.message,
        input.checkpoint ? "CHECKPOINT_CONFLICT" : undefined,
      );
    }
    throw error;
  }
}
