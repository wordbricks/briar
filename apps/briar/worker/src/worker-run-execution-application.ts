import * as Schema from "effect/Schema";
import {
  autoHuntPersistedRunStatuses,
  type AutoHuntPersistedRunStatus,
  type AutoHuntSource,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import {
  StructuredAgentResult,
  type StructuredAgentResult as StructuredAgentResultType,
} from "../../src/lib/agent-result";
import { sha256 } from "./crypto-digest";
import {
  assertQueuedHuntClaim,
  attemptGithubMergeAutoResume,
  completeWorkflowStageLifecycle,
  EventKeyConflictError,
  getHuntRunForProject,
  HuntClaimError,
  HuntTransitionError,
  recordHuntEvent,
  startWorkflowStageLifecycle,
} from "./db";
import type { TrackerInput } from "./hunt-event-model";
import { HttpError } from "./http-response";
import { registerReadyMergeCandidates } from "./merge-batches";
import { getMergeQueueProfile } from "./merge-queue-profile";
import { isReservedProposalIssueSourceKey } from "./proposal-issue-source";
import { dashboardStageForProgress } from "./request-readers";
import { decodeRequestSync } from "./request-schema";
import { assertRunEventIdentityNotOverridden } from "./run-event-identity";
import type { AuthenticatedWorkerProject } from "./worker-route-auth";
import { auditExecutionEvent } from "./workers";

export type IssueWorkIdentity = {
  readonly workId: string;
  readonly runId: string;
  readonly claimToken: string;
};

export type WorkerRunExecutionPrincipal =
  | { readonly kind: "agent" }
  | {
      readonly kind: "worker";
      readonly worker: AuthenticatedWorkerProject;
    };

export type WorkerRunEventTarget =
  | { readonly kind: "work"; readonly work: IssueWorkIdentity }
  | {
      readonly kind: "sourceIdentity";
      readonly source: AutoHuntSource;
      readonly sourceKey: string;
      readonly title: string;
    };

export type WorkerRunEvent = {
  readonly status: AutoHuntPersistedRunStatus;
  readonly workflowStage: AutoHuntWorkflowStageId | null;
  readonly eventKey: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly repository: string;
  readonly detail: string | null;
  readonly priority: number | null;
  readonly branch: string | null;
  readonly commitSha: string | null;
  readonly tracker: TrackerInput;
  readonly issueDescription: string | null;
  readonly resultSummary: string | null;
  readonly structuredResult: StructuredAgentResultType | null;
  readonly pullRequestUrls: string[];
  readonly targetSha: string | null;
  readonly sourceCreatedAt: string | null;
  readonly context: Record<string, unknown> | null;
};

export type WorkflowStageTransition = {
  readonly work: IssueWorkIdentity;
  readonly requestId: string;
  readonly stage: AutoHuntWorkflowStageId;
  readonly action: "start" | "complete";
  readonly attempt?: number;
  readonly revision?: number;
};

const RunEventInvariant = Schema.Struct({
  status: Schema.Literals(autoHuntPersistedRunStatuses),
  workflowStage: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  resultSummary: Schema.NullOr(Schema.String),
  structuredResult: Schema.NullOr(StructuredAgentResult),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (input.status === "running" && !input.workflowStage) {
      issues.push({
        path: ["workflowStage"],
        issue: "running progress requires a workflow stage",
      });
    }
    if (input.status === "blocked" && !input.detail?.trim()) {
      issues.push({
        path: ["detail"],
        issue: "blocked progress requires technical blocker details",
      });
    }
    if (input.status === "blocked" && !input.structuredResult) {
      issues.push({
        path: ["structuredResult"],
        issue: "blocked progress requires a structured blocked result",
      });
    }
    if (
      input.status === "blocked" &&
      input.structuredResult?.outcome !== "blocked"
    ) {
      issues.push({
        path: ["structuredResult", "outcome"],
        issue: "blocked progress requires a blocked structured outcome",
      });
    }
    if (
      input.status === "blocked" &&
      input.structuredResult &&
      (!input.structuredResult.humanActionRequired ||
        !input.structuredResult.nextAction)
    ) {
      issues.push({
        path: ["structuredResult", "nextAction"],
        issue: "blocked progress requires an exact human next action",
      });
    }
    if (input.status === "completed" && !input.structuredResult) {
      issues.push({
        path: ["structuredResult"],
        issue: "completed runs require a structured result",
      });
    }
    if (
      input.status === "completed" &&
      input.structuredResult &&
      !["completed", "partial"].includes(input.structuredResult.outcome)
    ) {
      issues.push({
        path: ["structuredResult", "outcome"],
        issue: "completed runs require a completed or partial outcome",
      });
    }
    if (
      input.resultSummary &&
      input.structuredResult &&
      input.resultSummary !== input.structuredResult.summary
    ) {
      issues.push({
        path: ["resultSummary"],
        issue: "resultSummary must match structuredResult.summary",
      });
    }
    return issues.length === 0 ? undefined : issues;
  }),
);

