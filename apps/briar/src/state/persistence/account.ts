import { readActiveOrganizationId } from "../../lib/active-organization";

/*
  Which record a cold start should read.

  Hydration has to name a key before anything asynchronous has happened: the
  store is keyed by account and organization, and both of those are answers the
  network has not given yet. The organization half already exists —
  `useActiveOrganizationPersistence` writes it per user — but reading it needs
  the user id, so the last written account is remembered here alongside it.

  localStorage rather than IndexedDB because it is synchronous: the decision
  "hydrate, or fall through to today's boot gate" is made during the effect that
  mounts, before the session bootstrap can commit anything.
*/

const storageKey = "briar.snapshot-account.v1";

export interface SnapshotAccount {
  readonly userId: string;
  readonly organizationId: string;
}

/** The account and organization the last snapshot was written for. */
export function readSnapshotAccount(): SnapshotAccount | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { organizationId, userId } = parsed as Record<string, unknown>;
    if (typeof userId !== "string" || userId === "") return null;
    if (typeof organizationId !== "string" || organizationId === "") return null;
    return { organizationId, userId };
  } catch {
    return null;
  }
}

export function writeSnapshotAccount(account: SnapshotAccount): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(account));
  } catch {
    // Without the pointer the next boot shows the gate, which is what it did
    // before this existed.
  }
}

export function clearSnapshotAccount(): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing to do: a pointer to a record that no longer exists reads as null.
  }
}

/**
 * The record a cold start should look for, or `null` when this device has never
 * written one.
 *
 * The organization comes from the per-user key the session bootstrap resolves
 * its own selection from, so a window that switched organizations last hands
 * back the same organization the bootstrap is about to choose; the pointer's
 * own organization is the fallback for a device that has the record but never
 * wrote that key.
 */
export function resolveBootSnapshotAccount(): SnapshotAccount | null {
  const account = readSnapshotAccount();
  if (!account) return null;
  return {
    userId: account.userId,
    organizationId:
      readActiveOrganizationId(account.userId) ?? account.organizationId,
  };
}
