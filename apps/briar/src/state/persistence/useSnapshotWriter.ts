import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect } from "react";

import {
  channelCatalogOrganizationIdsAtom,
  channelsByIdAtom,
  organizationChannelIdsAtom,
} from "../entities/channels";
import { membersByIdAtom, teamMemberIdsAtom } from "../entities/members";
import { teamOrganizationProvidersAtom } from "../entities/providers";
import { retainedTeamIdsAtom } from "../entities/retention";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamsByIdAtom } from "../entities/teams";
import { teamWorkerIdsAtom, workersByIdAtom } from "../entities/workers";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { demoMode, lockedTeamIdAtom } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import {
  activeTeamIdAtom,
  teamExecutionPolicyAtom,
  teamGeneratedAtAtom,
  teamNotificationsAtom,
  teamSettingsAtom,
  teamsAtom,
} from "../team/atoms";
import { writeSnapshotAccount, type SnapshotAccount } from "./account";
import { collectSnapshot } from "./snapshot";
import {
  deleteSnapshotSafely,
  snapshotKey,
  writeSnapshotSafely,
} from "./store";

/*
  When the store is written out.

  Writing on every change would put a serialize and an IndexedDB transaction on
  the same tick as a delta merge, so changes are coalesced: the first one arms a
  timer, everything that happens inside the window rides along, and one record
  is written a second later. Leaving the tab writes immediately, because there
  may be no next tick.
*/

/** How long changes are collected before one record is written. */
export const SNAPSHOT_WRITE_DELAY_MS = 1_000;

/**
 * A new object whenever the persisted part of the store changed.
 *
 * It reads the same atoms {@link collectSnapshot} does, which is what makes it
 * a change signal rather than a list to maintain by hand: adding a field to the
 * snapshot without reading it here would mean the field is written whenever
 * something *else* changes. Two atoms are read on purpose by neither — the
 * resume cursor and the rendered payload cursor. The resume cursor advances on
 * every delta page including the quiet ones, and rewriting the whole record
 * every polling tick to save the next boot a page of catch-up is not a trade
 * worth making; whatever the cursor reads at write time is what gets stored.
 */
export const snapshotRevisionAtom = Atom.make((get) => {
  get(userAtom);
  get(organizationsAtom);
  get(teamsAtom);
  get(activeOrganizationIdAtom);
  get(activeTeamIdAtom);
  get(runsByIdAtom);
  get(workersByIdAtom);
  get(membersByIdAtom);
  get(teamsByIdAtom);
  get(channelsByIdAtom);
  get(channelCatalogOrganizationIdsAtom);
  const organizationId = get(activeOrganizationIdAtom);
  if (organizationId) get(organizationChannelIdsAtom(organizationId));
  for (const teamId of get(retainedTeamIdsAtom)) {
    get(teamSettingsAtom(teamId));
    get(teamExecutionPolicyAtom(teamId));
    get(teamNotificationsAtom(teamId));
    get(teamOrganizationProvidersAtom(teamId));
    get(teamGeneratedAtAtom(teamId));
    get(teamRunIdsAtom(teamId));
    get(teamWorkerIdsAtom(teamId));
    get(teamMemberIdsAtom(teamId));
  }
  return {};
}).pipe(Atom.withLabel("persistence/revision"));

export interface SnapshotWriterOptions {
  /** How long a change waits for company. Tests shorten it. */
  readonly delayMs?: number;
}

const accountOf = (registry: AtomRegistry): SnapshotAccount | null => {
  const user = registry.get(userAtom);
  const organizationId = registry.get(activeOrganizationIdAtom);
  return user && organizationId
    ? { organizationId, userId: user.id }
    : null;
};

const sameAccount = (
  left: SnapshotAccount | null,
  right: SnapshotAccount | null,
) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.userId === right.userId &&
    left.organizationId === right.organizationId);

/**
 * Keeps this registry's snapshot on disk, bound to one registry. Returns its
 * canceller.
 */
export function startSnapshotWriter(
  registry: AtomRegistry,
  options: SnapshotWriterOptions = {},
): () => void {
  const delayMs = options.delayMs ?? SNAPSHOT_WRITE_DELAY_MS;
  let timer: number | null = null;
  let disposed = false;
  /*
    The account whose record this writer is responsible for. It starts as
    whatever is selected rather than as "nothing written yet", so an
    organization the app hydrated but never wrote to still has its record
    removed when the account leaves it.
  */
  let persisted = accountOf(registry);

  const cancelTimer = () => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  };

  const write = () => {
    cancelTimer();
    if (disposed) return;
    const snapshot = collectSnapshot(registry);
    if (!snapshot) return;
    /*
      A project window is pinned to one team and must not tell the next cold
      start that its organization is the one to open — the same reason
      `useActiveOrganizationPersistence` skips its own write there. The record
      itself is still written: it is keyed by organization, so it can only ever
      be read back by a window that resolves to the same one.
    */
    if (!registry.get(lockedTeamIdAtom)) {
      writeSnapshotAccount({
        organizationId: snapshot.organizationId,
        userId: snapshot.userId,
      });
    }
    void writeSnapshotSafely(
      registry,
      snapshotKey(snapshot.userId, snapshot.organizationId),
      snapshot,
    );
  };

  const schedule = () => {
    if (disposed || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      write();
    }, delayMs);
  };

  const observe = () => {
    if (disposed) return;
    const account = accountOf(registry);
    if (!sameAccount(account, persisted)) {
      /*
        The selection moved. Whatever was scheduled belongs to the account that
        is no longer selected, so it is dropped rather than written under the
        new one.
      */
      cancelTimer();
      if (persisted && account && account.userId === persisted.userId) {
        // Leaving an organization drops its teams from the store; its record
        // goes with them. A change of *account* is not handled here — signing
        // out clears every record, which is stricter.
        void deleteSnapshotSafely(
          registry,
          snapshotKey(persisted.userId, persisted.organizationId),
        );
      }
      persisted = account;
    }
    if (account) schedule();
  };

  const flushNow = () => {
    if (accountOf(registry)) write();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flushNow();
  };

  const unsubscribe = registry.subscribe(snapshotRevisionAtom, observe, {
    immediate: true,
  });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flushNow);

  return () => {
    disposed = true;
    cancelTimer();
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flushNow);
  };
}

/**
 * Mounts {@link startSnapshotWriter} for the surrounding registry. Demo mode has
 * a seeded store and no account to key a record by, so it writes nothing.
 */
export function useSnapshotWriter(options: SnapshotWriterOptions = {}): void {
  const registry = useRegistry();
  const { delayMs } = options;
  useEffect(() => {
    if (demoMode) return;
    return startSnapshotWriter(registry, { delayMs });
  }, [delayMs, registry]);
}
