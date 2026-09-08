import { pendingExecutionWorkerUpdate } from "./worker-update-repository";

/** Merge batches resume their persisted pipeline, rather than a provider conversation. */
export async function handoffAuxiliaryWorkerUpdate(db: D1Database, input: {
  requestId: string; deviceId: string; workerId: string; workId: string;
  workType: "mergeBatch"; claimTokenHash: string; observedAt: string;
}) {
  const request = await pendingExecutionWorkerUpdate(db, input.deviceId);
  if (request?.id !== input.requestId || request.handoffState === "idle" || request.handoffState === "failed") return false;
  const reservation = db.prepare(
    `insert into briar_worker_update_reservations(work_type, work_id, device_id, request_id)
     select ?, ?, ?, ? where exists (
       select 1 from briar_merge_batches where id = ? and claimed_worker_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
     ) on conflict (work_type, work_id) do nothing`,
  ).bind(input.workType, input.workId, input.deviceId, input.requestId,
    input.workId, input.workerId, input.claimTokenHash, input.observedAt);
  const release = db.prepare(`update briar_merge_batches set claim_token_hash = null, claimed_worker_id = null,
       claimed_by = null, claimed_at = null, lease_expires_at = null, updated_at = ?
       where id = ? and claimed_worker_id = ? and claim_token_hash = ? and lease_expires_at > ?`,
  ).bind(input.observedAt,
    input.workId, input.workerId, input.claimTokenHash, input.observedAt);
  await db.batch([reservation, release]);
  return Boolean(await db.prepare(
    `select 1 from briar_worker_update_reservations
     where work_type = ? and work_id = ? and device_id = ? and request_id = ?`,
  ).bind(input.workType, input.workId, input.deviceId, input.requestId).first());
}
