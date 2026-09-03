import type { HuntRun } from "../../types";

/*
  Merge primitives shared by every entity map. They are the rules
  `lib/dashboard-sync.ts` applied to one `DashboardPayload`, lifted so the
  normalized store can apply them per entity: an incoming value that is deep
  equal to the stored one keeps the stored reference, and a collection that did
  not change keeps its own reference too. `Object.is` based atom notifications
  then reach only the subscribers of entities that actually moved.
*/

/**
 * Structural equality by JSON shape. Cheap enough for the payload sizes this
 * store holds (200 runs per team at most) and identical to the comparison the
 * dashboard merge used before entities existed.
 */
export const sameValue = (left: unknown, right: unknown) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

/** Two arrays hold the exact same element references in the same order. */
export const sameReferences = <T>(left: readonly T[], right: readonly T[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

/**
 * `sameReferences` widened to the nullable collections a team family stores,
 * where `null` marks a field the server payload omitted.
 */
export const shallowArrayEqual = <T>(
  left: readonly T[] | null | undefined,
  right: readonly T[] | null | undefined,
) =>
  left === right ||
  (left !== null && left !== undefined && right !== null && right !== undefined &&
    sameReferences(left, right));

/**
 * Applies `incoming` to `map` under `identify`, then removes `deletedIds`.
 * An entity that is deep equal to the stored one keeps the stored reference,
 * and a call that changes nothing returns the very same `Map`, so writing the
 * result back to an atom notifies nobody.
 */
export function upsertManyBy<T>(
  map: ReadonlyMap<string, T>,
  incoming: readonly T[],
  identify: (item: T) => string,
  deletedIds?: readonly string[],
): ReadonlyMap<string, T> {
  let next: Map<string, T> | null = null;
  const ensure = () => (next ??= new Map(map));
  for (const item of incoming) {
    const id = identify(item);
    const previous = (next ?? map).get(id);
    if (previous !== undefined && sameValue(previous, item)) continue;
    ensure().set(id, item);
  }
  for (const id of deletedIds ?? []) {
    if (!(next ?? map).has(id)) continue;
    ensure().delete(id);
  }
  return next ?? map;
}

/** {@link upsertManyBy} for the entities keyed by their own `id`. */
export function upsertMany<T extends { id: string }>(
  map: ReadonlyMap<string, T>,
  incoming: readonly T[],
  deletedIds?: readonly string[],
): ReadonlyMap<string, T> {
  return upsertManyBy(map, incoming, (item) => item.id, deletedIds);
}

/** Drops `ids` from `map`, returning the same instance when none were present. */
export function removeMany<T>(
  map: ReadonlyMap<string, T>,
  ids: Iterable<string>,
): ReadonlyMap<string, T> {
  let next: Map<string, T> | null = null;
  for (const id of ids) {
    if (!map.has(id)) continue;
    next ??= new Map(map);
    next.delete(id);
  }
  return next ?? map;
}

/**
 * Replaces a whole projection while keeping the reference of every element the
 * server re-sent unchanged, and the array reference itself when nothing moved.
 */
export function replaceEntities<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const next = incoming.map((item) => {
    const previous = currentById.get(item.id);
    return previous && sameValue(previous, item) ? previous : item;
  });
  return sameReferences(current, next) ? (current as T[]) : next;
}

/** How many runs a team keeps after a delta merge. */
export const TEAM_RUN_LIMIT = 200;

/**
 * Terminal runs sink to the bottom, everything else is newest first. Sorting is
 * stable, so runs that tie keep the order the merge produced.
 */
export const orderRuns = (runs: readonly HuntRun[]): HuntRun[] =>
  [...runs].sort((left, right) => {
    const leftTerminal = ["completed", "cancelled"].includes(left.status);
    const rightTerminal = ["completed", "cancelled"].includes(right.status);
    if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });

/**
 * Applies a delta's run changes and tombstones to one team's ordered run list.
 * Returns `current` when the delta moved nothing, so a quiet polling tick never
 * produces a new array.
 */
export function mergeTeamRuns(
  current: readonly HuntRun[],
  changed: readonly HuntRun[],
  deletedRunIds: readonly string[],
): readonly HuntRun[] {
  if (changed.length === 0 && deletedRunIds.length === 0) return current;
  const deleted = new Set(deletedRunIds);
  const changedById = new Map(changed.map((run) => [run.id, run]));
  const merged = current.flatMap((run) => {
    if (deleted.has(run.id)) return [];
    const next = changedById.get(run.id);
    if (!next) return [run];
    changedById.delete(run.id);
    return [sameValue(run, next) ? run : next];
  });
  merged.push(...changedById.values());
  const ordered = orderRuns(merged).slice(0, TEAM_RUN_LIMIT);
  return sameReferences(current, ordered) ? current : ordered;
}
