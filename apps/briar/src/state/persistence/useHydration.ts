import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect } from "react";

import { demoMode, lockedTeamIdAtom } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { restoringSessionAtom, userAtom } from "../session/atoms";
import { activeTeamIdAtom } from "../team/atoms";
import { resolveBootSnapshotAccount } from "./account";
import {
  beginHydration,
  hydratedAccountAtom,
  settleHydration,
} from "./hydration";
import { applySnapshot, type ClientSnapshot } from "./snapshot";
import { readSnapshotSafely, snapshotKey } from "./store";

/*
  The first thing the app does.

  A cold start used to hold the screen behind `restoringSession` until the
  network had answered three requests. The store it was waiting for is on disk,
  so this reads it and puts it back: entities, per-team state, the channel
  index and the account, in one batch, and the gate opens on the last screen
  instead of on the logo.

  What it does *not* do is decide anything. The snapshot is a starting point
  with no authority: it carries no credential, nothing fetches until the
  bootstrap restores one, and every value it wrote is replaced the moment the
  bootstrap answers. The two are ordered by the hydration gate, which this hook
  opens while it mounts — before the bootstrap's own effect runs.
*/

/** The team a hydrated window opens, or `null` when this record is not for it. */
function hydratedSelection(
  registry: AtomRegistry,
  snapshot: ClientSnapshot,
): { readonly activeTeamId: string | null } | null {
  const lockedTeamId = registry.get(lockedTeamIdAtom);
  if (!lockedTeamId) return { activeTeamId: snapshot.session.activeTeamId };
  /*
    A project window is pinned to one team, so a record that does not carry it
    is not this window's to render. The pointer is written by the main window,
    which may well have been in another organization.
  */
  const lockedTeam = snapshot.session.teams.find(
    (team) => team.id === lockedTeamId,
  );
  return lockedTeam && lockedTeam.organizationId === snapshot.organizationId
    ? { activeTeamId: lockedTeamId }
    : null;
}

/** One hydration attempt, bound to a registry. Returns its canceller. */
export function startHydration(registry: AtomRegistry): () => void {
  const account = resolveBootSnapshotAccount();
  // Nothing was ever written on this device: today's boot, gate and all. The
  // gate is deliberately never opened, so the bootstrap waits for nothing.
  if (!account) return () => undefined;

  beginHydration(registry);
  let cancelled = false;

  void (async () => {
    try {
      const snapshot = await readSnapshotSafely(
        registry,
        snapshotKey(account.userId, account.organizationId),
      );
      // A missing, corrupted or outdated record reads as `null`, and every one
      // of those means the same thing: boot the way the app booted before.
      if (cancelled || !snapshot) return;
      // The pointer and the record disagree about whose work this is.
      if (snapshot.userId !== account.userId) return;
      // Something committed an account while the disk was being read — the
      // bootstrap, or a sign-in. Live data always wins over a record.
      if (registry.get(userAtom) !== null) return;
      const selection = hydratedSelection(registry, snapshot);
      if (!selection) return;

      Atom.batch(() => {
        applySnapshot(registry, snapshot);
        registry.set(activeTeamIdAtom, selection.activeTeamId);
        registry.set(hydratedAccountAtom, {
          organizationId: snapshot.organizationId,
          userId: snapshot.userId,
        });
        /*
          The one write that is visible immediately: the gate every screen waits
          behind opens on a shell that already has the last dashboard in it. The
          bootstrap keeps running, and sets this again when it commits.
        */
        registry.set(restoringSessionAtom, false);
      });
    } finally {
      settleHydration(registry);
    }
  })();

  return () => {
    cancelled = true;
    // Never leave the bootstrap waiting on a hydration that was torn down.
    settleHydration(registry);
  };
}

/**
 * Mounts {@link startHydration} for the surrounding registry. Demo mode boots
 * from its own seeded fixtures and has no record to read.
 */
export function useHydration(): void {
  const registry = useRegistry();
  useEffect(() => {
    if (demoMode) return;
    return startHydration(registry);
  }, [registry]);
}
