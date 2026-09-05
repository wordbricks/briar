import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
import type { DmMemoryLearningRetryInput } from "../../src/lib/dm-memory-contract";
import { dmLearningLiveSpaceSql } from "./dm-memory-learning-input";
import { dmLearningSpacePolicy } from "./dm-memory-learning-policy";
import type { DmMemoryOwner } from "./dm-memory-repository";
import { HttpError } from "./http-response";

/** Owner-initiated recovery keeps the same input interval and six-call ceiling. */
export async function retryDmLearningJob(db: D1Database, owner: DmMemoryOwner, jobId: string,
  input: DmMemoryLearningRetryInput, now = new Date().toISOString()) {
  const space = await db.prepare(`select space.id, space.revocation_epoch, agent.provider from briar_dm_memory_jobs job
    join briar_dm_memory_spaces space on space.id = job.space_id
    join briar_project_agents agent on agent.id = space.agent_id and agent.organization_id = space.organization_id
    where job.id = ? and space.organization_id = ? and space.channel_id = ? and space.owner_user_id = ?
      and job.kind in ('extract', 'explicit_request', 'consolidate') and ${dmLearningLiveSpaceSql}
      and exists (select 1 from briar_organization_members member
        where member.organization_id = space.organization_id and member.user_id = space.owner_user_id)`)
    .bind(jobId, owner.organizationId, owner.channelId, owner.userId)
    .first<{ id: string; revocation_epoch: number; provider: string }>();
  if (!space) throw new HttpError(404, "Memory job not found", "memory_not_found");
  if (space.revocation_epoch !== input.revocationEpoch) throw new HttpError(409, "Memory scope changed", "memory_scope_revoked");
  // The retry restores the preferred policy; the claim resolves any fallback again.
  const policy = dmLearningSpacePolicy(space.provider);
  const prior = await db.prepare(`select job_id, space_id, revocation_epoch from briar_dm_memory_learning_retries where request_id = ?`)
    .bind(input.requestId).first<{ job_id: string; space_id: string; revocation_epoch: number }>();
  if (prior) {
    if (prior.job_id !== jobId || prior.space_id !== space.id || prior.revocation_epoch !== input.revocationEpoch) {
      throw new HttpError(409, "Memory retry request changed", "memory_conflict");
    }
    return { accepted: true, replayed: true };
  }
  const operationId = crypto.randomUUID();
  const day = `${now.slice(0, 10)}T00:00:00.000Z`;
  const [inserted] = await db.batch([
    db.prepare(`insert into briar_dm_memory_learning_retries(request_id, operation_id, job_id, space_id, revocation_epoch, created_at)
      select ?, ?, job.id, space.id, space.revocation_epoch, ? from briar_dm_memory_jobs job
      join briar_dm_memory_spaces space on space.id = job.space_id
      where job.id = ? and space.id = ? and space.revocation_epoch = ? and job.revocation_epoch = space.revocation_epoch
        and ${dmLearningLiveSpaceSql} and job.status = 'failed' and job.calls_used <= 4
        and (job.kind = 'explicit_request' or (space.use_enabled = 1 and space.auto_enabled = 1))
        and not exists (select 1 from briar_dm_memory_jobs active where active.space_id = space.id
          and active.kind in ('extract', 'explicit_request', 'consolidate') and active.status in ('pending', 'running', 'retry_wait'))
        and (select count(*) from briar_dm_memory_model_calls where space_id = space.id and created_at >= ?) + 2 <= ?
        and (select count(*) from briar_dm_memory_model_calls where organization_id = space.organization_id and created_at >= ?) + 2 <= ?
        and (select coalesce(sum(max(reserved_micro_usd, coalesce(cost_micro_usd, 0))), 0) from briar_dm_memory_model_calls
          where space_id = space.id and created_at >= ?) <= ?
        and (select coalesce(sum(max(reserved_micro_usd, coalesce(cost_micro_usd, 0))), 0) from briar_dm_memory_model_calls
          where organization_id = space.organization_id and created_at >= ?) <= ?
      on conflict (request_id) do nothing returning request_id`)
      .bind(input.requestId, operationId, now, jobId, space.id, input.revocationEpoch,
        day, policy.spaceDailyCalls, day, policy.organizationDailyCalls,
        day, policy.spaceDailyMicroUsd, day, policy.organizationDailyMicroUsd),
    db.prepare(`update briar_dm_memory_jobs set status = 'pending', stage = null, attempt = 0,
      input_json = null, input_hash = null, lease_token_hash = null, lease_expires_at = null,
      claimed_worker_id = null, claimed_device_id = null, error_code = null, policy_json = ?, available_at = ?, updated_at = ?
      where id = ? and status = 'failed' and exists (select 1 from briar_dm_memory_learning_retries
        where request_id = ? and operation_id = ? and job_id = briar_dm_memory_jobs.id)`)
      .bind(dmMemoryCanonicalJson(policy), now, now, jobId, input.requestId, operationId),
  ]);
  if (inserted.results.length !== 1) throw new HttpError(409, "Memory retry is blocked by scope, active work or budget", "memory_retry_blocked");
  return { accepted: true, replayed: false };
}
