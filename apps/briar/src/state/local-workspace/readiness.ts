import type { RepositoryReadiness } from "../../generated/tauri";
import type { AtomRegistry } from "../registry";
import {
  applyReadinessObservation,
  clearTeamReadiness,
  setTeamReadinessLoading,
} from "./atoms";
import { getReadinessCoordinator, workspaceModes } from "./api";

/*
  Probing one team's checkout.

  Two entry points, because the two callers differ in one detail: the boot sweep
  in `useWorkspaceSync` shows the teams it is about to inspect as loading and
  keeps whatever it already knew, while a user triggered refresh blanks the
  previous result first so the panel cannot show a stale "ready" next to a
  spinner. Both drop a superseded observation and both leave the loading flag
  alone in that case — a newer probe owns it.
*/

/**
 * Inspects `teamId` and applies the result. Used by the boot sweep, which keeps
 * the previous readiness visible while the probe runs.
 */
export async function inspectTeamReadiness(
  registry: AtomRegistry,
  teamId: string,
): Promise<RepositoryReadiness | null> {
  setTeamReadinessLoading(registry, teamId, true);
  const observation = await getReadinessCoordinator(registry).inspect(teamId);
  if (observation.status === "superseded") return null;
  const readiness = applyReadinessObservation(registry, teamId, observation);
  setTeamReadinessLoading(registry, teamId, false);
  return readiness;
}

/**
 * Re-inspects `teamId` from scratch: the previous readiness and error are
 * dropped before the probe so nothing stale stays on screen. Returns `null`
 * where there is no local checkout to inspect.
 */
export async function refreshTeamReadiness(
  registry: AtomRegistry,
  teamId: string,
): Promise<RepositoryReadiness | null> {
  const { demoMode, remoteMode } = workspaceModes(registry);
  if (demoMode || remoteMode) return null;
  setTeamReadinessLoading(registry, teamId, true);
  clearTeamReadiness(registry, teamId);
  const observation = await getReadinessCoordinator(registry).inspect(teamId);
  if (observation.status === "superseded") return null;
  const readiness = applyReadinessObservation(registry, teamId, observation);
  setTeamReadinessLoading(registry, teamId, false);
  return readiness;
}
