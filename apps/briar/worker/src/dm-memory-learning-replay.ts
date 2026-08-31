import * as Schema from "effect/Schema";
import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
import { DmLearningCommitResult, type DmLearningPolicy, type DmLearningProposal,
  type DmLearningVerification } from "../../src/lib/dm-memory-learning-contract";
import { dmLearningWorkerCurrentSql, type DmLearningClaimIdentity } from "./dm-memory-learning-claims";
import { dmLearningLiveSpaceSql } from "./dm-memory-learning-input";
import { DmLearningError } from "./dm-memory-learning-validation";

/** A lost acknowledgement can replay its own result, never another call's write. */
export async function replayDmLearningCommit(db: D1Database, input: {
  identity: DmLearningClaimIdentity; policy: DmLearningPolicy; callId: string; inputHash: string; now: string;
} & ({ proposal: DmLearningProposal } | { proposalId: string; proposalHash: string; verification: DmLearningVerification })) {
  const { identity } = input;
  const row = await db.prepare(`select applied.result_json, proposal.id as proposal_id,
      proposal.proposal_hash, proposal.proposal_json, verification.decisions_json,
      verification.approved, verification.request_authorized
    from briar_dm_memory_jobs job
    join briar_dm_memory_spaces space on space.id = job.space_id
    join briar_dm_memory_learning_commits applied on applied.job_id = job.id
    join briar_dm_memory_commits ledger on ledger.id = applied.commit_id and ledger.applied = 1
    join briar_dm_memory_model_calls call on call.id = ledger.request_id and call.job_id = job.id
    join briar_dm_memory_proposals proposal on proposal.job_id = job.id
      and proposal.proposal_hash = applied.proposal_hash and proposal.status = 'applied'
    left join briar_dm_memory_verifications verification on verification.id = call.id
    where job.id = ? and job.claimed_worker_id = ? and job.claimed_device_id = ?
      and job.lease_token_hash = ? and space.organization_id = ?
      and job.status in ('succeeded', 'no_change') and job.input_hash = ? and job.policy_json = ?
      and call.id = ? and call.claim_token_hash = job.lease_token_hash and call.status = 'completed'
      and call.stage = ? and call.input_hash = job.input_hash and ledger.payload_hash = proposal.proposal_hash
      and job.updated_at > ? and space.revocation_epoch = json_extract(applied.result_json, '$.revocationEpoch')
      and ${dmLearningLiveSpaceSql} and ${dmLearningWorkerCurrentSql}`)
    .bind(identity.jobId, identity.workerId, identity.deviceId, identity.claimTokenHash, identity.organizationId,
      input.inputHash, dmMemoryCanonicalJson(input.policy), input.callId, "proposal" in input ? "proposing" : "verifying",
      new Date(Date.parse(input.now) - 86_400_000).toISOString(), input.now)
    .first<{ result_json: string; proposal_id: string; proposal_hash: string; proposal_json: string | null;
      decisions_json: string | null; approved: number | null; request_authorized: number | null }>();
  if (!row) return null;
  if ("proposal" in input) {
    if (!row.proposal_json || dmMemoryCanonicalJson(JSON.parse(row.proposal_json)) !== dmMemoryCanonicalJson(input.proposal)) {
      throw new DmLearningError("stale");
    }
  } else if (row.proposal_id !== input.proposalId || row.proposal_hash !== input.proposalHash ||
    row.approved !== Number(input.verification.approved) || row.request_authorized !== Number(input.verification.explicitRequestAuthorized) ||
    !row.decisions_json || dmMemoryCanonicalJson(JSON.parse(row.decisions_json)) !== dmMemoryCanonicalJson(input.verification.decisions)) {
    throw new DmLearningError("stale");
  }
  return Schema.decodeUnknownSync(DmLearningCommitResult)(JSON.parse(row.result_json));
}
