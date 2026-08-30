import type { AgentExecutionCostRecord } from "../../src/lib/agent-execution-cost";
import type {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "../../src/lib/agent-execution-metrics";
import type { AgentProvider } from "../../src/lib/agent-provider";
import { ingestAgentTranscript } from "./agent-worklog";
import { sha256 } from "./crypto-digest";
import {
  getRunExecutionAttempt,
  recordRunCostRecords,
  recordRunUsageRecords,
  updateHuntRunExecutionMetrics,
} from "./db";
import { HttpError } from "./http-response";
import type { AuthenticatedWorkerProject } from "./worker-route-auth";
import type { TranscriptEventInput } from "./workers";
import type { TranscriptWorkIdentity } from "./worker-transcript-mappers";

type WorkerTranscriptApplicationServices = {
  readonly sha256: typeof sha256;
  readonly ingestTranscript: typeof ingestAgentTranscript;
  readonly getExecutionAttempt: typeof getRunExecutionAttempt;
  readonly recordUsage: typeof recordRunUsageRecords;
  readonly recordCost: typeof recordRunCostRecords;
  readonly updateMetrics: typeof updateHuntRunExecutionMetrics;
};

const workerTranscriptApplicationServices: WorkerTranscriptApplicationServices = {
  sha256,
  ingestTranscript: ingestAgentTranscript,
  getExecutionAttempt: getRunExecutionAttempt,
  recordUsage: recordRunUsageRecords,
  recordCost: recordRunCostRecords,
  updateMetrics: updateHuntRunExecutionMetrics,
};

const activeClaim = async (input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly worker: AuthenticatedWorkerProject;
  readonly work: TranscriptWorkIdentity;
  readonly observedAt: string;
  readonly claimTokenHash: string;
}) => {
  switch (input.work.workType) {
    case "issue":
      if (input.work.workId !== input.work.runId) return false;
      return Boolean(await input.db
        .prepare(
          `select 1 as active
           from briar_hunt_runs
           where id = ? and project_id = ? and worker_id = ?
             and claim_token_hash = ? and lease_expires_at > ?
             and status not in
               ('backlog', 'completed', 'cancelled', 'blocked', 'failed')`,
        )
        .bind(
          input.work.workId,
          input.projectId,
          input.worker.binding.id,
          input.claimTokenHash,
          input.observedAt,
        )
        .first<{ active: number }>());
    case "projectAgentTask":
      return Boolean(await input.db
        .prepare(
          `select 1 as active
           from briar_project_agent_task_jobs
           where id = ? and project_id = ? and status = 'running'
             and claimed_worker_id = ? and claim_token_hash = ?
             and lease_expires_at > ?`,
        )
        .bind(
          input.work.workId,
          input.projectId,
          input.worker.binding.id,
          input.claimTokenHash,
          input.observedAt,
        )
        .first<{ active: number }>());
    case "issueReply":
      return Boolean(await input.db
        .prepare(
          `select 1 as active
           from briar_issue_agent_reply_jobs
           where id = ? and project_id = ? and status = 'running'
             and claimed_worker_id = ? and claim_token_hash = ?
             and lease_expires_at > ?`,
        )
        .bind(
          input.work.workId,
          input.projectId,
          input.worker.binding.id,
          input.claimTokenHash,
          input.observedAt,
        )
        .first<{ active: number }>());
  }
};

export async function appendTranscriptEventsApplication(
  input: {
    readonly db: D1Database;
    readonly archives: R2Bucket;
    readonly projectId: string;
    readonly worker: AuthenticatedWorkerProject;
    readonly work: TranscriptWorkIdentity;
    readonly sessionId: string;
    readonly agentProvider: AgentProvider;
    readonly events: TranscriptEventInput[];
  },
  services: WorkerTranscriptApplicationServices =
    workerTranscriptApplicationServices,
) {
  const observedAt = new Date().toISOString();
  const claimTokenHash = await services.sha256(input.work.claimToken);
  if (!(await activeClaim({ ...input, observedAt, claimTokenHash }))) {
    throw new HttpError(409, "Worker claim is no longer active");
  }
  return services.ingestTranscript(
    input.db,
    input.archives,
    input.projectId,
    {
      sessionId: input.sessionId,
      runId: input.work.workType === "projectAgentTask"
        ? null
        : input.work.runId,
      workerId: input.worker.binding.id,
      agentProvider: input.agentProvider,
      events: input.events,
      observedAt,
    },
  );
}

