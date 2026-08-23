export const archiveCleanupQueueUpsertSql = `
  on conflict (bucket, object_key) do update set
    project_id = excluded.project_id,
    run_id = excluded.run_id,
    queued_at = excluded.queued_at,
    attempts = 0,
    last_attempt_at = null,
    last_error = null,
    generation = briar_archive_cleanup_queue.generation + 1,
    next_attempt_at = null,
    dead_lettered_at = null,
    alert_state = 'none',
    alert_detail_json = null`;
