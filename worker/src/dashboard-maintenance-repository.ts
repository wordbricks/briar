const DASHBOARD_CHANGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_DASHBOARD_CHANGE_PRUNE_BATCH_SIZE = 25_000;

export type DashboardChangePruneResult = {
  cutoff: string;
  deleted: number;
  reachedBatchLimit: boolean;
};

export async function pruneExpiredDashboardChanges(
  db: D1Database,
  observedAt: string,
  batchSize = DEFAULT_DASHBOARD_CHANGE_PRUNE_BATCH_SIZE,
): Promise<DashboardChangePruneResult> {
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    throw new TypeError("Dashboard change prune time must be a valid timestamp");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError("Dashboard change prune batch size must be positive");
  }
  const cutoff = new Date(observedAtMs - DASHBOARD_CHANGE_RETENTION_MS)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const result = await db
    .prepare(
      `delete from briar_dashboard_changes
       where version in (
         select version from briar_dashboard_changes
         where created_at < ?
         order by created_at
         limit ?
       )`,
    )
    .bind(cutoff, batchSize)
    .run();
  const deleted = result.meta.changes ?? 0;
  return {
    cutoff,
    deleted,
    reachedBatchLimit: deleted === batchSize,
  };
}
