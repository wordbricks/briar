import type { DmMemoryReference } from "../../../src/lib/dm-memory-query-contract";
import { vaultRecordHandle } from "./handles";

/**
 * Citations of vault records on channel replies (spec §8). The agent cites
 * `{documentId: <record id>, version: <revision>}`; completion keeps the ones
 * this claim read at the record's current, undeleted revision and stores them
 * beside the reply message. The app reads them back as ordinary memory
 * citations whose `documentId` is the record's handle (`handles.ts`).
 */
export type MemoryVaultCitationInput = { readonly documentId: string; readonly version: number };
export type AcceptedMemoryVaultCitation = { readonly vaultId: string; readonly recordId: string; readonly revision: number };

/** The citations this claim may make, deduplicated, with the vault each belongs to. */
export async function acceptMemoryVaultCitations(db: D1Database, input: {
  readonly claimTokenHash: string;
  readonly citations: readonly MemoryVaultCitationInput[];
}) {
  const accepted: AcceptedMemoryVaultCitation[] = [];
  const rejected: MemoryVaultCitationInput[] = [];
  const seen = new Set<string>();
  for (const citation of input.citations) {
    const key = `${citation.documentId}@${citation.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = await db.prepare(`select claim_read.vault_id from briar_memory_vault_claim_reads claim_read
      join briar_memory_vault_records record on record.vault_id = claim_read.vault_id
        and record.record_id = claim_read.record_id
      where claim_read.claim_token_hash = ? and claim_read.record_id = ? and claim_read.revision = ?
        and record.revision = claim_read.revision and record.deleted_at is null
      limit 1`)
      .bind(input.claimTokenHash, citation.documentId, citation.version).first<{ vault_id: string }>();
    if (row) accepted.push({ vaultId: row.vault_id, recordId: citation.documentId, revision: citation.version });
    else rejected.push(citation);
  }
  return { accepted, rejected };
}

/** Runs inside the completion batch: lands only with the reply message it cites. */
export function memoryVaultCitationStatement(db: D1Database, input: {
  readonly jobId: string;
  readonly claimTokenHash: string;
  readonly messageId: string;
  readonly completedAt: string;
  readonly citations: readonly AcceptedMemoryVaultCitation[];
}) {
  return db.prepare(`insert into briar_memory_vault_reply_citations
      (message_id, vault_id, record_id, revision, created_at)
    select ?, json_extract(cited.value, '$.vaultId'), json_extract(cited.value, '$.recordId'),
      json_extract(cited.value, '$.revision'), ?
    from json_each(?) cited
    where exists (select 1 from briar_memory_vaults vault where vault.id = json_extract(cited.value, '$.vaultId'))
      and exists (
        select 1 from briar_channel_agent_reply_jobs job where job.id = ? and job.claim_token_hash = ?
          and job.status = 'completed' and job.completed_at = ? and job.reply_message_id = ?
      )
    on conflict do nothing`)
    .bind(input.messageId, input.completedAt, JSON.stringify(input.citations), input.jobId, input.claimTokenHash,
      input.completedAt, input.messageId);
}

/**
 * Vault citations the app may show, keyed by message. Only DM vaults: their
 * owner can open the record from the DM memory dialog, and the same live
 * roster rule as the DM memory dialog hides them once the DM changes hands. A
 * forgotten record's citations are deleted with it; the `deleted_at` check
 * covers the moment in between.
 */
export async function readMemoryVaultCitations(db: D1Database, messageIds: readonly string[]) {
  const references = new Map<string, DmMemoryReference[]>();
  if (messageIds.length === 0) return references;
  const rows = (await db.prepare(`select citation.message_id, citation.vault_id, citation.record_id, citation.revision
    from briar_memory_vault_reply_citations citation
    join briar_memory_vaults vault on vault.id = citation.vault_id and vault.scope_kind = 'dm'
    join briar_memory_vault_records record on record.vault_id = citation.vault_id
      and record.record_id = citation.record_id and record.deleted_at is null
    join briar_dm_memory_spaces space on space.id = vault.dm_space_id and space.status = 'active'
    join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
      and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
      and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
    where citation.message_id in (select value from json_each(?))
    order by citation.message_id, citation.record_id, citation.revision`)
    .bind(JSON.stringify(messageIds))
    .all<{ message_id: string; vault_id: string; record_id: string; revision: number }>()).results;
  for (const row of rows) {
    const values = references.get(row.message_id) ?? [];
    values.push({ documentId: await vaultRecordHandle(row.vault_id, row.record_id), version: row.revision });
    references.set(row.message_id, values);
  }
  return references;
}
