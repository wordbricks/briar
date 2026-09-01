import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
import * as Schema from "effect/Schema";
import { DmLearningSnapshot, type ClaimedDmMemory, type DmLearningPolicy, type DmLearningUsage } from "../../src/lib/dm-memory-learning-contract";
import { sha256 } from "./crypto-digest";
import { expireDmMemories } from "./dm-memory-access";
import { captureDmLearningInput, dmLearningInputsCurrentSql, dmLearningLiveSpaceSql,
  type DmLearningJobRow, type DmLearningSpaceRow } from "./dm-memory-learning-input";
import { scheduleDmLearningJobs } from "./dm-memory-learning-queue";
import { reapDmLearningClaims } from "./dm-memory-learning-maintenance";
import { DmLearningError } from "./dm-memory-learning-validation";
import { executionWorkerBindingById, executionWorkerDeviceSessionBindings, executionWorkerRuntime,
  executionWorkerDeviceSessionsQuery, workerStateAt } from "./workers";

export type DmLearningClaimIdentity = { organizationId: string; workerId: string; deviceId: string; claimTokenHash: string; jobId: string };
export const dmLearningWorkerCurrentSql = `exists (
  select 1 from briar_execution_workers worker join briar_execution_worker_devices device on device.id = worker.device_id
  join briar_project_agents agent on agent.id = space.agent_id and agent.organization_id = space.organization_id
  where worker.id = job.claimed_worker_id and worker.device_id = job.claimed_device_id
    and device.organization_id = space.organization_id and device.state <> 'disabled' and worker.state <> 'disabled'
    and worker.accepting_work = 1 and worker.readiness_state <> 'needs_attention'
    and julianday(worker.last_heartbeat_at) >= julianday(?) - (3.0 / 1440)
    and (agent.project_id is null or agent.project_id = worker.project_id)
    and (agent.project_id is null or not exists (select 1 from briar_project_execution_worker_policies policy
      where policy.project_id = agent.project_id and policy.selection_mode <> 'any')
      or exists (select 1 from briar_project_execution_worker_allowlist allowed
        where allowed.project_id = agent.project_id and allowed.worker_id = worker.id))
    and json_valid(worker.runtime_proto_json)
    and json_extract(worker.runtime_proto_json, '$.capabilities.dmMemoryProtocol') = 1
    and json_type(worker.runtime_proto_json, '$.capabilities.dmMemoryProtocol') = 'integer'
    and json_extract(worker.runtime_proto_json, '$.capabilities.dmMemoryLearning.protocol') = 1
    and json_type(worker.runtime_proto_json, '$.capabilities.dmMemoryLearning.protocol') = 'integer'
    and json_extract(worker.runtime_proto_json, '$.capabilities.dmMemoryLearning.transport') = 'openrouter')`;

export const dmLearningClaimCurrentSql = `job.status = 'running' and job.lease_expires_at > ?
  and job.kind in ('extract', 'explicit_request', 'consolidate')
  and job.revocation_epoch = space.revocation_epoch and ${dmLearningLiveSpaceSql}
  and (job.kind = 'explicit_request' or (space.use_enabled = 1 and space.auto_enabled = 1))
  and ${dmLearningWorkerCurrentSql}`;

