import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
import * as Schema from "effect/Schema";
import { DmLearningChange, DmLearningProposal, type DmLearningInvocation,
  type DmLearningUsage, type DmLearningVerification } from "../../src/lib/dm-memory-learning-contract";
import { sha256 } from "./crypto-digest";
import { dmLearningClaimCurrentSql, failDmLearningClaim, requireDmLearningClaim, type DmLearningClaimIdentity } from "./dm-memory-learning-claims";
import { dmLearningCommitStatements } from "./dm-memory-learning-commit";
import { dmLearningInputsCurrentSql } from "./dm-memory-learning-input";
import { dmLearningCallReservation } from "./dm-memory-learning-policy";
import { replayDmLearningCommit } from "./dm-memory-learning-replay";
import { DmLearningError, normalizeDmLearningProposal, requireDmLearningVerification,
  type NormalizedDmLearningChange } from "./dm-memory-learning-validation";

const normalizedSchema = Schema.Array(Schema.Struct({
  change: DmLearningChange, documentId: Schema.String, version: Schema.Int, body: Schema.String,
  protectedByUser: Schema.Boolean, replacementId: Schema.NullOr(Schema.String), replacementVersion: Schema.NullOr(Schema.Int),
  roots: Schema.Array(Schema.Struct({ itemId: Schema.String, source: Schema.Struct({ type: Schema.Literals(["message", "user_edit_event"]),
    id: Schema.String, version: Schema.Int, hash: Schema.String }) })),
}));
type ProposalRow = { id: string; input_hash: string; proposal_hash: string; proposal_json: string | null;
  normalized_json: string | null; status: string };
type CallRow = { id: string; stage: "proposing" | "verifying"; input_hash: string; proposal_hash: string | null;
  status: "reserved" | "completed" | "failed" };

async function requireReservedCall(db: D1Database, identity: DmLearningClaimIdentity, callId: string,
  stage: "proposing" | "verifying", inputHash: string, proposalHash: string | null = null) {
  const call = await db.prepare(`select 1 from briar_dm_memory_model_calls where id = ? and job_id = ?
    and claim_token_hash = ? and status = 'reserved' and stage = ? and input_hash = ? and proposal_hash is ?`)
    .bind(callId, identity.jobId, identity.claimTokenHash, stage, inputHash, proposalHash).first();
  if (!call) throw new DmLearningError("stale");
}

async function readProposal(db: D1Database, jobId: string, inputHash: string) {
  const row = await db.prepare(`select * from briar_dm_memory_proposals
    where job_id = ? and input_hash = ? and status = 'proposed' order by created_at desc, id desc limit 1`)
    .bind(jobId, inputHash).first<ProposalRow>();
  if (!row?.proposal_json || !row.normalized_json) throw new DmLearningError("stale");
  const proposal = Schema.decodeUnknownSync(DmLearningProposal)(JSON.parse(row.proposal_json));
  const normalized = Schema.decodeUnknownSync(normalizedSchema)(JSON.parse(row.normalized_json));
  if (await sha256(dmMemoryCanonicalJson({ proposal, normalized })) !== row.proposal_hash) throw new DmLearningError("stale");
  return { row, proposal, normalized };
}

