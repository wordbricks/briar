import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect } from "react";

import { browserAuthClient } from "../../lib/browser-auth-client";
import type { LocalProjectInventoryObservation } from "../../lib/local-team-connection";
import { resolveActiveAccountSelection } from "../../lib/active-organization";
import { restoreStoredSession } from "../../lib/session-restore";
import { clearSessionToken, readSessionToken } from "../../lib/token-store";
import {
  adoptsHydratedSession,
  awaitHydration,
  hydratedAccountAtom,
} from "../persistence/hydration";
import { demoMode, lockedTeamIdAtom, remoteMode, webMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { getReadinessCoordinator } from "../workspace/api";
import { applyInventoryObservation } from "../workspace/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { clearSignedOutSession } from "./actions";
import { resolveSessionApi } from "./api";
import {
  loadingAtom,
  restoringSessionAtom,
  sessionErrorAtom,
  tokenAtom,
  userAtom,
} from "./atoms";

/*
  Cold start: exchange the stored credential for a session.

  This was `useBriar`'s longest effect. It ran once per mount and it owns
  `restoringSession`, the gate every screen waits behind, so the app mounts it
  exactly once — from `AppEffects`, above the shell choice.

  A failure that is not a rejected credential is retried with an exponential
  backoff capped at fifteen seconds, and the message stays on screen while the
  retries run: a cold start with no network must not look like a signed-out app.
  Only a missing or rejected token opens the gate signed out.

  Since `state/persistence`, it is not the only thing a cold start runs: a
  device with a stored snapshot renders it, and opens the gate, while this is
  still in flight. That makes the two writers of the same atoms, so this waits
  on the hydration gate before it commits anything — and its own results always
  replace what the record put there. A record belonging to another account is
  discarded outright.
*/

/** One restore attempt loop, bound to a registry. Returns its canceller. */
export function startSessionBootstrap(registry: AtomRegistry): () => void {
  let cancelled = false;
  let retryTimer: number | null = null;
  let retryAttempt = 0;

  const scheduleRetry = (caught: unknown) => {
    const message = caught instanceof Error ? caught.message : String(caught);
    Atom.batch(() => {
      registry.set(sessionErrorAtom, `${message} 다시 연결하는 중입니다…`);
      registry.set(loadingAtom, true);
    });
    const retryDelay = Math.min(1_000 * 2 ** retryAttempt, 15_000);
    retryAttempt += 1;
    retryTimer = window.setTimeout(() => void restore(), retryDelay);
  };

  /*
    Hydration and this effect write the same atoms, so their order is explicit
    rather than "whichever I/O finished first": nothing is committed until the
    stored record has been applied or ruled out.
  */
  const waitForHydration = async () => {
    const pending = awaitHydration(registry);
    if (pending) await pending;
  };

  /** Drops what hydration installed, and the record it came from. */
  const discardHydratedSnapshot = () => {
    if (registry.get(hydratedAccountAtom) === null) return;
    clearSignedOutSession(registry);
  };

  const restore = async () => {
    const remote = resolveSessionApi(registry);
    const result = await restoreStoredSession({
      clearToken: webMode
        ? async () => {
            await browserAuthClient.signOut();
            await clearSessionToken();
          }
        : clearSessionToken,
      loadOrganizations: remote.loadOrganizations,
      loadTeams: remote.loadTeams,
      loadSession: remote.loadSession,
      readToken: webMode
        ? browserAuthClient.readSessionCredential
        : readSessionToken,
    });
    if (cancelled) return;
    if (result.status === "missing" || result.status === "unauthorized") {
      await waitForHydration();
      if (cancelled) return;
      /*
        A stored snapshot outlives the credential it was written under. Without
        one, this device cannot prove the account it hydrated, so the screen
        goes back to what a signed-out app looks like — and the record with it.
      */
      discardHydratedSnapshot();
      Atom.batch(() => {
        registry.set(sessionErrorAtom, null);
        registry.set(restoringSessionAtom, false);
        registry.set(loadingAtom, false);
      });
      return;
    }
    if (result.status === "retry") {
      /*
        A hydrated screen stays up through the retries. `restoringSession` is
        already false, so a retry never puts the boot gate back over data the
        account can still read; the failure is surfaced the way it always was,
        through `sessionError`.
      */
      scheduleRetry(result.error);
      return;
    }

    /*
      The local inventory is inspected before anything is committed: the
      readiness views derive from the account and the inventory together, and
      committing the account first would render one team as disconnected for as
      long as the inspection takes.
    */
    const inventory: LocalProjectInventoryObservation = remoteMode
      ? { status: "loaded", connectedTeamIds: null, error: null }
      : await getReadinessCoordinator(registry).inspectInventory();
    if (cancelled) return;
    await waitForHydration();
    if (cancelled) return;
    const hydrated = registry.get(hydratedAccountAtom);
    if (hydrated && hydrated.userId !== result.user.id) {
      // A different account signed in on this device. What the snapshot put on
      // screen is theirs, and it goes before this account is committed.
      discardHydratedSnapshot();
    }
    const selection = resolveActiveAccountSelection(
      result.user.id,
      result.organizations,
      result.projects,
      registry.get(lockedTeamIdAtom),
    );
    /*
      A hydrated window is already showing one team, and
      `resolveActiveAccountSelection` answers with the organization's first —
      committing that would move the screen off the board the account was last
      on. The hydrated selection therefore survives as long as the account still
      has that team, in the organization the selection resolved to.
    */
    const hydratedTeamId = adoptsHydratedSession(registry)
      ? registry.get(activeTeamIdAtom)
      : null;
    const keepsHydratedTeam =
      hydratedTeamId !== null &&
      result.projects.some(
        (team) =>
          team.id === hydratedTeamId &&
          team.organizationId === selection.activeOrganizationId,
      );
    Atom.batch(() => {
      registry.set(tokenAtom, result.token);
      registry.set(userAtom, result.user);
      registry.set(teamsAtom, result.projects);
      registry.set(organizationsAtom, result.organizations);
      applyInventoryObservation(registry, inventory);
      registry.set(activeOrganizationIdAtom, selection.activeOrganizationId);
      registry.set(
        activeTeamIdAtom,
        keepsHydratedTeam ? hydratedTeamId : selection.activeProjectId,
      );
      registry.set(sessionErrorAtom, null);
      registry.set(restoringSessionAtom, false);
      registry.set(loadingAtom, false);
    });
  };

  void restore();

  return () => {
    cancelled = true;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
  };
}

/**
 * Mounts {@link startSessionBootstrap} for the surrounding registry. Demo mode
 * has no credential to restore and starts with its own seeded account.
 */
export function useSessionBootstrap(): void {
  const registry = useRegistry();
  useEffect(() => {
    if (demoMode) return;
    return startSessionBootstrap(registry);
  }, [registry]);
}
