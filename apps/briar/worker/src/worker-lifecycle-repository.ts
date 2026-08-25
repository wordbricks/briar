export type WorkerHardDeleteReason =
  | "explicit_user_unlink"
  | "explicit_user_deprovision"
  | "managed_deprovision";

export type WorkerLifecycleOperation =
  | "binding_delete"
  | "device_delete"
  | "binding_preserved";

export type WorkerLifecycleTarget = {
  requestId: string;
  organizationId: string;
  projectId: string | null;
  deviceId: string;
  workerId: string | null;
};

export type WorkerHardDeleteContext = WorkerLifecycleTarget & {
  operation: Exclude<WorkerLifecycleOperation, "binding_preserved">;
  reason: WorkerHardDeleteReason;
  observedAt: string;
};

export type D1MutationMetrics = {
  rowsRead: number;
  rowsWritten: number;
  changes: number;
};

type WorkerHardDeleteDetail =
  | {
      bindingCount: number;
      disableRowsWritten: number;
      deviceDeleteRowsWritten: number;
    }
  | {
      bindingDeleteRowsWritten: number;
      remainingBindings: number;
      deviceStateRowsWritten: number;
    };

type WorkerPreservedDetail =
  | {
      bindingPreserved: true;
      detection: "heartbeat_after_stale";
    }
  | {
      bindingPreserved: true;
      targetVersion: string;
      currentVersion: string;
    };