const finalIssueClaim = async (input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly worker: AuthenticatedWorkerProject;
  readonly work: TranscriptWorkIdentity;
  readonly executionId: string;
  readonly runAttempt: number;
  readonly claimTokenHash: string;
  readonly observedAt: string;
}) => Boolean(await input.db
  .prepare(
    `select 1 as active
     from briar_hunt_runs
     where id = ? and project_id = ? and worker_id = ?
       and claim_token_hash = ? and current_attempt = ?
       and last_execution_id = ?
       and (
         (
           lease_expires_at > ?
           and status not in
             ('backlog', 'completed', 'cancelled', 'blocked', 'failed')
         )
         or (
           status = 'completed'
           and claimed_at is not null and lease_expires_at is not null
           and completed_at is not null
           and completed_at >= claimed_at
           and completed_at < lease_expires_at
           and completed_at <= ?
         )
       )`,
  )
  .bind(
    input.work.runId,
    input.projectId,
    input.worker.binding.id,
    input.claimTokenHash,
    input.runAttempt,
    input.executionId,
    input.observedAt,
    input.observedAt,
  )
  .first<{ active: number }>());

export async function reportIssueExecutionTelemetryApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly worker: AuthenticatedWorkerProject;
    readonly work: TranscriptWorkIdentity;
    readonly executionId: string;
    readonly agentProvider: AgentProvider;
    readonly executionMetrics: AgentExecutionMetrics;
    readonly usageObservations: AgentExecutionUsageRecord[];
    readonly costObservations: AgentExecutionCostRecord[];
  },
  services: WorkerTranscriptApplicationServices =
    workerTranscriptApplicationServices,
) {
  if (
    input.work.workType !== "issue" ||
    input.work.workId !== input.work.runId
  ) {
    throw new HttpError(400, "Issue execution telemetry requires issue work");
  }
  if (
    input.usageObservations.length > 1_000 ||
    input.costObservations.length > 1_000
  ) {
    throw new HttpError(413, "Execution telemetry has too many observations");
  }
  if (
    input.usageObservations.some((observation) =>
      observation.agentProvider !== input.agentProvider
    ) ||
    input.costObservations.some((observation) =>
      observation.agentProvider !== input.agentProvider
    )
  ) {
    throw new HttpError(400, "Observation providers must match agent_provider");
  }
  const attempt = await services.getExecutionAttempt(
    input.db,
    input.executionId,
  );
  if (
    !attempt || attempt.project_id !== input.projectId ||
    attempt.worker_id !== input.worker.binding.id ||
    attempt.run_id !== input.work.runId
  ) {
    throw new HttpError(403, "Execution attempt is not assigned to this worker");
  }
  const observedAt = new Date().toISOString();
  const claimTokenHash = await services.sha256(input.work.claimToken);
  if (!(await finalIssueClaim({
    ...input,
    runAttempt: attempt.run_attempt,
    claimTokenHash,
    observedAt,
  }))) {
    throw new HttpError(409, "Worker claim is no longer active");
  }
  const clockSkewMs = 5 * 60_000;
  const earliestObservedAt = Date.parse(attempt.claimed_at) - clockSkewMs;
  const latestObservedAt = Date.parse(observedAt) + clockSkewMs;
  const outsideAttempt = (
    observation: AgentExecutionUsageRecord | AgentExecutionCostRecord,
  ) => {
    const timestamp = Date.parse(observation.observedAt);
    return timestamp < earliestObservedAt || timestamp > latestObservedAt;
  };
  if (
    input.usageObservations.some(outsideAttempt) ||
    input.costObservations.some(outsideAttempt)
  ) {
    throw new HttpError(
      400,
      "Observation timestamp is outside the execution attempt window",
    );
  }
  const usageStored = await services.recordUsage(input.db, {
    executionId: input.executionId,
    records: input.usageObservations,
    recordedAt: observedAt,
  });
  const costStored = await services.recordCost(input.db, {
    executionId: input.executionId,
    records: input.costObservations,
    recordedAt: observedAt,
  });
  const metricsUpdated = await services.updateMetrics(
    input.db,
    input.projectId,
    {
      runId: input.work.runId,
      attempt: attempt.run_attempt,
      workerId: input.worker.binding.id,
      executionId: input.executionId,
      metrics: input.executionMetrics,
    },
  );
  if (!metricsUpdated) {
    throw new HttpError(409, "Execution attempt is no longer current");
  }
  return { metricsUpdated, usageStored, costStored };
}
