import * as Atom from "effect/unstable/reactivity/Atom";

import {
  loadDashboard,
  loadDashboardDelta,
  loadOrganizations,
  loadSession,
  loadTeamProjects,
  loadTeams,
} from "../../lib/api";
import { loadConnectedTeamIds } from "../../lib/team-connection";
import { useRegistry, type AtomRegistry } from "../registry";
import { teamSyncApiAtom } from "../sync/loader";
import { workspaceApiAtom } from "../workspace/api";

/*
  The reads the session performs on its own: restoring a stored session, signing
  in, loading a team list and its planning projects.

  These were `UseBriarOptions.dataSources` — the seam that let the facade be
  exercised without module mocking. The facade is gone, so the seam is an atom
  the registry owns: production never writes it and gets the live API, and a
  test writes it once with {@link setSessionDataSources} before the effects that
  read it mount.
*/

export interface SessionDataSources {
  readonly loadConnectedTeamIds: typeof loadConnectedTeamIds;
  readonly loadDashboard: typeof loadDashboard;
  readonly loadDashboardDelta: typeof loadDashboardDelta;
  readonly loadOrganizations: typeof loadOrganizations;
  readonly loadSession: typeof loadSession;
  readonly loadTeamProjects: typeof loadTeamProjects;
  readonly loadTeams: typeof loadTeams;
}

export const liveSessionDataSources: SessionDataSources = {
  loadConnectedTeamIds,
  loadDashboard,
  loadDashboardDelta,
  loadOrganizations,
  loadSession,
  loadTeamProjects,
  loadTeams,
};

export const sessionApiAtom = Atom.make<SessionDataSources>(
  liveSessionDataSources,
).pipe(Atom.keepAlive, Atom.withLabel("session/api"));

/** The reads this registry performs, live API where nothing was injected. */
export const resolveSessionApi = (
  registry: AtomRegistry,
): SessionDataSources => registry.get(sessionApiAtom);

export function useSessionApi(): SessionDataSources {
  const registry = useRegistry();
  return resolveSessionApi(registry);
}

/**
 * Replaces the session reads for one registry, and with them the two seams the
 * sync loader and the workspace coordinator read through — the three the facade
 * used to seed together from one `dataSources` option, so a test that hands in
 * an in-memory server still gets one call.
 */
export function setSessionDataSources(
  registry: AtomRegistry,
  sources: Partial<SessionDataSources>,
): void {
  const next: SessionDataSources = { ...liveSessionDataSources, ...sources };
  Atom.batch(() => {
    registry.set(sessionApiAtom, next);
    registry.set(teamSyncApiAtom, {
      loadDashboard: next.loadDashboard,
      loadDashboardDelta: next.loadDashboardDelta,
    });
    registry.set(workspaceApiAtom, {
      loadConnectedTeamIds: next.loadConnectedTeamIds,
      loadDashboard: next.loadDashboard,
    });
  });
}