type WorkerLifecycleEventRow = {
  request_id: string;
  organization_id: string;
  project_id: string | null;
  device_id: string;
  worker_id: string | null;
  operation: WorkerLifecycleOperation;
  reason: WorkerHardDeleteReason | "restart" | "update";
  outcome: "started" | "deleted" | "preserved" | "blocked" | "failed";
  attempt_count: number;
  hard_delete_rows_read: number;
  hard_delete_rows_written: number;
  detail_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export class WorkerLifecycleConflictError extends Error {}

const eventSelection = `select request_id, organization_id, project_id,
  device_id, worker_id, operation, reason, outcome, attempt_count,
  hard_delete_rows_read, hard_delete_rows_written, detail_json,
  created_at, updated_at, completed_at
  from briar_execution_worker_lifecycle_events`;

const WORKER_LIFECYCLE_ATTEMPT_LEASE_MS = 5 * 60_000;

const lifecycleTargetMatches = (
  row: WorkerLifecycleEventRow,
  target: WorkerLifecycleTarget & { operation: WorkerLifecycleOperation },
) =>
  row.organization_id === target.organizationId &&
  row.project_id === target.projectId &&
  row.device_id === target.deviceId &&
  row.worker_id === target.workerId &&
  row.operation === target.operation;

const logLifecycleEvent = (input: {
  context: WorkerLifecycleTarget & {
    operation: WorkerLifecycleOperation;
    reason: WorkerLifecycleEventRow["reason"];
  };
  outcome: WorkerLifecycleEventRow["outcome"] | "retry";
  attemptCount: number;
  metrics?: D1MutationMetrics;
  detail?: Record<string, number | string | boolean | null>;
}) => {
  console.info(JSON.stringify({
    message: "Execution Worker lifecycle observed",
    lifecycle: {
      requestId: input.context.requestId,
      organizationId: input.context.organizationId,
      projectId: input.context.projectId,
      deviceId: input.context.deviceId,
      workerId: input.context.workerId,
      operation: input.context.operation,
      reason: input.context.reason,
      outcome: input.outcome,
      attemptCount: input.attemptCount,
      hardDeleteRowsRead: input.metrics?.rowsRead ?? 0,
      hardDeleteRowsWritten: input.metrics?.rowsWritten ?? 0,
      ...input.detail,
    },
  }));
};

export const d1MutationMetrics = (
  results: Array<D1Result<unknown> | undefined>,
): D1MutationMetrics =>
  results.reduce<D1MutationMetrics>(
    (total, result) => ({
      rowsRead: total.rowsRead + (result?.meta.rows_read ?? 0),
      rowsWritten: total.rowsWritten + (result?.meta.rows_written ?? 0),
      changes: total.changes + (result?.meta.changes ?? 0),
    }),
    { rowsRead: 0, rowsWritten: 0, changes: 0 },
  );

export const addD1MutationMetrics = (
  ...metrics: D1MutationMetrics[]
): D1MutationMetrics =>
  metrics.reduce<D1MutationMetrics>(
    (total, metric) => ({
      rowsRead: total.rowsRead + metric.rowsRead,
      rowsWritten: total.rowsWritten + metric.rowsWritten,
      changes: total.changes + metric.changes,
    }),
    { rowsRead: 0, rowsWritten: 0, changes: 0 },
  );

async function lifecycleEventByRequestId(
  db: D1Database,
  requestId: string,
) {
  return db
    .prepare(`${eventSelection} where request_id = ?`)
    .bind(requestId)
    .first<WorkerLifecycleEventRow>();
}

/**
 * Start an idempotent hard-delete attempt. A completed event is replayed
 * without executing its trigger cascade again; blocked and failed attempts may
 * be retried with the same request id.
 */
export async function beginWorkerHardDelete(
  db: D1Database,
  context: WorkerHardDeleteContext,
) {
  const existing = await lifecycleEventByRequestId(db, context.requestId);
  if (existing) {
    if (!lifecycleTargetMatches(existing, context) || existing.reason !== context.reason) {
      throw new WorkerLifecycleConflictError(
        "Worker lifecycle request id belongs to another operation",
      );
    }
    const attemptCount = existing.attempt_count + 1;
    if (existing.outcome === "started") {
      const previousAttemptAt = Date.parse(existing.updated_at);
      const retryAt = Date.parse(context.observedAt);
      if (
        !Number.isFinite(previousAttemptAt) ||
        !Number.isFinite(retryAt) ||
        retryAt - previousAttemptAt < WORKER_LIFECYCLE_ATTEMPT_LEASE_MS
      ) {
        throw new WorkerLifecycleConflictError(
          "Worker lifecycle request is already in progress",
        );
      }
      const recovered = await db
        .prepare(
          `update briar_execution_worker_lifecycle_events
           set attempt_count = ?, updated_at = ?
           where request_id = ? and outcome = 'started' and updated_at = ?`,
        )
        .bind(
          attemptCount,
          context.observedAt,
          context.requestId,
          existing.updated_at,
        )
        .run();
      if ((recovered.meta.changes ?? 0) < 1) {
        return beginWorkerHardDelete(db, context);
      }
      logLifecycleEvent({
        context,
        outcome: "retry",
        attemptCount,
        detail: { recoveredStaleAttempt: true },
      });
      return { replayed: false, attemptCount } as const;
    }
    await db
      .prepare(
        `update briar_execution_worker_lifecycle_events
         set attempt_count = ?, updated_at = ?
         where request_id = ?`,
      )
      .bind(attemptCount, context.observedAt, context.requestId)
      .run();
    if (existing.outcome === "deleted") {
      const metrics = {
        rowsRead: existing.hard_delete_rows_read,
        rowsWritten: existing.hard_delete_rows_written,
        changes: 0,
      };
      logLifecycleEvent({
        context,
        outcome: "retry",
        attemptCount,
        metrics,
        detail: { replayedOutcome: "deleted" },
      });
      return { replayed: true, attemptCount, metrics } as const;
    }
    await db
      .prepare(
        `update briar_execution_worker_lifecycle_events
         set outcome = 'started', completed_at = null, updated_at = ?
         where request_id = ?`,
      )
      .bind(context.observedAt, context.requestId)
      .run();
    logLifecycleEvent({ context, outcome: "retry", attemptCount });
    return { replayed: false, attemptCount } as const;
  }

  const inserted = await db
    .prepare(
      `insert into briar_execution_worker_lifecycle_events (
         request_id, organization_id, project_id, device_id, worker_id,
         operation, reason, outcome, attempt_count, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, 'started', 1, ?, ?)
       on conflict (request_id) do nothing`,
    )
    .bind(
      context.requestId,
      context.organizationId,
      context.projectId,
      context.deviceId,
      context.workerId,
      context.operation,
      context.reason,
      context.observedAt,
      context.observedAt,
    )
    .run();
  if ((inserted.meta.changes ?? 0) < 1) {
    return beginWorkerHardDelete(db, context);
  }
  logLifecycleEvent({ context, outcome: "started", attemptCount: 1 });
  return { replayed: false, attemptCount: 1 } as const;
}

export async function completeWorkerHardDelete(
  db: D1Database,
  context: WorkerHardDeleteContext,
  input: {
    attemptCount: number;
    metrics: D1MutationMetrics;
    detail: WorkerHardDeleteDetail;
  },
) {
  await db
    .prepare(
      `update briar_execution_worker_lifecycle_events
       set outcome = 'deleted', hard_delete_rows_read = ?,
           hard_delete_rows_written = ?, detail_json = ?, completed_at = ?,
           updated_at = ?
       where request_id = ? and outcome = 'started'`,
    )
    .bind(
      input.metrics.rowsRead,
      input.metrics.rowsWritten,
      JSON.stringify(input.detail),
      context.observedAt,
      context.observedAt,
      context.requestId,
    )
    .run();
  logLifecycleEvent({
    context,
    outcome: "deleted",
    attemptCount: input.attemptCount,
    metrics: input.metrics,
    detail: input.detail,
  });
}

export async function failWorkerHardDelete(
  db: D1Database,
  context: WorkerHardDeleteContext,
  input: {
    attemptCount: number;
    outcome: "blocked" | "failed";
    reasonCode: "active_sessions" | "mutation_failed";
    metrics: D1MutationMetrics;
  },
) {
  await db
    .prepare(
      `update briar_execution_worker_lifecycle_events
       set outcome = ?, hard_delete_rows_read = ?, hard_delete_rows_written = ?,
           detail_json = ?, completed_at = ?, updated_at = ?
       where request_id = ? and outcome = 'started'`,
    )
    .bind(
      input.outcome,
      input.metrics.rowsRead,
      input.metrics.rowsWritten,
      JSON.stringify({ reasonCode: input.reasonCode }),
      context.observedAt,
      context.observedAt,
      context.requestId,
    )
    .run();
  logLifecycleEvent({
    context,
    outcome: input.outcome,
    attemptCount: input.attemptCount,
    metrics: input.metrics,
    detail: { reasonCode: input.reasonCode },
  });
}

/**
 * Resolve an idempotent retry after its target is already absent. A prior
 * attempt may have completed normally, or deletion may have committed before
 * its final telemetry update. Exact target matching prevents an unrelated
 * request id from being used to acknowledge a different deletion.
 */
export async function recoverMissingWorkerHardDelete(
  db: D1Database,
  target: Omit<WorkerLifecycleTarget, "deviceId"> & {
    deviceId?: string;
    operation: Exclude<WorkerLifecycleOperation, "binding_preserved">;
    observedAt: string;
  },
) {
  const existing = await lifecycleEventByRequestId(db, target.requestId);
  if (!existing) return false;
  const resolvedTarget = { ...target, deviceId: target.deviceId ?? existing.device_id };
  if (!lifecycleTargetMatches(existing, resolvedTarget)) {
    throw new WorkerLifecycleConflictError(
      "Worker lifecycle request id belongs to another operation",
    );
  }
  const attemptCount = existing.attempt_count + 1;
  const recoveredAfterMissingTarget = existing.outcome !== "deleted";
  await db
    .prepare(
      `update briar_execution_worker_lifecycle_events
       set outcome = 'deleted', attempt_count = ?,
           detail_json = case when ? then json_set(
             detail_json, '$.recoveredAfterMissingTarget', json('true')
           ) else detail_json end,
           completed_at = coalesce(completed_at, ?), updated_at = ?
       where request_id = ?`,
    )
    .bind(
      attemptCount,
      recoveredAfterMissingTarget ? 1 : 0,
      target.observedAt,
      target.observedAt,
      target.requestId,
    )
    .run();
  logLifecycleEvent({
    context: { ...resolvedTarget, reason: existing.reason },
    outcome: "retry",
    attemptCount,
    metrics: {
      rowsRead: existing.hard_delete_rows_read,
      rowsWritten: existing.hard_delete_rows_written,
      changes: 0,
    },
    detail: {
      replayedOutcome: "deleted",
      recoveredAfterMissingTarget,
    },
  });
  return true;
}

export async function recordPreservedWorkerBinding(
  db: D1Database,
  context: WorkerLifecycleTarget & {
    reason: "restart" | "update";
    observedAt: string;
    detail: WorkerPreservedDetail;
  },
) {
  const operation = "binding_preserved" as const;
  const inserted = await db
    .prepare(
      `insert into briar_execution_worker_lifecycle_events (
         request_id, organization_id, project_id, device_id, worker_id,
         operation, reason, outcome, attempt_count,
         hard_delete_rows_read, hard_delete_rows_written, detail_json,
         created_at, updated_at, completed_at
       ) values (?, ?, ?, ?, ?, ?, ?, 'preserved', 1, 0, 0, ?, ?, ?, ?)
       on conflict (request_id) do nothing`,
    )
    .bind(
      context.requestId,
      context.organizationId,
      context.projectId,
      context.deviceId,
      context.workerId,
      operation,
      context.reason,
      JSON.stringify(context.detail),
      context.observedAt,
      context.observedAt,
      context.observedAt,
    )
    .run();
  if ((inserted.meta.changes ?? 0) < 1) return false;
  logLifecycleEvent({
    context: { ...context, operation },
    outcome: "preserved",
    attemptCount: 1,
    detail: context.detail,
  });
  return true;
}
