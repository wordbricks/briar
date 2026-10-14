/**
 * A memory citation on a channel message: `documentId` is a vault record's
 * handle (a UUID, `worker/src/memory-vault/handles.ts`) and `version` the
 * record revision the reply read (docs/plans/memory-vault-spec.md §8).
 */
export type DmMemoryReference = { documentId: string; version: number };
