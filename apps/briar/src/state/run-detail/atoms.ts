import * as Atom from "effect/unstable/reactivity/Atom";

import { demoRunEvents } from "../../lib/demo-data";
import type { HuntEvent, IssueMessage, RunEvidence } from "../../types";
import {
  initialDemoIssueMessages,
  initialDemoRunEvidence,
} from "../demo-fixtures";
import { shallowArrayEqual } from "../entities/upsert";
import { demoMode } from "../platform";
import type { AtomRegistry } from "../registry";

/*
  The three per-run collections the issue detail view loads on demand:
  conversation messages, workflow events and result evidence.

  `useBriar` kept them in refs, which meant a fetched page changed nothing on
  screen until something else re-rendered the view. As atoms they notify, so
  only the run detail view and the conversation panel may subscribe — a board
  that subscribed would re-render on every message poll.

  They are keyed by run id rather than stored in one map so that loading run B's
  messages does not notify a view rendering run A.
*/

const demoMessages: Record<string, IssueMessage[]> = demoMode
  ? initialDemoIssueMessages
  : {};
const demoEvidence: Record<string, RunEvidence[]> = demoMode
  ? initialDemoRunEvidence
  : {};
// Cloned because demo mode prepends events to it as the user drives the board.
const demoEvents: Record<string, HuntEvent[]> = demoMode
  ? structuredClone(demoRunEvents)
  : {};

/** A run's conversation messages, oldest first. */
export const issueMessagesAtom = Atom.family((runId: string) =>
  Atom.make<IssueMessage[]>(demoMessages[runId] ?? []).pipe(
    Atom.keepAlive,
    Atom.withEquality<IssueMessage[]>(shallowArrayEqual),
    Atom.withLabel(`run-detail/${runId}/messages`),
  ),
);

/** A run's result evidence. */
export const runEvidenceAtom = Atom.family((runId: string) =>
  Atom.make<RunEvidence[]>(demoEvidence[runId] ?? []).pipe(
    Atom.keepAlive,
    Atom.withEquality<RunEvidence[]>(shallowArrayEqual),
    Atom.withLabel(`run-detail/${runId}/evidence`),
  ),
);

/** A run's workflow events, newest first. */
export const runEventsAtom = Atom.family((runId: string) =>
  Atom.make<HuntEvent[]>(demoEvents[runId] ?? []).pipe(
    Atom.keepAlive,
    Atom.withEquality<HuntEvent[]>(shallowArrayEqual),
    Atom.withLabel(`run-detail/${runId}/events`),
  ),
);

/*
  How many runs keep their detail in memory.

  The refs this replaced were unbounded: opening a thousand issues over a long
  session kept a thousand conversations alive. Runs are retained the same way
  teams are in `state/entities/retention.ts` — least recently opened first — and
  the limit is generous because a detail view is opened one at a time.
*/

/** How many runs keep their loaded detail. */
export const RUN_DETAIL_RETENTION_LIMIT = 32;

/**
 * Runs whose detail survives, least recently read first. Written only by
 * {@link touchRunDetail} and {@link clearRunDetail}.
 */
export const retainedRunDetailIdsAtom = Atom.make<string[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("run-detail/retained"),
);

/** Drops everything loaded for one run. */
export function clearRunDetail(registry: AtomRegistry, runId: string): void {
  Atom.batch(() => {
    registry.set(issueMessagesAtom(runId), []);
    registry.set(runEvidenceAtom(runId), []);
    registry.set(runEventsAtom(runId), []);
    registry.update(retainedRunDetailIdsAtom, (retained) =>
      retained.includes(runId)
        ? retained.filter((candidate) => candidate !== runId)
        : retained,
    );
  });
}

/**
 * Marks `runId` as the most recently read run and drops whatever that pushes
 * past {@link RUN_DETAIL_RETENTION_LIMIT}. Called by the read actions, so a run
 * whose detail is on screen is always the most recent one.
 */
export function touchRunDetail(registry: AtomRegistry, runId: string): void {
  const current = registry.get(retainedRunDetailIdsAtom);
  if (current.at(-1) === runId) return;
  const next = current.filter((candidate) => candidate !== runId);
  next.push(runId);
  const overflow = Math.max(0, next.length - RUN_DETAIL_RETENTION_LIMIT);
  Atom.batch(() => {
    registry.set(retainedRunDetailIdsAtom, next.slice(overflow));
    for (const evicted of next.slice(0, overflow)) {
      registry.set(issueMessagesAtom(evicted), []);
      registry.set(runEvidenceAtom(evicted), []);
      registry.set(runEventsAtom(evicted), []);
    }
  });
}