export async function reserveDmLearningModelCall(db: D1Database, input: {
  identity: DmLearningClaimIdentity; callId: string;
  stage: "proposing" | "verifying"; inputHash: string; now: string;
}): Promise<DmLearningInvocation> {
  const { identity, now } = input;
  const { job, snapshot, policy } = await requireDmLearningClaim(db, identity, now);
  if (job.input_hash !== input.inputHash || job.stage !== input.stage) throw new DmLearningError("stale");
  const current = input.stage === "verifying" ? await readProposal(db, job.id, input.inputHash) : null;
  const model = input.stage === "proposing" ? policy.proposer : policy.verifier;
  const reserved = dmLearningCallReservation(model, JSON.stringify({ snapshot, ...(current ? { proposal: current.proposal } : {}) }), input.stage);
  if (!reserved) throw new DmLearningError("model_configuration");
  const day = `${now.slice(0, 10)}T00:00:00.000Z`;
  await db.batch([
    db.prepare(`insert into briar_dm_memory_model_calls
      (id, job_id, space_id, organization_id, claim_token_hash, stage, input_hash, proposal_hash, model_json, reserved_micro_usd, created_at)
      select ?, job.id, space.id, space.organization_id, ?, ?, ?, ?, ?, ?, ?
      from briar_dm_memory_jobs job join briar_dm_memory_spaces space on space.id = job.space_id
      where job.id = ? and job.lease_token_hash = ? and job.claimed_worker_id = ? and job.claimed_device_id = ?
        and space.organization_id = ? and ${dmLearningClaimCurrentSql} and ${dmLearningInputsCurrentSql}
        and job.expected_memory_revision = space.memory_revision and job.input_hash = ? and job.policy_json = ?
        and job.stage = ? and job.calls_used < 6
        and (? = 'proposing' or exists (select 1 from briar_dm_memory_proposals proposal where proposal.id = ?
          and proposal.job_id = job.id and proposal.input_hash = job.input_hash and proposal.proposal_hash = ? and proposal.status = 'proposed'))
        and (select count(*) from briar_dm_memory_model_calls where space_id = space.id and created_at >= ?) < ?
        and (select count(*) from briar_dm_memory_model_calls where organization_id = space.organization_id and created_at >= ?) < ?
        and coalesce((select sum(max(reserved_micro_usd, coalesce(cost_micro_usd, 0))) from briar_dm_memory_model_calls where space_id = space.id and created_at >= ?), 0) + ? <= ?
        and coalesce((select sum(max(reserved_micro_usd, coalesce(cost_micro_usd, 0))) from briar_dm_memory_model_calls where organization_id = space.organization_id and created_at >= ?), 0) + ? <= ?
      on conflict (id) do nothing`)
      .bind(input.callId, identity.claimTokenHash, input.stage, input.inputHash, current?.row.proposal_hash ?? null,
        JSON.stringify(model), reserved.reservedMicroUsd, now, identity.jobId, identity.claimTokenHash, identity.workerId,
        identity.deviceId, identity.organizationId, now, now, input.inputHash, dmMemoryCanonicalJson(snapshot.policy), input.stage,
        input.stage, current?.row.id ?? null, current?.row.proposal_hash ?? null,
        day, policy.spaceDailyCalls, day, policy.organizationDailyCalls,
        day, reserved.reservedMicroUsd, policy.spaceDailyMicroUsd, day, reserved.reservedMicroUsd, policy.organizationDailyMicroUsd),
    db.prepare(`update briar_dm_memory_jobs set calls_used = calls_used + 1 where id = ? and lease_token_hash = ?
      and exists (select 1 from briar_dm_memory_model_calls call where call.id = ? and call.job_id = briar_dm_memory_jobs.id
        and call.claim_token_hash = ? and call.budget_applied = 0)`)
      .bind(identity.jobId, identity.claimTokenHash, input.callId, identity.claimTokenHash),
    db.prepare(`update briar_dm_memory_model_calls set budget_applied = 1 where id = ? and job_id = ? and claim_token_hash = ?`)
      .bind(input.callId, identity.jobId, identity.claimTokenHash),
  ]);
  await requireDmLearningClaim(db, identity, now);
  const call = await db.prepare(`select * from briar_dm_memory_model_calls where id = ? and job_id = ? and claim_token_hash = ?`)
    .bind(input.callId, identity.jobId, identity.claimTokenHash).first<CallRow>();
  if (!call) throw new DmLearningError("budget_exhausted");
  if (call.stage !== input.stage || call.input_hash !== input.inputHash || call.proposal_hash !== (current?.row.proposal_hash ?? null)) {
    throw new DmLearningError("stale");
  }
  return { callId: call.id, stage: input.stage, inputHash: input.inputHash, proposalHash: call.proposal_hash,
    proposalId: current?.row.id ?? null, model, snapshot, proposal: current?.proposal ?? null, status: call.status };
}

const usageStatement = (db: D1Database, callId: string, usage: DmLearningUsage, now: string, gate: string, commitId: string) =>
  db.prepare(`update briar_dm_memory_model_calls set status = 'completed', input_tokens = ?, output_tokens = ?,
    cost_micro_usd = ?, completed_at = ? where id = ? and ${gate}`)
    .bind(usage.inputTokens, usage.outputTokens, usage.costMicroUsd, now, callId, commitId);

