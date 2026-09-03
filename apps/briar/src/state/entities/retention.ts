import * as Atom from "effect/unstable/reactivity/Atom";

import { demoDashboard } from "../../lib/demo-data";
import { demoMode } from "../platform";
import { shallowArrayEqual } from "./upsert";

/*
  How many teams keep their entities in memory.

  Before entities existed `useBriar` held an eight entry LRU of whole
  `DashboardPayload`s so returning to a visited team rendered instantly. The
  store replaces the cache but inherits its bound: the entity maps would
  otherwise grow with every team an account ever opens.
*/

/** Teams whose entities survive. Least recently synced first. */
export const TEAM_RETENTION_LIMIT = 8;

/**
 * Teams that currently hold entities, least recently synced first. Written only
 * by `state/sync/apply.ts`, which evicts whatever falls off the front.
 */
export const retainedTeamIdsAtom = Atom.make<string[]>(
  demoMode ? [demoDashboard.team.id] : [],
).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("entities/retainedTeams"),
);

/**
 * Moves `teamId` to the most recent end and reports the teams pushed past the
 * limit. Returns `current` unchanged when the team was already the most recent
 * one, so a quiet polling tick does not churn the atom.
 */
export function touchRetainedTeam(
  current: string[],
  teamId: string,
  limit = TEAM_RETENTION_LIMIT,
) {
  if (current.at(-1) === teamId) {
    return { retained: current, evicted: [] as string[] };
  }
  const next = current.filter((candidate) => candidate !== teamId);
  next.push(teamId);
  const overflow = Math.max(0, next.length - limit);
  return { retained: next.slice(overflow), evicted: next.slice(0, overflow) };
}