export async function requireDmLearningClaim(db: D1Database, identity: DmLearningClaimIdentity, policy: DmLearningPolicy, now: string) {
  await expireDmMemories(db, now);
  const row = await db.prepare(`select job.* from briar_dm_memory_jobs job
    join briar_dm_memory_spaces space on space.id = job.space_id
    where job.id = ? and job.claimed_worker_id = ? and job.claimed_device_id = ? and job.lease_token_hash = ?
      and space.organization_id = ? and ${dmLearningClaimCurrentSql}
      and job.expected_memory_revision = space.memory_revision and job.policy_json = ?
      and job.input_json is not null and job.input_hash is not null and ${dmLearningInputsCurrentSql}`)
    .bind(identity.jobId, identity.workerId, identity.deviceId, identity.claimTokenHash, identity.organizationId,
      now, now, dmMemoryCanonicalJson(policy)).first<DmLearningJobRow>();
  if (!row) {
    const stillAuthorized = await db.prepare(`select 1 from briar_dm_memory_jobs job
      join briar_dm_memory_spaces space on space.id = job.space_id
      where job.id = ? and job.claimed_worker_id = ? and job.claimed_device_id = ? and job.lease_token_hash = ?
        and space.organization_id = ? and ${dmLearningClaimCurrentSql}`)
      .bind(identity.jobId, identity.workerId, identity.deviceId, identity.claimTokenHash, identity.organizationId, now, now).first();
    throw new DmLearningError(stillAuthorized ? "stale" : "scope_revoked");
  }
  const snapshot = Schema.decodeUnknownSync(DmLearningSnapshot)(JSON.parse(row.input_json!));
  if (await sha256(dmMemoryCanonicalJson(snapshot)) !== row.input_hash) throw new DmLearningError("stale");
  return { job: row, snapshot };
}

export async function failDmLearningClaim(db: D1Database, identity: DmLearningClaimIdentity,
  code: DmLearningError["code"], now: string, accounting?: { callId: string; usage: DmLearningUsage }, random = Math.random) {
  const transient = code === "stale" || code === "model_timeout" || code === "model_unavailable";
  const row = await db.prepare(`select job.attempt, job.calls_used from briar_dm_memory_jobs job
    join briar_dm_memory_spaces space on space.id = job.space_id
    where job.id = ? and job.status = 'running' and job.lease_token_hash = ?
      and job.claimed_worker_id = ? and job.claimed_device_id = ? and space.organization_id = ?`)
    .bind(identity.jobId, identity.claimTokenHash, identity.workerId, identity.deviceId, identity.organizationId)
    .first<{ attempt: number; calls_used: number }>();
  if (!row) return false;
  const retry = transient && row.attempt < 3 && row.calls_used < 6;
  const availableAt = new Date(Date.parse(now) + (retry ? (2 ** row.attempt * 5000 + Math.floor(random() * 2000)) : 0)).toISOString();
  await db.batch([
    ...(accounting ? [db.prepare(`update briar_dm_memory_model_calls set input_tokens = ?, output_tokens = ?, cost_micro_usd = ?
      where id = ? and job_id = ? and claim_token_hash = ? and status = 'reserved'
        and exists (select 1 from briar_dm_memory_jobs job where job.id = job_id and job.status = 'running' and job.lease_token_hash = ?)`)
      .bind(accounting.usage.inputTokens, accounting.usage.outputTokens, accounting.usage.costMicroUsd,
        accounting.callId, identity.jobId, identity.claimTokenHash, identity.claimTokenHash)] : []),
    db.prepare(`update briar_dm_memory_jobs set status = ?, error_code = ?, input_json = null, input_hash = null,
      lease_token_hash = null, lease_expires_at = null, available_at = ?, updated_at = ?
      where id = ? and status = 'running' and lease_token_hash = ?`)
      .bind(retry ? "retry_wait" : "failed", code, availableAt, now, identity.jobId, identity.claimTokenHash),
    db.prepare(`update briar_dm_memory_proposals set proposal_json = null, normalized_json = null,
      status = case when ? = 'stale' then 'stale' else 'rejected' end, terminal_at = ?
      where job_id = ? and status = 'proposed' and id in (select id from briar_dm_memory_model_calls where claim_token_hash = ?)
        and exists (select 1 from briar_dm_memory_jobs job where job.id = ? and job.error_code = ? and job.updated_at = ?)`)
      .bind(code, now, identity.jobId, identity.claimTokenHash, identity.jobId, code, now),
    db.prepare(`update briar_dm_memory_model_calls set status = 'failed', error_code = ?, completed_at = ?
      where job_id = ? and claim_token_hash = ? and status = 'reserved'`)
      .bind(code, now, identity.jobId, identity.claimTokenHash),
  ]);
  return true;
}