export async function submitDmLearningProposal(db: D1Database, input: {
  identity: DmLearningClaimIdentity; callId: string; inputHash: string;
  proposal: DmLearningProposal; usage: DmLearningUsage; now: string;
}) {
  const { identity, now } = input;
  const replayed = await replayDmLearningCommit(db, input);
  if (replayed) return replayed;
  const { job, snapshot } = await requireDmLearningClaim(db, identity, now);
  if (job.input_hash !== input.inputHash) throw new DmLearningError("stale");
  const existing = await db.prepare("select * from briar_dm_memory_proposals where id = ? and job_id = ?")
    .bind(input.callId, job.id).first<ProposalRow>();
  if (existing) {
    if (dmMemoryCanonicalJson(JSON.parse(existing.proposal_json ?? "null")) !== dmMemoryCanonicalJson(input.proposal) || existing.input_hash !== input.inputHash || existing.status !== "proposed") {
      throw new DmLearningError("stale");
    }
    return { status: "verifying" as const, proposalId: existing.id, proposalHash: existing.proposal_hash };
  }
  await requireReservedCall(db, identity, input.callId, "proposing", input.inputHash);
  let normalized: readonly NormalizedDmLearningChange[];
  try { normalized = normalizeDmLearningProposal(snapshot, input.proposal); }
  catch (error) {
    await db.prepare(`update briar_dm_memory_model_calls set input_tokens = ?, output_tokens = ?, cost_micro_usd = ?
      where id = ? and claim_token_hash = ? and status = 'reserved'`)
      .bind(input.usage.inputTokens, input.usage.outputTokens, input.usage.costMicroUsd, input.callId, identity.claimTokenHash).run();
    await failDmLearningClaim(db, identity, "invalid_proposal", now);
    throw error;
  }
  const proposalHash = await sha256(dmMemoryCanonicalJson({ proposal: input.proposal, normalized }));
  const noChange = normalized.length === 0;
  if (noChange) {
    const commit = await dmLearningCommitStatements(db, { ...input, snapshot, normalized, proposalId: input.callId, proposalHash });
    commit.statements.push(db.prepare(`insert into briar_dm_memory_proposals
      (id, job_id, space_id, input_hash, proposal_hash, proposal_json, normalized_json, status, created_at, terminal_at)
      select ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ? where ${commit.gate}`)
      .bind(input.callId, job.id, job.space_id, input.inputHash, proposalHash, JSON.stringify(input.proposal), JSON.stringify(normalized), now, now, commit.commitId));
    commit.statements.push(usageStatement(db, input.callId, input.usage, now, commit.gate, commit.commitId), commit.finish);
    await db.batch(commit.statements);
    const accepted = await db.prepare("select applied from briar_dm_memory_commits where id = ?").bind(commit.commitId).first<{ applied: number }>();
    if (!accepted?.applied) throw new DmLearningError("stale");
    return commit.result;
  }
  const result = await db.batch([
    db.prepare(`insert into briar_dm_memory_proposals(id, job_id, space_id, input_hash, proposal_hash, proposal_json, normalized_json, status, created_at)
      select ?, job.id, job.space_id, ?, ?, ?, ?, 'proposed', ? from briar_dm_memory_jobs job
      join briar_dm_memory_spaces space on space.id = job.space_id
      where job.id = ? and job.lease_token_hash = ? and job.stage = 'proposing' and ${dmLearningClaimCurrentSql}
        and ${dmLearningInputsCurrentSql} and job.expected_memory_revision = space.memory_revision
        and job.input_hash = ? and job.policy_json = ?
        and exists (select 1 from briar_dm_memory_model_calls call where call.id = ? and call.job_id = job.id
          and call.claim_token_hash = ? and call.stage = 'proposing' and call.input_hash = job.input_hash and call.status = 'reserved')
      on conflict (id) do nothing returning id`)
      .bind(input.callId, input.inputHash, proposalHash, JSON.stringify(input.proposal), JSON.stringify(normalized), now,
        job.id, identity.claimTokenHash, now, now, input.inputHash, dmMemoryCanonicalJson(snapshot.policy), input.callId, identity.claimTokenHash),
    db.prepare(`update briar_dm_memory_model_calls set status = 'completed', input_tokens = ?, output_tokens = ?, cost_micro_usd = ?, completed_at = ?
      where id = ? and claim_token_hash = ? and exists (select 1 from briar_dm_memory_proposals where id = ? and proposal_hash = ?)`)
      .bind(input.usage.inputTokens, input.usage.outputTokens, input.usage.costMicroUsd, now, input.callId, identity.claimTokenHash, input.callId, proposalHash),
    db.prepare(`update briar_dm_memory_jobs set stage = 'verifying', updated_at = ? where id = ? and lease_token_hash = ?
      and exists (select 1 from briar_dm_memory_proposals where id = ? and proposal_hash = ?)`)
      .bind(now, job.id, identity.claimTokenHash, input.callId, proposalHash),
  ]);
  if (result[0]!.results.length !== 1) throw new DmLearningError("stale");
  return { status: "verifying" as const, proposalId: input.callId, proposalHash };
}

