/**
 * Detached execution workers and their agent transcripts.
 *
 * A worker is a machine running `briar worker`: it claims queued issues, runs
 * the agent locally, and reports progress here. Multiple workers per project
 * are supported, so every race in this module is closed rather than avoided by
 * limiting concurrency — see docs/plans/remote-execution-hosts.md §2.7.
 */

export type ExecutionWorkerState = "online" | "stale" | "disabled";
export type AgentProvider = "codex" | "claude";
export type TranscriptDirection = "client" | "server";

export type ExecutionWorkerRow = {
  id: string;
  project_id: string;
  label: string;
  host_fingerprint: string;
  agent_provider: AgentProvider;
  versions_json: string;
  state: ExecutionWorkerState;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
};

export type TranscriptSessionRow = {
  session_id: string;
  project_id: string;
  run_id: string | null;
  worker_id: string | null;
  agent_provider: AgentProvider;
  started_at: string;
  last_event_at: string;
  event_count: number;
  byte_count: number;
};

export type TranscriptEventInput = {
  sequence: number;
  direction: TranscriptDirection;
  payload: unknown;
};

/** Heartbeat older than this and the worker is reported as stale. */
export const WORKER_STALE_AFTER_MS = 3 * 60_000;
/** Lease length granted at claim time and by every renewal. */
export const LEASE_DURATION_MS = 15 * 60_000;
/** Workers renew every 5 minutes, so a lease this far past expiry is stalled. */
export const STALLED_RUN_GRACE_MS = 5 * 60_000;
/** Reaping past this many attempts blocks the run instead of looping forever. */
export const MAX_CLAIM_ATTEMPTS = 5;

export const MAX_TRANSCRIPT_PAYLOAD_BYTES = 32 * 1024;
export const MAX_TRANSCRIPT_EVENTS_PER_REQUEST = 200;
export const MAX_TRANSCRIPT_REQUEST_BYTES = 1024 * 1024;
export const MAX_TRANSCRIPT_SESSION_EVENTS = 5_000;
export const MAX_TRANSCRIPT_SESSION_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSCRIPT_SESSIONS_PER_PROJECT = 50;

export class WorkerConflictError extends Error {}
export class TranscriptLimitError extends Error {}

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export const workerStateAt = (
  lastHeartbeatAt: string,
  observedAt: string,
  state: ExecutionWorkerState,
): ExecutionWorkerState => {
  if (state === "disabled") return "disabled";
  const heartbeat = Date.parse(lastHeartbeatAt);
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(heartbeat) || !Number.isFinite(observed)) return "stale";
  return observed - heartbeat > WORKER_STALE_AFTER_MS ? "stale" : "online";
};

export const leaseExpiryFrom = (observedAt: string) =>
  new Date(Date.parse(observedAt) + LEASE_DURATION_MS).toISOString();

/**
 * Register a worker, or adopt the existing registration for the same machine.
 * Idempotent so a restarted worker keeps its identity and its run attribution.
 */
