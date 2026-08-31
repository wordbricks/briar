import * as Schema from "effect/Schema";
import { DmMemoryLearningStatus } from "../../src/lib/dm-memory-contract";
import { dmLearningFailureCodes, type DmLearningPolicy } from "../../src/lib/dm-memory-learning-contract";
import { dmLearningCapacityTable } from "./dm-memory-capacity";
import type { DmMemoryOwner } from "./dm-memory-repository";

export async function readDmLearningStatus(db: D1Database, owner: DmMemoryOwner, spaceId: string | null,
  policy: DmLearningPolicy | null, now = new Date().toISOString()): Promise<DmMemoryLearningStatus | null> {
  if (await dmLearningCapacityTable(db) !== "briar_dm_memory_jobs") return null;
  const configuration = policy ? {
    proposer: { model: policy.proposer.model, provider: policy.proposer.upstreamProvider },
    verifier: { model: policy.verifier.model, provider: policy.verifier.upstreamProvider },
    spaceDailyCalls: policy.spaceDailyCalls, spaceDailyMicroUsd: policy.spaceDailyMicroUsd,
  } : null;
  if (!spaceId) return { configuration, callsToday: 0, reservedMicroUsdToday: 0, pendingJobs: 0, failedJobs: 0,
    lastJob: null, retryableJob: null };
  const allowed = await db.prepare(`select 1 from briar_dm_memory_spaces space
    where space.id = ? and space.organization_id = ? and space.channel_id = ? and space.owner_user_id = ?
      and exists (select 1 from briar_organization_members member
        where member.organization_id = space.organization_id and member.user_id = space.owner_user_id)`)
    .bind(spaceId, owner.organizationId, owner.channelId, owner.userId).first();
  if (!allowed) return null;
  const usage = (await db.prepare(`select count(*) as callsToday,
    coalesce(sum(max(reserved_micro_usd, coalesce(cost_micro_usd, 0))), 0) as reservedMicroUsdToday
    from briar_dm_memory_model_calls where space_id = ? and created_at >= ?`)
    .bind(spaceId, `${now.slice(0, 10)}T00:00:00.000Z`).first<{ callsToday: number; reservedMicroUsdToday: number }>())!;
  const counts = (await db.prepare(`select coalesce(sum(status in ('pending', 'running', 'retry_wait')), 0) as pendingJobs,
    coalesce(sum(status = 'failed'), 0) as failedJobs from briar_dm_memory_jobs
    where space_id = ? and kind in ('extract', 'explicit_request', 'consolidate')`)
    .bind(spaceId).first<{ pendingJobs: number; failedJobs: number }>())!;
  const last = await db.prepare(`select id, kind, status, stage, error_code as errorCode, updated_at as updatedAt
    from briar_dm_memory_jobs where space_id = ? and kind in ('extract', 'explicit_request', 'consolidate')
    order by updated_at desc, id desc limit 1`).bind(spaceId)
    .first<{ id: string; kind: string; status: string; stage: string | null; errorCode: string | null; updatedAt: string }>();
  const retryableJob = policy ? await db.prepare(`select id, calls_used as callsUsed from briar_dm_memory_jobs
    where space_id = ? and status = 'failed' and kind in ('extract', 'explicit_request', 'consolidate') and calls_used <= 4
    order by created_at, id limit 1`).bind(spaceId).first<{ id: string; callsUsed: number }>() : null;
  return Schema.decodeUnknownSync(DmMemoryLearningStatus)({ configuration, ...usage, ...counts,
    retryableJob, lastJob: last ? { ...last, errorCode: dmLearningFailureCodes.find((code) => code === last.errorCode) ?? null } : null });
}