const validateRunEventInvariant = decodeRequestSync(RunEventInvariant);

export type WorkerRunExecutionApplicationServices = {
  readonly sha256: typeof sha256;
  readonly getRun: typeof getHuntRunForProject;
  readonly assertQueuedClaim: typeof assertQueuedHuntClaim;
  readonly recordEvent: typeof recordHuntEvent;
  readonly auditEvent: typeof auditExecutionEvent;
  readonly startStage: typeof startWorkflowStageLifecycle;
  readonly completeStage: typeof completeWorkflowStageLifecycle;
  readonly attemptGithubAutoResume: typeof attemptGithubMergeAutoResume;
  readonly getMergeQueueProfile: typeof getMergeQueueProfile;
  readonly registerReadyMergeCandidates: typeof registerReadyMergeCandidates;
  readonly projectOrganizationId: (
    db: D1Database,
    projectId: string,
  ) => Promise<string | null>;
};

const projectOrganizationId = async (
  db: D1Database,
  projectId: string,
) => (await db
  .prepare("select organization_id from briar_projects where id = ?")
  .bind(projectId)
  .first<{ organization_id: string }>())?.organization_id ?? null;

const workerRunExecutionApplicationServices: WorkerRunExecutionApplicationServices = {
  sha256,
  getRun: getHuntRunForProject,
  assertQueuedClaim: assertQueuedHuntClaim,
  recordEvent: recordHuntEvent,
  auditEvent: auditExecutionEvent,
  startStage: startWorkflowStageLifecycle,
  completeStage: completeWorkflowStageLifecycle,
  attemptGithubAutoResume: attemptGithubMergeAutoResume,
  getMergeQueueProfile,
  registerReadyMergeCandidates,
  projectOrganizationId,
};

const terminalStatuses = new Set<AutoHuntPersistedRunStatus>([
  "completed",
  "cancelled",
  "blocked",
  "failed",
]);

async function activeIssueClaim(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly principal: WorkerRunExecutionPrincipal;
    readonly work: IssueWorkIdentity;
    readonly authenticatedAt: string;
  },
  services: WorkerRunExecutionApplicationServices,
) {
  const run = await services.getRun(input.db, input.projectId, input.work.runId);
  if (!run) throw new HttpError(404, "Run not found");
  if (
    input.principal.kind === "worker" &&
    run.worker_id !== input.principal.worker.binding.id
  ) {
    throw new HttpError(403, "Run is not assigned to this worker");
  }
  const claimTokenHash = await services.sha256(input.work.claimToken);
  if (
    run.claim_token_hash !== claimTokenHash ||
    !run.lease_expires_at ||
    run.lease_expires_at <= input.authenticatedAt ||
    terminalStatuses.has(run.status)
  ) {
    throw new HttpError(409, "Issue processing claim token is no longer active");
  }
  return { run, claimTokenHash };
}

