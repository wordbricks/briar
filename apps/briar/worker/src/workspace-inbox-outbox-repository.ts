export async function getWorkspaceInboxSyncVersion(
  db: D1Database,
  workspaceId: string,
) {
  const state = await db
    .prepare(
      `select current_version
       from briar_organization_inbox_sync_state
       where organization_id = ?`,
    )
    .bind(workspaceId)
    .first<{ current_version: number }>();
  return state?.current_version ?? 0;
}

export type WorkspaceInboxRealtimeOutboxRow = {
  organization_id: string;
  version: number;
};

export async function listWorkspaceInboxRealtimeOutbox(
  db: D1Database,
  limit = 100,
) {
  const result = await db
    .prepare(
      `select organization_id, version
       from briar_organization_inbox_realtime_outbox
       order by updated_at, organization_id
       limit ?`,
    )
    .bind(Math.max(1, Math.min(limit, 100)))
    .all<WorkspaceInboxRealtimeOutboxRow>();
  return result.results;
}

export async function acknowledgeWorkspaceInboxRealtimeOutbox(
  db: D1Database,
  workspaceId: string,
  version: number,
) {
  await db
    .prepare(
      `delete from briar_organization_inbox_realtime_outbox
       where organization_id = ? and version <= ?`,
    )
    .bind(workspaceId, version)
    .run();
}
