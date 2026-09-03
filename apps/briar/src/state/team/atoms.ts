import * as Atom from "effect/unstable/reactivity/Atom";

import { demoDashboard } from "../../lib/demo-data";
import type { Project, ProjectConnection } from "../../types";
import { demoMode } from "../platform";

/*
  Teams (`Project` in the type layer) the account can open, which one is
  selected, and the transient state of the team creation / reconnect flow.

  `activeTeamIdAtom` replaces the `activeProjectIdRef` mirror `useBriar` used to
  keep: an async callback that needs the *current* selection reads
  `registry.get(activeTeamIdAtom)` instead of a ref written during render.
*/

/** Every team the account can open, across all of its organizations. */
export const teamsAtom = Atom.make<Project[]>(
  demoMode ? [demoDashboard.team] : [],
).pipe(Atom.keepAlive, Atom.withLabel("team/list"));

/**
 * The selected team. A project window pins this to its locked team, so
 * `useBriar` seeds it per registry rather than relying on the module default.
 */
export const activeTeamIdAtom = Atom.make<string | null>(
  demoMode ? demoDashboard.team.id : null,
).pipe(Atom.keepAlive, Atom.withLabel("team/activeId"));

/**
 * The team currently being created or reconnected, together with the agent
 * token and workflow the flow collected. `null` outside the flow.
 */
export const teamConnectionAtom = Atom.make<ProjectConnection | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("team/connection"));

/** The team creation flow is open. */
export const isCreatingTeamAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("team/isCreating"),
);

/** The team whose deletion is in flight, if any. */
export const deletingTeamIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("team/deletingId"),
);

/**
 * The selected team resolved against the list. The result is an element of
 * `teamsAtom`, never a fresh object, so subscribers are notified only when the
 * selected team itself changes.
 */
export const activeTeamAtom = Atom.make((get) => {
  const activeTeamId = get(activeTeamIdAtom);
  if (!activeTeamId) return null;
  return get(teamsAtom).find((team) => team.id === activeTeamId) ?? null;
}).pipe(Atom.keepAlive, Atom.withLabel("team/active"));
