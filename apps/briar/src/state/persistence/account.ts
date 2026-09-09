import { readActiveWorkspaceId } from "../../lib/active-workspace";

/*
  Which record a cold start should read.

  Hydration has to name a key before anything asynchronous has happened: the
  store is keyed by account and workspace, and both of those are answers the
  network has not given yet. The workspace half already exists —
  `useActiveWorkspacePersistence` writes it per user — but reading it needs
  the user id, so the last written account is remembered here alongside it.

  localStorage rather than IndexedDB because it is synchronous: the decision
  "hydrate, or fall through to today's boot gate" is made during the effect that
  mounts, before the session bootstrap can commit anything.
*/

const storageKey = "briar.snapshot-account.v1";

export interface SnapshotAccount {
  readonly userId: string;
  readonly workspaceId: string;
}

/** The account and workspace the last snapshot was written for. */
export function readSnapshotAccount(): SnapshotAccount | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { workspaceId, userId } = parsed as Record<string, unknown>;
    if (typeof userId !== "string" || userId === "") return null;
    if (typeof workspaceId !== "string" || workspaceId === "") return null;
    return { workspaceId, userId };
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
 * The workspace comes from the per-user key the session bootstrap resolves
 * its own selection from, so a window that switched workspaces last hands
 * back the same workspace the bootstrap is about to choose; the pointer's
 * own workspace is the fallback for a device that has the record but never
 * wrote that key.
 */
export function resolveBootSnapshotAccount(): SnapshotAccount | null {
  const account = readSnapshotAccount();
  if (!account) return null;
  return {
    userId: account.userId,
    workspaceId:
      readActiveWorkspaceId(account.userId) ?? account.workspaceId,
  };
}