export async function renewDmLearningClaim(
  db: D1Database,
  input: {
    identity: DmLearningClaimIdentity;
    policy: DmLearningPolicy;
    inputHash: string;
    now: string;
  },
) {
  const { job } = await requireDmLearningClaim(
    db,
    input.identity,
    input.policy,
    input.now,
  );
  if (job.input_hash !== input.inputHash) throw new DmLearningError("stale");
  const leaseExpiresAt = new Date(Date.parse(input.now) + 5 * 60_000).toISOString();
  const renewed = await db.prepare(`update briar_dm_memory_jobs as job set lease_expires_at = ?, updated_at = ?
    where job.id = ? and job.lease_token_hash = ? and job.input_hash = ? and job.policy_json = ?
      and exists (select 1 from briar_dm_memory_spaces space where space.id = job.space_id
        and job.expected_memory_revision = space.memory_revision and ${dmLearningClaimCurrentSql}
        and ${dmLearningInputsCurrentSql}) returning id`)
    .bind(
      leaseExpiresAt,
      input.now,
      input.identity.jobId,
      input.identity.claimTokenHash,
      input.inputHash,
      dmMemoryCanonicalJson(input.policy),
      input.now,
      input.now,
    ).first();
  if (!renewed) throw new DmLearningError("stale");
  return leaseExpiresAt;
}

