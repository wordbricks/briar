import type { DmMemoryReference } from "../../src/lib/dm-memory-query-contract";

/** Evaluated inside the transaction that publishes the reply. One JSON binding. */
export const dmMemoryCitationsCurrent = (job: string) => `not exists (
  select 1 from json_each(?) requested where not exists (
    select 1 from briar_dm_memory_discovered_refs discovered
    join briar_dm_memory_documents doc on doc.id = discovered.document_id
    join briar_dm_memory_reply_fences fence on fence.job_id = discovered.job_id
      and fence.claim_token_hash = discovered.claim_token_hash
    join briar_dm_memory_spaces space on space.id = doc.space_id
    join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version
    where discovered.job_id = ${job}.id and discovered.claim_token_hash = ${job}.claim_token_hash
      and discovered.document_id = json_extract(requested.value, '$.documentId')
      and discovered.version = json_extract(requested.value, '$.version')
      and doc.current_version = discovered.version and doc.status = 'active'
      and doc.expired_version <> doc.current_version and doc.space_id = fence.space_id
      and fence.protocol = 1 and space.use_enabled = 1 and space.status = 'active'
      and space.revocation_epoch = fence.revocation_epoch
      and (rev.valid_until is null or julianday(rev.valid_until) > julianday('now'))
  )
)`;

export function dmMemoryCitationStatement(db: D1Database, input: {
  jobId: string; claimTokenHash: string; messageId: string; completedAt: string;
  references: readonly DmMemoryReference[];
}) {
  return db.prepare(`insert into briar_dm_memory_reply_citations (message_id, document_id, version)
    select ?, json_extract(ref.value, '$.documentId'), json_extract(ref.value, '$.version')
    from json_each(?) ref where exists (
      select 1 from briar_channel_agent_reply_jobs job where job.id = ? and job.claim_token_hash = ?
        and job.status = 'completed' and job.completed_at = ? and job.reply_message_id = ?
    ) on conflict do nothing`).bind(input.messageId, JSON.stringify(input.references), input.jobId,
      input.claimTokenHash, input.completedAt, input.messageId);
}

/** No body/title copies. A changed roster hides the references from new members. */
export async function readDmMemoryCitations(db: D1Database, messageIds: string[]) {
  const rows = await db.prepare(`select citation.message_id, citation.document_id, citation.version
    from briar_dm_memory_reply_citations citation
    join briar_dm_memory_documents doc on doc.id = citation.document_id and doc.status <> 'deleted'
    join briar_dm_memory_spaces space on space.id = doc.space_id and space.status = 'active'
    join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
      and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
      and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
    where citation.message_id in (select value from json_each(?))
    order by citation.message_id, citation.document_id, citation.version`)
    .bind(JSON.stringify(messageIds)).all<{ message_id: string; document_id: string; version: number }>();
  const references = new Map<string, DmMemoryReference[]>();
  for (const row of rows.results) {
    const values = references.get(row.message_id) ?? [];
    values.push({ documentId: row.document_id, version: row.version });
    references.set(row.message_id, values);
  }
  return references;
}
