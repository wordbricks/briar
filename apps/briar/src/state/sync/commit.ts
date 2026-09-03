import type { DashboardPayload, TeamSettings } from "../../types";
import type { AtomRegistry } from "../registry";
import { applySyncEvent } from "./apply";
import { getTeamSyncLoader } from "./loader";

/*
  The two store writes a user triggered team flow performs.

  They exist as a pair because both carry the half of `setDashboard`'s contract
  that is not a merge rule: cancelling whatever is in flight. Committing without
  it would let a response already on the wire put the replaced value back, which
  is the race the payload level setter quietly prevented.
*/

/** Installs a whole payload as `teamId`'s snapshot. */
export function commitTeamSnapshot(
  registry: AtomRegistry,
  teamId: string,
  payload: DashboardPayload,
): void {
  getTeamSyncLoader(registry).cancelAll();
  applySyncEvent(registry, { kind: "team-snapshot", teamId, payload });
}

/**
 * Rewrites the rendered team's settings, and nothing else. A write for a team
 * whose payload is not on screen is dropped by the event itself.
 */
export function commitTeamSettings(
  registry: AtomRegistry,
  teamId: string,
  settings: TeamSettings,
): void {
  getTeamSyncLoader(registry).cancelAll();
  applySyncEvent(registry, { kind: "team-settings-changed", teamId, settings });
}
