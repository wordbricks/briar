import { sha256 } from "../crypto-digest";

/**
 * The id a vault record carries outside the vault: in `DmMemoryService`
 * documents and in the citations of a channel message.
 *
 * Inside the vault a record is addressed by its id (`release-process`), and the
 * agent cites it that way (spec §8). The app surfaces predate the vault and
 * shipped iOS builds decode a citation's `documentId` as a UUID, rejecting the
 * whole message otherwise (`ChannelConnect.swift`), so the app sees a stable
 * UUID derived from the vault and record instead. It is deterministic — the
 * same record always has the same handle — and carries nothing but a hash.
 * A forgotten and re-created record gets the same handle again, which is fine:
 * the handle names the slot, the revision names the content.
 */
export async function vaultRecordHandle(vaultId: string, recordId: string) {
  const hex = (await sha256(`briar-memory-vault-record:${vaultId}:${recordId}`)).slice(0, 32);
  // RFC 9562 version 8 (custom) with the RFC variant bits.
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Handles of the given records, for resolving one back to its record without a lookup table. */
export async function vaultRecordHandles(vaultId: string, recordIds: readonly string[]) {
  const entries = await Promise.all(recordIds.map(async (recordId) =>
    [await vaultRecordHandle(vaultId, recordId), recordId] as const));
  return new Map(entries);
}
