import * as Atom from "effect/unstable/reactivity/Atom";

import { demoDashboard } from "../../lib/demo-data";
import type { HuntRun } from "../../types";
import { demoMode } from "../platform";
import { shallowArrayEqual } from "./upsert";

/*
  Runs normalized by id, plus one ordered id index per team.

  The index is stored rather than derived because `HuntRun.teamId` is optional
  on the wire, so membership cannot be recovered from a run alone, and because
  the two sync paths order the list differently: a snapshot renders the server's
  order verbatim while a delta re-sorts and caps the list. `state/sync/apply.ts`
  owns both writes.
*/

const demoTeamId = demoMode ? demoDashboard.team.id : null;

/** Every known run, keyed by run id, across every team the account can open. */
export const runsByIdAtom = Atom.make<ReadonlyMap<string, HuntRun>>(
  demoMode
    ? new Map(demoDashboard.runs.map((run) => [run.id, run]))
    : new Map(),
).pipe(Atom.keepAlive, Atom.withLabel("entities/runs"));

/** One run, or `null` when it is not in the store. */
export const runAtom = Atom.family((runId: string) =>
  Atom.map(runsByIdAtom, (runs) => runs.get(runId) ?? null).pipe(
    Atom.withLabel(`entities/runs/${runId}`),
  ),
);

/**
 * A team's run ids in render order, or `null` when the team has never been
 * loaded. List views subscribe to this instead of the run objects, so editing
 * one run does not re-render the list.
 */
export const teamRunIdsAtom = Atom.family((teamId: string) =>
  Atom.make<string[] | null>(
    teamId === demoTeamId ? demoDashboard.runs.map((run) => run.id) : null,
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/runs/team/${teamId}/ids`),
  ),
);

/**
 * A team's runs resolved against the store. The array keeps its reference while
 * every run in it keeps theirs, which is what lets the reassembled dashboard
 * stay identical across a delta that changed nothing.
 */
export const teamRunsAtom = Atom.family((teamId: string) =>
  Atom.make((get): HuntRun[] | null => {
    const ids = get(teamRunIdsAtom(teamId));
    if (!ids) return null;
    const runs = get(runsByIdAtom);
    const resolved: HuntRun[] = [];
    for (const id of ids) {
      const run = runs.get(id);
      if (run) resolved.push(run);
    }
    return resolved;
  }).pipe(
    Atom.withEquality<HuntRun[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/runs/team/${teamId}`),
  ),
);
