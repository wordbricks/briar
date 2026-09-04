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

  One screen reaches across that bound. "내 이슈" lists the current user's runs in
  every team of the organization, so it loads and reads more teams than the LRU
  is sized for — thirty teams would evict twenty-two of them halfway through the
  list. The pinned set below is that screen's answer: while it is open the teams
  it draws cannot be evicted, and it releases them when it unmounts. The bound
  does not disappear, it becomes the one that screen already had — it held
  exactly these boards in a `useState` record for exactly this long — and it is
  a live memory rule only: `collectSnapshot` still writes at most
  {@link TEAM_RETENTION_LIMIT} teams to disk.
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
 * Teams a mounted view draws across the retention bound, which the LRU must not
 * evict under it. Owned by `state/my-issues/useMyIssuesSync.ts`, the only such
 * view, which clears it on unmount.
 */
export const pinnedTeamIdsAtom = Atom.make<string[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("entities/pinnedTeams"),
);

const noProtectedIds: ReadonlySet<string> = new Set();

/**
 * Moves `teamId` to the most recent end and reports the teams pushed past the
 * limit. Returns `current` unchanged when the team was already the most recent
 * one, so a quiet polling tick does not churn the atom.
 *
 * `protectedIds` are never evicted, so a list that is over the limit only
 * because of them stays over it until they are released.
 */
export function touchRetainedTeam(
  current: string[],
  teamId: string,
  options: {
    readonly limit?: number;
    readonly protectedIds?: ReadonlySet<string>;
  } = {},
) {
  if (current.at(-1) === teamId) {
    return { retained: current, evicted: [] as string[] };
  }
  const limit = options.limit ?? TEAM_RETENTION_LIMIT;
  const protectedIds = options.protectedIds ?? noProtectedIds;
  const next = current.filter((candidate) => candidate !== teamId);
  next.push(teamId);
  let removable = Math.max(0, next.length - limit);
  if (removable === 0) return { retained: next, evicted: [] as string[] };
  const retained: string[] = [];
  const evicted: string[] = [];
  for (const candidate of next) {
    if (removable > 0 && candidate !== teamId && !protectedIds.has(candidate)) {
      evicted.push(candidate);
      removable -= 1;
      continue;
    }
    retained.push(candidate);
  }
  return { retained, evicted };
}
