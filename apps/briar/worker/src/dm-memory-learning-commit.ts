import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
import type { DmLearningCommitResult, DmLearningProposal, DmLearningSnapshot } from "../../src/lib/dm-memory-learning-contract";
import { sha256 } from "./crypto-digest";
import { dmLearningClaimCurrentSql, type DmLearningClaimIdentity } from "./dm-memory-learning-claims";
import { dmLearningInputsCurrentSql } from "./dm-memory-learning-input";
import type { NormalizedDmLearningChange } from "./dm-memory-learning-validation";

const commitGate = "exists (select 1 from briar_dm_memory_commits where id = ? and applied = 0)";

/** Every dependent write uses one ledger row admitted by the live CAS predicate. */
export async function dmLearningCommitStatements(db: D1Database, input: {
  identity: DmLearningClaimIdentity; snapshot: DmLearningSnapshot; inputHash: string;
  proposal: DmLearningProposal; proposalId: string; proposalHash: string;
  normalized: readonly NormalizedDmLearningChange[]; callId: string; now: string;
}) {
  const { identity, snapshot, normalized, now } = input;
  const commitId = crypto.randomUUID();
  const noChange = normalized.length === 0;
  const result: DmLearningCommitResult = { status: noChange ? "no_change" : "succeeded",
    revocationEpoch: snapshot.revocationEpoch + Number(normalized.some((item) => item.change.action !== "create")),
    documents: normalized.map((item) => ({ documentId: item.documentId,
      version: item.change.action === "supersede" ? item.change.expectedVersion! : item.version, action: item.change.action })) };
  const gateBindings = [identity.jobId, identity.workerId, identity.deviceId, identity.claimTokenHash, identity.organizationId,
    now, now, snapshot.memoryRevision, input.inputHash, dmMemoryCanonicalJson(snapshot.policy), input.callId,
    identity.claimTokenHash, input.inputHash, noChange ? "proposing" : "verifying"];
  const statements = [db.prepare(`insert into briar_dm_memory_commits
    (id, space_id, request_id, payload_hash, created_at)
    select ?, space.id, ?, ?, ? from briar_dm_memory_jobs job
    join briar_dm_memory_spaces space on space.id = job.space_id
    where job.id = ? and job.claimed_worker_id = ? and job.claimed_device_id = ? and job.lease_token_hash = ?
      and space.organization_id = ? and ${dmLearningClaimCurrentSql}
      and space.memory_revision = ? and job.input_hash = ? and job.policy_json = ? and ${dmLearningInputsCurrentSql}
      and exists (select 1 from briar_dm_memory_model_calls call where call.id = ? and call.job_id = job.id
        and call.claim_token_hash = ? and call.input_hash = ? and call.stage = ? and call.status = 'reserved')
      and not exists (select 1 from briar_dm_memory_learning_commits applied where applied.job_id = job.id)
      and (? = 1 or exists (select 1 from briar_dm_memory_proposals proposal where proposal.id = ?
        and proposal.job_id = job.id and proposal.input_hash = job.input_hash and proposal.proposal_hash = ? and proposal.status = 'proposed'))
      and (? = 1 or exists (select 1 from briar_dm_memory_model_calls call where call.id = ? and call.proposal_hash = ?))
      and not exists (select 1 from json_each(?) expected where not exists (
        select 1 from briar_dm_memory_documents doc join briar_dm_memory_revisions rev
          on rev.document_id = doc.id and rev.version = doc.current_version
        where doc.space_id = space.id and doc.id = json_extract(expected.value, '$.id')
          and doc.current_version = json_extract(expected.value, '$.version') and doc.status = 'active'
          and rev.body_hash = json_extract(expected.value, '$.hash')
          and rev.protected_by_user = json_extract(expected.value, '$.protectedByUser')))
      and (job.kind = 'explicit_request' or exists (select 1 from briar_dm_memory_learning_state state
        where state.space_id = space.id and case when job.kind = 'extract' then state.source_watermark else state.observation_watermark end = ?))
    on conflict (space_id, request_id) do nothing`)
    .bind(commitId, input.callId, input.proposalHash, now, ...gateBindings,
      Number(noChange), input.proposalId, input.proposalHash, Number(noChange), input.callId, input.proposalHash,
      JSON.stringify(snapshot.documents), snapshot.sourceStart)];
  for (const item of normalized) {
    const change = item.change;
    if (change.action === "supersede") {
      statements.push(db.prepare(`update briar_dm_memory_documents set status = 'superseded', superseded_by = ?, updated_at = ?
        where id = ? and ${commitGate}`).bind(item.replacementId, now, item.documentId, commitId));
      continue;
    }
    statements.push(change.action === "create"
      ? db.prepare(`insert into briar_dm_memory_documents(id, space_id, kind, title, current_version, conflicted, created_at, updated_at)
          select ?, ?, ?, ?, ?, ?, ?, ? where ${commitGate}`)
        .bind(item.documentId, snapshot.memorySpaceId, change.documentKind, change.title, item.version, Number(change.conflicted), now, now, commitId)
      : db.prepare(`update briar_dm_memory_documents set title = ?, current_version = ?, status = 'active',
          conflicted = ?, superseded_by = null, updated_at = ? where id = ? and ${commitGate}`)
        .bind(change.title, item.version, Number(change.conflicted), now, item.documentId, commitId));
    statements.push(db.prepare(`insert into briar_dm_memory_revisions
      (space_id, document_id, version, body, body_hash, memory_class, evidence_type, protected_by_user,
        source_language, observed_at, valid_until, origin, author_agent_id, policy_version, created_at)
      select space.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, space.agent_id, ?, ?
      from briar_dm_memory_spaces space where space.id = ? and ${commitGate}`)
      .bind(item.documentId, item.version, item.body, await sha256(item.body), change.memoryClass, change.evidenceType,
        Number(item.protectedByUser), change.sourceLanguage, change.observedAt, change.validUntil,
        snapshot.kind, snapshot.policy.version, now, snapshot.memorySpaceId, commitId));
    statements.push(db.prepare(`insert into briar_dm_memory_sources
      (space_id, document_id, document_version, item_id, source_type, source_id, source_version, source_hash)
      select ?, ?, ?, json_extract(root.value, '$.itemId'), json_extract(root.value, '$.source.type'),
        json_extract(root.value, '$.source.id'), json_extract(root.value, '$.source.version'), json_extract(root.value, '$.source.hash')
      from json_each(?) root where ${commitGate}`)
      .bind(snapshot.memorySpaceId, item.documentId, item.version, JSON.stringify(item.roots), commitId));
    const linked = change.sourceRefs.filter((ref) => ref.type === "memory" && ref.id !== item.documentId);
    statements.push(db.prepare(`insert into briar_dm_memory_document_links
      (document_id, document_version, source_document_id, source_document_version)
      select ?, ?, json_extract(ref.value, '$.id'), json_extract(ref.value, '$.version') from json_each(?) ref where ${commitGate}`)
      .bind(item.documentId, item.version, JSON.stringify(linked), commitId));
    statements.push(db.prepare(`insert into briar_dm_memory_jobs
      (id, space_id, kind, dedupe_key, document_id, document_version, expected_memory_revision, revocation_epoch,
        available_at, created_at, updated_at)
      select ?, ?, 'index', ?, ?, ?, ?, ?, ?, ?, ? where ${commitGate}`)
      .bind(crypto.randomUUID(), snapshot.memorySpaceId, `index:${item.documentId}:${item.version}`, item.documentId,
        item.version, snapshot.memoryRevision + 1, snapshot.revocationEpoch, now, now, now, commitId));
  }
  statements.push(db.prepare(`insert into briar_dm_memory_learning_commits(job_id, commit_id, proposal_hash, result_json)
    select ?, ?, ?, ? where ${commitGate}`)
    .bind(identity.jobId, commitId, input.proposalHash, JSON.stringify(result), commitId));
  statements.push(db.prepare(`update briar_dm_memory_jobs set status = ?, stage = 'committing', error_code = null,
    result_json = ?, updated_at = ? where id = ? and ${commitGate}`)
    .bind(result.status, JSON.stringify(result), now, identity.jobId, commitId));
  statements.push(db.prepare(`update briar_dm_memory_learning_state set
    source_watermark = case when ? = 'extract' then ? else source_watermark end,
    observation_watermark = case when ? = 'consolidate' then ? else observation_watermark end,
    last_consolidation_succeeded_at = case when ? = 'consolidate' then ? else last_consolidation_succeeded_at end,
    updated_at = ? where space_id = ? and ${commitGate}`)
    .bind(snapshot.kind, snapshot.sourceEnd, snapshot.kind, snapshot.sourceEnd, snapshot.kind, now,
      now, snapshot.memorySpaceId, commitId));
  statements.push(db.prepare(`update briar_dm_memory_learning_outbox set settled = 1 where space_id = ?
    and ((kind = 'extract' and ? = 'extract' and source_end <= ?)
      or (kind = 'explicit_request' and ? = 'explicit_request' and request_source_id = ?)) and ${commitGate}`)
    .bind(snapshot.memorySpaceId, snapshot.kind, snapshot.sourceEnd, snapshot.kind, snapshot.requestSource?.id ?? null, commitId));
  if (!noChange) statements.push(db.prepare(`update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + ?, use_enabled = case when ever_saved = 0 and ? = 'explicit_request' then 1 else use_enabled end,
    ever_saved = 1, updated_at = ? where id = ? and ${commitGate}`)
    .bind(Number(normalized.some((item) => item.change.action !== "create")), snapshot.kind, now, snapshot.memorySpaceId, commitId));
  // The caller records the proposal/verifier/usage with this same predicate,
  // then appends finish. Retaining the hash permits a lost-response replay.
  const finish = db.prepare("update briar_dm_memory_commits set applied = 1 where id = ? and applied = 0").bind(commitId);
  return { commitId, statements, finish, gate: commitGate, result };
}