export async function recordWorkerRunEventApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly principal: WorkerRunExecutionPrincipal;
    readonly target: WorkerRunEventTarget;
    readonly event: WorkerRunEvent;
  },
  overrides: Partial<WorkerRunExecutionApplicationServices> = {},
) {
  const services = { ...workerRunExecutionApplicationServices, ...overrides };
  validateRunEventInvariant({
    status: input.event.status,
    workflowStage: input.event.workflowStage,
    detail: input.event.detail,
    resultSummary: input.event.resultSummary,
    structuredResult: input.event.structuredResult,
  });

  const authenticatedAt = new Date().toISOString();
  const active = input.target.kind === "work"
    ? await activeIssueClaim({
        db: input.db,
        projectId: input.projectId,
        principal: input.principal,
        work: input.target.work,
        authenticatedAt,
      }, services)
    : null;
  if (
    input.target.kind === "sourceIdentity" &&
    input.principal.kind !== "agent"
  ) {
    throw new HttpError(403, "Source-identity run events require an agent token");
  }

  const run = active?.run ?? null;
  const source = input.target.kind === "sourceIdentity"
    ? input.target.source
    : run?.source;
  const sourceKey = input.target.kind === "sourceIdentity"
    ? input.target.sourceKey
    : run?.source_key;
  const title = input.target.kind === "sourceIdentity"
    ? input.target.title
    : run?.title;
  if (!source || !sourceKey || !title) {
    throw new HttpError(400, "Run identity is incomplete");
  }
  assertRunEventIdentityNotOverridden({ run, source, sourceKey });
  if (
    input.target.kind === "sourceIdentity" &&
    isReservedProposalIssueSourceKey(sourceKey)
  ) {
    throw new HttpError(403, "Run identity is reserved for proposal approval");
  }

  const event = {
    ...input.event,
    source,
    sourceKey,
    title,
    stage: dashboardStageForProgress(
      input.event.status,
      input.event.workflowStage,
    ),
    qaStatus: null,
    stagingQaDetail: null,
    productionQaDetail: null,
  };
  try {
    await services.assertQueuedClaim(
      input.db,
      input.projectId,
      event,
      active?.claimTokenHash ?? null,
      authenticatedAt,
    );
    const runId = await services.recordEvent(input.db, input.projectId, event);
    if (event.status === "completed" && run?.worker_id) {
      const organizationId = await services.projectOrganizationId(
        input.db,
        input.projectId,
      );
      if (organizationId) {
        await services.auditEvent(input.db, {
          organizationId,
          projectId: input.projectId,
          runId,
          workerId: run.worker_id,
          agentId: run.agent_id,
          action: "completed",
          detail: { eventKey: event.eventKey },
          occurredAt: event.occurredAt,
        });
      }
    }
    return {
      runId,
      status: event.status,
      workflowStage: event.workflowStage,
    };
  } catch (error) {
    if (
      error instanceof EventKeyConflictError ||
      error instanceof HuntTransitionError ||
      error instanceof HuntClaimError
    ) {
      throw new HttpError(409, error.message);
    }
    throw error;
  }
}

export async function transitionWorkerWorkflowStageApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly principal: WorkerRunExecutionPrincipal;
    readonly transition: WorkflowStageTransition;
    readonly actor: string;
  },
  overrides: Partial<WorkerRunExecutionApplicationServices> = {},
) {
  const services = { ...workerRunExecutionApplicationServices, ...overrides };
  const observedAt = new Date().toISOString();
  await activeIssueClaim({
    db: input.db,
    projectId: input.projectId,
    principal: input.principal,
    work: input.transition.work,
    authenticatedAt: observedAt,
  }, services);
  try {
    const common = {
      runId: input.transition.work.runId,
      stageId: input.transition.stage,
      attempt: input.transition.attempt,
      revision: input.transition.revision,
      actor: input.actor,
    };
    const result = input.transition.action === "start"
      ? await services.startStage(input.db, input.projectId, {
          ...common,
          startedAt: observedAt,
        })
      : await services.completeStage(input.db, input.projectId, {
          ...common,
          finishedAt: observedAt,
        });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found", "RUN_NOT_FOUND");
    }

    if (
      result.outcome === "paused" &&
      result.checkpoint?.stage === "pr_open" &&
      result.checkpoint.position === "after"
    ) {
      await services.attemptGithubAutoResume(
        input.db,
        input.projectId,
        input.transition.work.runId,
      );
    }
    if (input.transition.action === "complete") {
      const mergeQueueProfile = await services.getMergeQueueProfile(
        input.db,
        input.projectId,
      );
      if (
        mergeQueueProfile?.enabled === 1 &&
        mergeQueueProfile.readiness_stage_id === input.transition.stage
      ) {
        const run = await services.getRun(
          input.db,
          input.projectId,
          input.transition.work.runId,
        );
        if (run) {
          await services.registerReadyMergeCandidates(input.db, {
            projectId: input.projectId,
            runId: run.id,
            attempt: run.current_attempt,
            revision: run.current_revision,
            readyAt: observedAt,
          });
        }
      }
    }
    return result;
  } catch (error) {
    if (error instanceof HuntTransitionError) {
      throw new HttpError(409, error.message, "WORKFLOW_STAGE_CONFLICT");
    }
    throw error;
  }
}
