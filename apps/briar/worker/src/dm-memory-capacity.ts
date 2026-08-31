const ready = new WeakSet<D1Database>();

/** Older schemas cannot own learning leases; keep ordinary Worker claims usable during an upgrade. */
export async function dmLearningCapacityTable(db: D1Database) {
  if (!ready.has(db)) {
    const column = await db.prepare("select 1 from pragma_table_info('briar_dm_memory_jobs') where name = 'claimed_device_id'").first();
    if (!column) return `(select null as id, null as claimed_worker_id, null as claimed_device_id,
      null as kind, null as status, null as lease_expires_at where 0)`;
    ready.add(db);
  }
  return "briar_dm_memory_jobs";
}
