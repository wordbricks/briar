import type { InboxMessage } from "./model";

/*
  Where the inbox has always been stored: one JSON record per account under
  `briar.inbox.v1:<userId>`.

  The key and the shape are the ones `hooks/useInbox.ts` wrote, so an app that
  upgrades into this module finds yesterday's inbox — both halves of it. The
  messages are a cache of the feed, and the read versions are the account's own
  answer to "what have I seen", which is why they survive a message leaving the
  feed: another device may still be showing it.

  Nothing here is in the IndexedDB `ClientSnapshot`. That record is one
  organization's server data and is discarded when the account or the schema
  changes; these read versions belong to the account and are pushed to the
  server rather than rebuilt from it.
*/

/** The prefix the inbox record has been written under since the feature shipped. */
export const INBOX_STORAGE_PREFIX = "briar.inbox.v1";

/** The record for one account. A signed-out window has one of its own. */
export function inboxStorageKey(userId: string | null): string {
  return `${INBOX_STORAGE_PREFIX}:${userId ?? "signed-out"}`;
}

/** One account's stored inbox: the cached feed and what it has read. */
export type InboxStorage = {
  messages: InboxMessage[];
  readVersions: Record<string, string>;
};

/** The stored inbox plus the key it came from, so a stale write is detectable. */
export type InboxState = InboxStorage & {
  storageKey: string;
};

export const emptyInboxStorage = (): InboxStorage => ({
  messages: [],
  readVersions: {},
});

/**
 * Reads one account's record. Anything unreadable — absent, malformed, a
 * storage the browser refuses to hand out — reads as an empty inbox rather than
 * throwing: the feed refills it on the next response.
 */
export function readInboxStorage(storageKey: string): InboxStorage {
  if (typeof window === "undefined") return emptyInboxStorage();
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    const messages = (Array.isArray(value.messages)
      ? value.messages.filter(
          (message: unknown) =>
            Boolean(message) &&
            typeof message === "object" &&
            typeof (message as { id?: unknown }).id === "string",
        )
      : []) as InboxMessage[];
    const readVersions: Record<string, string> =
      value.readVersions &&
        typeof value.readVersions === "object" &&
        !Array.isArray(value.readVersions)
        ? { ...value.readVersions }
        : {};

    return {
      messages,
      readVersions,
    };
  } catch {
    return emptyInboxStorage();
  }
}

export function writeInboxStorage(storageKey: string, storage: InboxStorage) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(storage));
  } catch {
    // Inbox remains available in memory when local storage is unavailable.
  }
}

/** The record for `storageKey`, tagged with the key it was read from. */
export function readInboxState(storageKey: string): InboxState {
  return { storageKey, ...readInboxStorage(storageKey) };
}
