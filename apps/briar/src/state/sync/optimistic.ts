import * as Atom from "effect/unstable/reactivity/Atom";

import type { HuntRun } from "../../types";
import { runAtom } from "../entities/runs";
import type { AtomRegistry } from "../registry";
import { applySyncEvent } from "./apply";

/*
  Local run edits, and how they survive a server that disagrees.

  Every issue action that changes one run patches it here rather than rebuilding
  a whole `DashboardPayload`: the patch goes through `applySyncEvent` as a
  `run-changed`, so the store keeps one writer and only that run's subscribers
  are notified.

  {@link optimisticRunUpdate} adds the part a hand written optimistic update
  always got wrong — undoing itself when the write fails, but *not* when the
  failure raced a newer server value into the store. Rolling back blindly would
  resurrect a run the delta stream had already moved on from.
*/

/**
 * Replaces one run in the store with `patch(run)`.
 *
 * Returns the patched run, or `null` when the store does not hold `runId` —
 * a run the account cannot see is not something a local patch may invent.
 * A patch that returns its input writes nothing, so a no-op edit costs no
 * notification.
 */
export function applyRunPatch(
  registry: AtomRegistry,
  runId: string,
  patch: (run: HuntRun) => HuntRun,
  teamId?: string,
): HuntRun | null {
  const current = registry.get(runAtom(runId));
  if (!current) return null;
  const next = patch(current);
  if (next === current) return current;
  applySyncEvent(registry, { kind: "run-changed", run: next, teamId });
  return next;
}

/** {@link applyRunPatch} for several runs, notifying subscribers once. */
export function applyRunPatches(
  registry: AtomRegistry,
  runIds: readonly string[],
  patch: (run: HuntRun) => HuntRun,
  teamId?: string,
): void {
  Atom.batch(() => {
    for (const runId of runIds) applyRunPatch(registry, runId, patch, teamId);
  });
}

/** `left` describes a strictly later state of the run than `right`. */
const isNewer = (left: HuntRun, right: HuntRun) => {
  const leftAt = Date.parse(left.updatedAt);
  const rightAt = Date.parse(right.updatedAt);
  return Number.isFinite(leftAt) && Number.isFinite(rightAt)
    ? leftAt > rightAt
    : false;
};

/**
 * Whether a failed optimistic write may put `previous` back.
 *
 * The rule, in order:
 *
 * 1. The run is gone — the server deleted it while the write was in flight, so
 *    there is nothing to restore.
 * 2. The store still holds the exact object the optimistic write put there, so
 *    nothing raced it: restore.
 * 3. Something replaced it. Restore only when what replaced it is not *newer*
 *    than the optimistic value: a delta or realtime event carrying a strictly
 *    later `updatedAt` is authoritative and the rollback is skipped. Equal
 *    timestamps lose to the rollback — the optimistic write and the value it
 *    replaced describe the same instant, so the failed write is the odd one out.
 */
function mayRollBack(current: HuntRun | null, optimistic: HuntRun): boolean {
  if (current === null) return false;
  if (current === optimistic) return true;
  return !isNewer(current, optimistic);
}

export interface OptimisticRunOptions<A> {
  /**
   * The team the run belongs to, for the case where the store has never seen
   * it listed. Runs already in a team index do not need it.
   */
  readonly teamId?: string | undefined;
  /**
   * The authoritative run the server answered with, if the response carries
   * one. It replaces the optimistic value on success; without it the optimistic
   * value stands until the next delta.
   */
  readonly confirm?: ((result: A) => HuntRun | null | undefined) | undefined;
}

/**
 * Patches one run, runs `commit`, and reconciles the two.
 *
 * On success the confirmed run — when {@link OptimisticRunOptions.confirm}
 * produces one — replaces the optimistic value. On failure the patch is undone
 * according to {@link mayRollBack} and the error is rethrown, so callers keep
 * their own error handling.
 *
 * A run the store does not hold skips the optimistic write entirely and just
 * commits: there is nothing on screen to patch or to restore.
 */
export async function optimisticRunUpdate<A>(
  registry: AtomRegistry,
  runId: string,
  patch: (run: HuntRun) => HuntRun,
  commit: (patched: HuntRun | null) => Promise<A>,
  options: OptimisticRunOptions<A> = {},
): Promise<A> {
  const previous = registry.get(runAtom(runId));
  const optimistic = applyRunPatch(registry, runId, patch, options.teamId);
  try {
    const result = await commit(optimistic);
    const confirmed = options.confirm?.(result);
    if (confirmed) {
      applySyncEvent(registry, {
        kind: "run-changed",
        run: confirmed,
        teamId: options.teamId,
      });
    }
    return result;
  } catch (caught) {
    if (
      previous &&
      optimistic &&
      optimistic !== previous &&
      mayRollBack(registry.get(runAtom(runId)), optimistic)
    ) {
      applySyncEvent(registry, {
        kind: "run-changed",
        run: previous,
        teamId: options.teamId,
      });
    }
    throw caught;
  }
}