export async function registerExecutionWorker(
  db: D1Database,
  projectId: string,
  input: {
    label: string;
    hostFingerprint: string;
    agentProvider: AgentProvider;
    versions: Record<string, string>;
    observedAt: string;
    id: string;
  },
) {
  const label = input.label.trim();
  if (label.length < 1 || label.length > 100) {
    throw new WorkerConflictError("Worker label must be 1-100 characters");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.hostFingerprint)) {
    throw new WorkerConflictError("Worker host fingerprint must be a SHA-256 hex digest");
  }
  const versions = JSON.stringify(input.versions ?? {});
  await db
    .prepare(
      `insert into briar_execution_workers (
         id, project_id, label, host_fingerprint, agent_provider, versions_json,
         state, last_heartbeat_at, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)
       on conflict (project_id, host_fingerprint) do update set
         label = excluded.label,
         agent_provider = excluded.agent_provider,
         versions_json = excluded.versions_json,
         state = case
           when briar_execution_workers.state = 'disabled' then 'disabled'
           else 'online'
         end,
         last_heartbeat_at = excluded.last_heartbeat_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.id,
      projectId,
      label,
      input.hostFingerprint,
      input.agentProvider,
      versions,
      input.observedAt,
      input.observedAt,
      input.observedAt,
    )
    .run();

  return await db
    .prepare(
      `select * from briar_execution_workers
       where project_id = ? and host_fingerprint = ?`,
    )
    .bind(projectId, input.hostFingerprint)
    .first<ExecutionWorkerRow>();
}

export async function recordWorkerHeartbeat(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    versions?: Record<string, string>;
    observedAt: string;
  },
) {
  const row = await db
    .prepare(
      `update briar_execution_workers
       set last_heartbeat_at = ?,
           updated_at = ?,
           versions_json = coalesce(?, versions_json),
           state = case when state = 'disabled' then 'disabled' else 'online' end
       where id = ? and project_id = ?
       returning *`,
    )
    .bind(
      input.observedAt,
      input.observedAt,
      input.versions ? JSON.stringify(input.versions) : null,
      input.workerId,
      projectId,
    )
    .first<ExecutionWorkerRow>();
  if (!row) throw new WorkerConflictError("Worker is not registered for this project");
  return row;
}

export async function listExecutionWorkers(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const result = await db
    .prepare(
      `select * from briar_execution_workers
       where project_id = ?
       order by last_heartbeat_at desc, id asc`,
    )
    .bind(projectId)
    .all<ExecutionWorkerRow>();
  return (result.results ?? []).map((row) => ({
    ...row,
    state: workerStateAt(row.last_heartbeat_at, observedAt, row.state),
  }));
}

/**
 * A worker may hold one run at a time. Enforced server-side so a worker that
 * restarts mid-run cannot double-book itself against a second issue.
 */
export async function assertWorkerHasNoRunInFlight(
  db: D1Database,
  projectId: string,
  workerId: string,
) {
  const row = await db
    .prepare(
      `select id from briar_hunt_runs
       where project_id = ? and worker_id = ?
         and status not in ('completed', 'cancelled', 'blocked', 'failed')
       limit 1`,
    )
    .bind(projectId, workerId)
    .first<{ id: string }>();
  if (row) {
    throw new WorkerConflictError(
      `Worker already holds run ${row.id}; finish or release it before claiming another`,
    );
  }
}

export async function attributeRunToWorker(
  db: D1Database,
  projectId: string,
  input: { runId: string; workerId: string; observedAt: string },
) {
  await db
    .prepare(
      `update briar_hunt_runs
       set worker_id = ?, updated_at = ?
       where id = ? and project_id = ?`,
    )
    .bind(input.workerId, input.observedAt, input.runId, projectId)
    .run();
}

/**
 * Extend the lease of a run the caller proved it holds. Without this a long
 * run silently loses its claim 15 minutes in and can be taken by another
 * worker while it is still working.
 */
export async function renewHuntRunLease(
  db: D1Database,
  projectId: string,
  input: { runId: string; claimTokenHash: string; observedAt: string },
) {
  const leaseExpiresAt = leaseExpiryFrom(input.observedAt);
  const row = await db
    .prepare(
      `update briar_hunt_runs
       set lease_expires_at = ?, updated_at = ?
       where id = ? and project_id = ? and claim_token_hash = ?
         and status not in ('completed', 'cancelled')
       returning id, lease_expires_at`,
    )
    .bind(leaseExpiresAt, input.observedAt, input.runId, projectId, input.claimTokenHash)
    .first<{ id: string; lease_expires_at: string }>();
  if (!row) {
    throw new WorkerConflictError("Auto Hunt claim token is no longer active");
  }
  return row;
}

export type ReapedRun = {
  runId: string;
  outcome: "requeued" | "blocked";
  workerId: string | null;
  claimAttempts: number;
};

/**
 * Return runs whose holder stopped reporting.
 *
 * `assertQueuedHuntClaim` only gates writes while a run is still `queued`; once
 * the first event moves it out of `queued` the run is no longer claimable and
 * its lease no longer gates writes, so a worker that dies mid-run would leave
 * the issue in progress forever. Called opportunistically on claim and on
 * dashboard reads rather than from a cron trigger.
 */
export async function reapStalledHuntRuns(
  db: D1Database,
  projectId: string,
  observedAt: string,
): Promise<ReapedRun[]> {
  const cutoff = new Date(Date.parse(observedAt) - STALLED_RUN_GRACE_MS).toISOString();
  const stalled = await db
    .prepare(
      `select id, worker_id, claim_attempts from briar_hunt_runs
       where project_id = ?
         and status not in ('queued', 'completed', 'cancelled', 'blocked', 'failed')
         and claim_token_hash is not null
         and lease_expires_at is not null
         and lease_expires_at <= ?
       order by run_number asc`,
    )
    .bind(projectId, cutoff)
    .all<{ id: string; worker_id: string | null; claim_attempts: number }>();

  const reaped: ReapedRun[] = [];
  for (const run of stalled.results ?? []) {
    const blocked = run.claim_attempts >= MAX_CLAIM_ATTEMPTS;
    await db
      .prepare(
        `update briar_hunt_runs
         set status = ?,
             stage = ?,
             claim_token_hash = null,
             claimed_by = null,
             claimed_at = null,
             lease_expires_at = null,
             detail = ?,
             last_event_at = ?,
             updated_at = ?
         where id = ? and project_id = ?`,
      )
      .bind(
        blocked ? "blocked" : "queued",
        blocked ? "blocked" : "queued",
        blocked
          ? "워커가 응답하지 않아 재시도 한도를 넘었습니다."
          : "워커가 응답하지 않아 대기열로 돌아갔습니다.",
        observedAt,
        observedAt,
        run.id,
        projectId,
      )
      .run();
    reaped.push({
      runId: run.id,
      outcome: blocked ? "blocked" : "requeued",
      workerId: run.worker_id,
      claimAttempts: run.claim_attempts,
    });
  }
  return reaped;
}

/** Runs currently held under a live lease, so automation does not double-dispatch. */
export async function countLeasedRuns(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const row = await db
    .prepare(
      `select count(*) as leased from briar_hunt_runs
       where project_id = ?
         and claim_token_hash is not null
         and lease_expires_at is not null
         and lease_expires_at > ?
         and status not in ('completed', 'cancelled', 'blocked', 'failed')`,
    )
    .bind(projectId, observedAt)
    .first<{ leased: number }>();
  return row?.leased ?? 0;
}

/**
 * Append transcript events and prune old sessions in the same request, so
 * retention needs no scheduled job.
 */
export async function appendAgentTranscript(
  db: D1Database,
  projectId: string,
  input: {
    sessionId: string;
    runId: string | null;
    workerId: string | null;
    agentProvider: AgentProvider;
    events: TranscriptEventInput[];
    observedAt: string;
  },
) {
  const sessionId = input.sessionId.trim();
  if (sessionId.length < 1 || sessionId.length > 128) {
    throw new TranscriptLimitError("Transcript session id must be 1-128 characters");
  }
  if (input.events.length === 0) {
    throw new TranscriptLimitError("Transcript request carried no events");
  }
  if (input.events.length > MAX_TRANSCRIPT_EVENTS_PER_REQUEST) {
    throw new TranscriptLimitError(
      `Transcript request may carry at most ${MAX_TRANSCRIPT_EVENTS_PER_REQUEST} events`,
    );
  }

  const payloads = input.events.map((event) => {
    const serialized = JSON.stringify(event.payload ?? null);
    const bytes = utf8Length(serialized);
    if (bytes > MAX_TRANSCRIPT_PAYLOAD_BYTES) {
      // Rejected rather than truncated: a silently clipped payload reads as a
      // real agent message downstream.
      throw new TranscriptLimitError(
        `Transcript event ${event.sequence} exceeds ${MAX_TRANSCRIPT_PAYLOAD_BYTES} bytes`,
      );
    }
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      throw new TranscriptLimitError("Transcript sequence numbers start at 1");
    }
    return { ...event, serialized, bytes };
  });
  const requestBytes = payloads.reduce((total, event) => total + event.bytes, 0);
  if (requestBytes > MAX_TRANSCRIPT_REQUEST_BYTES) {
    throw new TranscriptLimitError(
      `Transcript request may carry at most ${MAX_TRANSCRIPT_REQUEST_BYTES} bytes`,
    );
  }

  const existing = await db
    .prepare(
      `select * from briar_agent_transcript_sessions
       where session_id = ? and project_id = ?`,
    )
    .bind(sessionId, projectId)
    .first<TranscriptSessionRow>();
  if (
    existing &&
    (existing.event_count + payloads.length > MAX_TRANSCRIPT_SESSION_EVENTS ||
      existing.byte_count + requestBytes > MAX_TRANSCRIPT_SESSION_BYTES)
  ) {
    throw new TranscriptLimitError(
      "Transcript session reached its retention limit; further events are not stored",
    );
  }

  if (!existing) {
    await db
      .prepare(
        `insert into briar_agent_transcript_sessions (
           session_id, project_id, run_id, worker_id, agent_provider,
           started_at, last_event_at, event_count, byte_count
         ) values (?, ?, ?, ?, ?, ?, ?, 0, 0)
         on conflict (session_id) do nothing`,
      )
      .bind(
        sessionId,
        projectId,
        input.runId,
        input.workerId,
        input.agentProvider,
        input.observedAt,
        input.observedAt,
      )
      .run();
  }

  let stored = 0;
  let storedBytes = 0;
  for (const event of payloads) {
    const result = await db
      .prepare(
        `insert into briar_agent_transcripts (
           session_id, sequence, direction, payload_json, recorded_at
         ) values (?, ?, ?, ?, ?)
         on conflict (session_id, sequence) do nothing`,
      )
      .bind(sessionId, event.sequence, event.direction, event.serialized, input.observedAt)
      .run();
    // A retried batch must not inflate the counters it is charged against.
    if (result.meta.changes > 0) {
      stored += 1;
      storedBytes += event.bytes;
    }
  }

  await db
    .prepare(
      `update briar_agent_transcript_sessions
       set last_event_at = ?,
           event_count = event_count + ?,
           byte_count = byte_count + ?,
           run_id = coalesce(run_id, ?),
           worker_id = coalesce(worker_id, ?)
       where session_id = ?`,
    )
    .bind(
      input.observedAt,
      stored,
      storedBytes,
      input.runId,
      input.workerId,
      sessionId,
    )
    .run();

  const pruned = await pruneAgentTranscriptSessions(db, projectId);
  return { sessionId, stored, storedBytes, pruned };
}

/** Keep the newest sessions per project, oldest pruned first. */
export async function pruneAgentTranscriptSessions(db: D1Database, projectId: string) {
  const stale = await db
    .prepare(
      `select session_id from briar_agent_transcript_sessions
       where project_id = ?
       order by last_event_at desc, session_id asc
       limit -1 offset ?`,
    )
    .bind(projectId, MAX_TRANSCRIPT_SESSIONS_PER_PROJECT)
    .all<{ session_id: string }>();
  const sessions = (stale.results ?? []).map((row) => row.session_id);
  for (const sessionId of sessions) {
    await db
      .prepare(`delete from briar_agent_transcript_sessions where session_id = ?`)
      .bind(sessionId)
      .run();
  }
  return sessions;
}

export async function readAgentTranscript(
  db: D1Database,
  projectId: string,
  sessionId: string,
  options: { afterSequence?: number; limit?: number } = {},
) {
  const session = await db
    .prepare(
      `select * from briar_agent_transcript_sessions
       where session_id = ? and project_id = ?`,
    )
    .bind(sessionId, projectId)
    .first<TranscriptSessionRow>();
  if (!session) return null;
  const result = await db
    .prepare(
      `select sequence, direction, payload_json, recorded_at
       from briar_agent_transcripts
       where session_id = ? and sequence > ?
       order by sequence asc
       limit ?`,
    )
    .bind(
      sessionId,
      options.afterSequence ?? 0,
      Math.min(options.limit ?? 1_000, MAX_TRANSCRIPT_SESSION_EVENTS),
    )
    .all<{
      sequence: number;
      direction: TranscriptDirection;
      payload_json: string;
      recorded_at: string;
    }>();
  return { session, events: result.results ?? [] };
}