export async function submitDmLearningVerification(db: D1Database, input: {
  identity: DmLearningClaimIdentity; callId: string; inputHash: string;
  proposalId: string; proposalHash: string; verification: DmLearningVerification; usage: DmLearningUsage; now: string;
}) {
  const replayed = await replayDmLearningCommit(db, input);
  if (replayed) return replayed;
  const { job, snapshot } = await requireDmLearningClaim(db, input.identity, input.now);
  const current = await readProposal(db, job.id, input.inputHash);
  if (job.input_hash !== input.inputHash || current.row.id !== input.proposalId || current.row.proposal_hash !== input.proposalHash) {
    throw new DmLearningError("stale");
  }
  await requireReservedCall(db, input.identity, input.callId, "verifying", input.inputHash, input.proposalHash);
  try { requireDmLearningVerification(snapshot, current.proposal, input.verification); }
  catch (error) {
    const rejectedGate = `exists (select 1 from briar_dm_memory_verifications where id = ? and approved = 0)`;
    await db.batch([
      db.prepare(`insert into briar_dm_memory_verifications
        (id, job_id, proposal_id, input_hash, proposal_hash, decisions_json, approved, request_authorized, error_code, created_at)
        select ?, job.id, ?, ?, ?, ?, 0, ?, 'verification_rejected', ?
        from briar_dm_memory_jobs job join briar_dm_memory_spaces space on space.id = job.space_id
        where job.id = ? and job.lease_token_hash = ? and ${dmLearningClaimCurrentSql} and ${dmLearningInputsCurrentSql}
          and job.input_hash = ? and job.expected_memory_revision = space.memory_revision
          and exists (select 1 from briar_dm_memory_model_calls call where call.id = ? and call.job_id = job.id
            and call.claim_token_hash = ? and call.status = 'reserved' and call.proposal_hash = ?)
        on conflict (id) do nothing`)
        .bind(input.callId, input.proposalId, input.inputHash, input.proposalHash, JSON.stringify(input.verification.decisions),
          Number(input.verification.explicitRequestAuthorized), input.now, job.id, input.identity.claimTokenHash, input.now, input.now,
          input.inputHash, input.callId, input.identity.claimTokenHash, input.proposalHash),
      usageStatement(db, input.callId, input.usage, input.now, rejectedGate, input.callId),
      db.prepare(`update briar_dm_memory_jobs set status = 'failed', error_code = 'verification_rejected',
        input_json = null, lease_token_hash = null, lease_expires_at = null, updated_at = ? where id = ? and ${rejectedGate}`)
        .bind(input.now, job.id, input.callId),
      db.prepare(`update briar_dm_memory_proposals set status = 'rejected', proposal_json = null, normalized_json = null,
        terminal_at = ? where id = ? and ${rejectedGate}`).bind(input.now, input.proposalId, input.callId),
    ]);
    const recorded = await db.prepare("select 1 from briar_dm_memory_verifications where id = ? and approved = 0")
      .bind(input.callId).first();
    if (!recorded) throw new DmLearningError("stale");
    throw error;
  }
  const commit = await dmLearningCommitStatements(db, { ...input, snapshot, proposal: current.proposal, normalized: current.normalized });
  commit.statements.push(db.prepare(`insert into briar_dm_memory_verifications
    (id, job_id, proposal_id, input_hash, proposal_hash, decisions_json, approved, request_authorized, created_at)
    select ?, ?, ?, ?, ?, ?, 1, ?, ? where ${commit.gate}`)
    .bind(input.callId, job.id, input.proposalId, input.inputHash, input.proposalHash, JSON.stringify(input.verification.decisions),
      Number(input.verification.explicitRequestAuthorized), input.now, commit.commitId));
  commit.statements.push(db.prepare(`update briar_dm_memory_proposals set status = 'applied', terminal_at = ?
    where id = ? and ${commit.gate}`).bind(input.now, input.proposalId, commit.commitId));
  commit.statements.push(usageStatement(db, input.callId, input.usage, input.now, commit.gate, commit.commitId), commit.finish);
  await db.batch(commit.statements);
  const accepted = await db.prepare("select applied from briar_dm_memory_commits where id = ?").bind(commit.commitId).first<{ applied: number }>();
  if (!accepted?.applied) throw new DmLearningError("stale");
  return commit.result;
}