export async function claimDmLearningJob(db: D1Database, input: {
  organizationId: string; deviceId: string; workerId: string; projectId: string; policy: DmLearningPolicy; now: string;
}): Promise<ClaimedDmMemory | null> {
  const worker = await executionWorkerBindingById(db, input.deviceId, input.workerId);
  const capabilities = worker === null ? undefined : executionWorkerRuntime(worker).proto.capabilities;
  if (!worker || worker.project_id !== input.projectId || capabilities?.dmMemoryProtocol !== 1 ||
    capabilities.dmMemoryLearning?.protocol !== 1 || capabilities.dmMemoryLearning.transport !== "openrouter" ||
    workerStateAt(worker.last_heartbeat_at, input.now, worker.state) !== "online" || worker.accepting_work !== 1 ||
    worker.readiness_state === "needs_attention") return null;
  await scheduleDmLearningJobs(db, input.organizationId, input.policy, input.now);
  await reapDmLearningClaims(db, input.now, input.organizationId);
  const claimToken = `briar_memory_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const claimTokenHash = await sha256(claimToken);
  const leaseExpiresAt = new Date(Date.parse(input.now) + 5 * 60_000).toISOString();
  const result = await db.prepare(`update briar_dm_memory_jobs as job set status = 'running', stage = 'proposing',
    attempt = attempt + 1, lease_token_hash = ?, lease_expires_at = ?, claimed_worker_id = ?, claimed_device_id = ?,
    expected_memory_revision = (select memory_revision from briar_dm_memory_spaces where id = job.space_id),
    updated_at = ?, error_code = null
    where job.id = (select candidate.id from briar_dm_memory_jobs candidate
      join briar_dm_memory_spaces space on space.id = candidate.space_id
      join briar_project_agents agent on agent.id = space.agent_id
      where candidate.kind in ('extract', 'explicit_request', 'consolidate')
        and candidate.status in ('pending', 'retry_wait') and candidate.available_at <= ?
        and candidate.attempt < 3 and candidate.calls_used < 6 and candidate.policy_json = ?
        and space.organization_id = ? and candidate.revocation_epoch = space.revocation_epoch
        and ${dmLearningLiveSpaceSql} and (agent.project_id is null or agent.project_id = ?)
        and (candidate.kind = 'explicit_request' or (space.use_enabled = 1 and space.auto_enabled = 1))
        and not exists (select 1 from briar_dm_memory_jobs active where active.space_id = candidate.space_id
          and active.kind in ('extract', 'explicit_request', 'consolidate') and active.status = 'running')
      order by case when candidate.kind = 'explicit_request' then 0 else 1 end, candidate.available_at, candidate.id limit 1)
      and exists (select 1 from briar_execution_workers worker join briar_execution_worker_devices device on device.id = worker.device_id
        where worker.id = ? and worker.device_id = ? and worker.state <> 'disabled' and device.state <> 'disabled'
          and device.organization_id = ? and worker.accepting_work = 1 and worker.readiness_state = 'ready'
          and (select count(*) from (${executionWorkerDeviceSessionsQuery()}) active_work) < device.max_concurrent_sessions)
    returning *`)
    .bind(claimTokenHash, leaseExpiresAt, input.workerId, input.deviceId, input.now, input.now, dmMemoryCanonicalJson(input.policy),
      input.organizationId, input.projectId, input.workerId, input.deviceId, input.organizationId,
      ...executionWorkerDeviceSessionBindings(input.deviceId, input.now)).all<DmLearningJobRow>();
  const claimed = result.results[0];
  if (!claimed) return null;
  const identity = { organizationId: input.organizationId, deviceId: input.deviceId, workerId: input.workerId,
    claimTokenHash, jobId: claimed.id };
  try {
    const space = (await db.prepare("select * from briar_dm_memory_spaces where id = ?")
      .bind(claimed.space_id).first<DmLearningSpaceRow>())!;
    const snapshot = await captureDmLearningInput(db, claimed, space, input.policy, input.now);
    const inputHash = await sha256(dmMemoryCanonicalJson(snapshot));
    const [prepared] = await db.batch([
      db.prepare(`update briar_dm_memory_jobs as job set input_json = ?, input_hash = ?, source_end = ?,
        expected_memory_revision = ? where job.id = ? and job.lease_token_hash = ?
          and exists (select 1 from briar_dm_memory_spaces space where space.id = job.space_id
            and space.memory_revision = ? and ${dmLearningClaimCurrentSql}) returning id`)
        .bind(JSON.stringify(snapshot), inputHash, snapshot.sourceEnd, snapshot.memoryRevision, claimed.id, claimTokenHash,
          snapshot.memoryRevision, input.now, input.now),
      db.prepare(`delete from briar_dm_memory_learning_inputs where job_id = ? and exists (
        select 1 from briar_dm_memory_jobs where id = ? and input_hash = ? and lease_token_hash = ?)`)
        .bind(claimed.id, claimed.id, inputHash, claimTokenHash),
      db.prepare(`insert into briar_dm_memory_learning_inputs(job_id, space_id, source_type, source_id, source_version, source_hash)
        select job.id, job.space_id, json_extract(root.value, '$.type'), json_extract(root.value, '$.id'),
          json_extract(root.value, '$.version'), json_extract(root.value, '$.hash')
        from briar_dm_memory_jobs job, json_each(?) root where job.id = ? and job.input_hash = ? and job.lease_token_hash = ?`)
        .bind(JSON.stringify(snapshot.roots), claimed.id, inputHash, claimTokenHash),
      db.prepare(`update briar_dm_memory_learning_state set last_consolidation_started_at = ?, updated_at = ?
        where space_id = ? and exists (select 1 from briar_dm_memory_jobs where id = ? and kind = 'consolidate'
          and input_hash = ? and lease_token_hash = ?)`)
        .bind(input.now, input.now, claimed.space_id, claimed.id, inputHash, claimTokenHash),
    ]);
    if (prepared.results.length !== 1) throw new DmLearningError("stale");
    await requireDmLearningClaim(db, identity, input.policy, input.now);
    return { workType: "dmMemory", workId: claimed.id, runId: claimed.id, organizationId: input.organizationId,
      workerId: input.workerId, sourceKey: "dm-memory", title: "DM memory learning", claimToken,
      claimedAt: input.now, leaseExpiresAt, inputHash, snapshot };
  } catch (error) {
    await failDmLearningClaim(db, identity, error instanceof DmLearningError ? error.code : "model_unavailable", input.now);
    return null;
  }
}
