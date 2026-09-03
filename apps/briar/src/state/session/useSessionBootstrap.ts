import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect } from "react";

import { browserAuthClient } from "../../lib/browser-auth-client";
import type { LocalProjectInventoryObservation } from "../../lib/local-team-connection";
import { resolveActiveAccountSelection } from "../../lib/active-organization";
import { restoreStoredSession } from "../../lib/session-restore";
import { clearSessionToken, readSessionToken } from "../../lib/token-store";
import { demoMode, lockedTeamIdAtom, remoteMode, webMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { getReadinessCoordinator } from "../workspace/api";
import { applyInventoryObservation } from "../workspace/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
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

  This was `useBriar`'s longest effect. It ran once per mount and it is the only
  writer of `restoringSession`, the gate every screen waits behind, so the app
  mounts it exactly once — from `AppEffects`, above the shell choice.

  A failure that is not a rejected credential is retried with an exponential
  backoff capped at fifteen seconds, and the message stays on screen while the
  retries run: a cold start with no network must not look like a signed-out app.
  Only a missing or rejected token opens the gate signed out.
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
      Atom.batch(() => {
        registry.set(sessionErrorAtom, null);
        registry.set(restoringSessionAtom, false);
        registry.set(loadingAtom, false);
      });
      return;
    }
    if (result.status === "retry") {
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
    const selection = resolveActiveAccountSelection(
      result.user.id,
      result.organizations,
      result.projects,
      registry.get(lockedTeamIdAtom),
    );
    Atom.batch(() => {
      registry.set(tokenAtom, result.token);
      registry.set(userAtom, result.user);
      registry.set(teamsAtom, result.projects);
      registry.set(organizationsAtom, result.organizations);
      applyInventoryObservation(registry, inventory);
      registry.set(activeOrganizationIdAtom, selection.activeOrganizationId);
      registry.set(activeTeamIdAtom, selection.activeProjectId);
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
