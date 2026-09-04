import * as Atom from "effect/unstable/reactivity/Atom";

import {
  inboxFeedIdentityAtom,
  inboxReadSyncIdentityAtom,
  inboxStateAtom,
  inboxStorageKeyAtom,
  inboxUserIdAtom,
} from "../state/inbox/atoms";
import type { InboxMessage } from "../state/inbox/model";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import type { AtomRegistry } from "../state/registry";
import { tokenAtom } from "../state/session/atoms";

/*
  Putting messages in a registry's inbox without running its transports.

  The stored record is what everything else is derived from, so a test that
  needs "the inbox has these two messages" writes it here rather than reaching
  for the atom the views read — that one is derived and has no setter. Marking
  both account responses as arrived is part of the seed: unread markers stay off
  until they have, which is a real rule and not one a test wants to rediscover.
*/

export interface SeedInboxOptions {
  /** Read versions to start from. Absent ids read as unread. */
  readonly readVersions?: Record<string, string> | undefined;
  /** Leave the account responses pending, so every message reads as read. */
  readonly initialSyncComplete?: boolean | undefined;
}

/** Writes `messages` into this registry's stored inbox record. */
export function seedInboxMessages(
  registry: AtomRegistry,
  messages: readonly InboxMessage[],
  options: SeedInboxOptions = {},
): void {
  const storageKey = registry.get(inboxStorageKeyAtom);
  const userId = registry.get(inboxUserIdAtom);
  const token = registry.get(tokenAtom);
  const organizationId = registry.get(activeOrganizationIdAtom);
  const settled = options.initialSyncComplete ?? true;
  Atom.batch(() => {
    registry.set(inboxStateAtom, {
      storageKey,
      messages: [...messages],
      readVersions: { ...options.readVersions },
    });
    if (settled && token && userId) {
      registry.set(inboxReadSyncIdentityAtom, { storageKey, token, userId });
      if (organizationId) {
        registry.set(inboxFeedIdentityAtom, {
          scope: `${userId}:${organizationId}`,
          token,
        });
      }
    }
  });
}

/** The message ids this registry's inbox has recorded a read version for. */
export function readInboxMessageIds(registry: AtomRegistry): string[] {
  return Object.keys(registry.get(inboxStateAtom).readVersions).sort();
}
