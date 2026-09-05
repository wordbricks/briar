import * as Schema from "effect/Schema";
import { DmMemoryLearningStatus } from "../../src/lib/dm-memory-contract";
import { dmLearningFailureCodes, dmMemoryLearningVerifiedProviders,
  type DmLearningPolicy } from "../../src/lib/dm-memory-learning-contract";
import { dmLearningCapacityTable } from "./dm-memory-capacity";
import { dmLearningVerifiedProviderSql, dmLearningWorkerEligibleSql } from "./dm-memory-learning-claims";
import { dmLearningSpacePolicy } from "./dm-memory-learning-policy";
import type { DmMemoryOwner } from "./dm-memory-repository";

/** Same eligibility as an active claim, minus the job binding, so the owner sees why learning waits. */
const dmLearningWorkerAvailableSql = `select 1 from briar_dm_memory_spaces space
  join briar_project_agents agent on agent.id = space.agent_id and agent.organization_id = space.organization_id
  join briar_execution_worker_devices device on device.organization_id = space.organization_id
  join briar_execution_workers worker on worker.device_id = device.id
  where space.id = ? and ${dmLearningWorkerEligibleSql}
    and exists (select 1 from json_each(worker.runtime_proto_json, '$.capabilities.dmMemoryLearning.providers') provider
      where provider.value in (${dmLearningVerifiedProviderSql})) limit 1`;

export async function readDmLearningStatus(db: D1Database, owner: DmMemoryOwner, spaceId: string | null,
  now = new Date().toISOString()): Promise<DmMemoryLearningStatus | null> {
  if (await dmLearningCapacityTable(db) !== "briar_dm_memory_jobs") return null;
  const empty = { configuration: null, callsToday: 0, reservedMicroUsdToday: 0, pendingJobs: 0, failedJobs: 0,
    lastJob: null, retryableJob: null };
  if (!spaceId) return empty;
  const space = await db.prepare(`select agent.provider from briar_dm_memory_spaces space
    join briar_project_agents agent on agent.id = space.agent_id and agent.organization_id = space.organization_id
    where space.id = ? and space.organization_id = ? and space.channel_id = ? and space.owner_user_id = ?
      and exists (select 1 from briar_organization_members member
        where member.organization_id = space.organization_id and member.user_id = space.owner_user_id)`)
    .bind(spaceId, owner.organizationId, owner.channelId, owner.userId).first<{ provider: string }>();
  if (!space) return null;
  const policy = dmLearningSpacePolicy(space.provider);
  const displayModel = (model: DmLearningPolicy["proposer"]) => model.transport === "agent"
    ? { transport: model.transport, model: model.model ?? "default", provider: model.provider }
    : { transport: model.transport, model: model.model, provider: model.upstreamProvider };
  const configuration = {
    proposer: displayModel(policy.proposer),
    verifier: displayModel(policy.verifier),
    costTracked: policy.proposer.transport === "openrouter" && policy.verifier.transport === "openrouter",
    spaceDailyCalls: policy.spaceDailyCalls, spaceDailyMicroUsd: policy.spaceDailyMicroUsd,
    agentProvider: space.provider,
    agentProviderVerified: dmMemoryLearningVerifiedProviders.some((provider) => provider === space.provider),
    workerAvailable: await db.prepare(dmLearningWorkerAvailableSql).bind(spaceId, now).first() !== null,
  };
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
  const retryableJob = await db.prepare(`select id, calls_used as callsUsed from briar_dm_memory_jobs
    where space_id = ? and status = 'failed' and kind in ('extract', 'explicit_request', 'consolidate') and calls_used <= 4
    order by created_at, id limit 1`).bind(spaceId).first<{ id: string; callsUsed: number }>();
  return Schema.decodeUnknownSync(DmMemoryLearningStatus)({ configuration, ...usage, ...counts,
    retryableJob, lastJob: last ? { ...last, errorCode: dmLearningFailureCodes.find((code) => code === last.errorCode) ?? null } : null });
}
