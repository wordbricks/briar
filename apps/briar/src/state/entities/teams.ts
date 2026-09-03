import * as Atom from "effect/unstable/reactivity/Atom";

import { demoDashboard } from "../../lib/demo-data";
import type { Team } from "../../types";
import { demoMode } from "../platform";

/*
  The team object a dashboard payload carries, normalized by team id.

  This is not `state/team/atoms.ts`'s `teamsAtom`: that one is the list of teams
  the account can open, loaded from `loadTeams`, while this map is the team
  projection the dashboard renders (`DashboardPayload.team`). They are kept in
  sync by the team actions, which write both.
*/

/** Every team a dashboard payload has described, keyed by team id. */
export const teamsByIdAtom = Atom.make<ReadonlyMap<string, Team>>(
  demoMode
    ? new Map([[demoDashboard.team.id, demoDashboard.team]])
    : new Map(),
).pipe(Atom.keepAlive, Atom.withLabel("entities/teams"));

/** One team's dashboard projection, or `null` when it was never loaded. */
export const teamEntityAtom = Atom.family((teamId: string) =>
  Atom.map(teamsByIdAtom, (teams) => teams.get(teamId) ?? null).pipe(
    Atom.withLabel(`entities/teams/${teamId}`),
  ),
);
