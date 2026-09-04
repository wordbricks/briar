import * as Atom from "effect/unstable/reactivity/Atom";

import { actionErrorAtom, actionPendingAtom, defineTaskAction } from "../actions";

/*
  Which issue mutation is in flight, and what the last recovery attempt said.

  `useBriar` kept four independent booleans and ids — `isCreatingIssue`,
  `updatingIssueId`, `deletingIssueId`, `recoveringRunId` — which could describe
  states that cannot happen: one run being deleted while another is edited, from
  a UI that disables both. A discriminated union said the same thing without the
  impossible combinations, and four task actions say it again without the
  bookkeeping: the atom that runs a mutation *is* its pending state, so there is
  no marker to set, no `finally` to clear it, and no way for the first of two
  overlapping calls to blank out the second's.

  The groups are the four the union had, because that is the granularity the
  views disable at: one creation, one edit, one deletion, one recovery. The
  views still read the four flags below, and the run detail view still reads the
  recovery failure — it is derived from the recovery action's own `Failure` now,
  which is why nothing writes it and a retry clears it by starting.
*/

/** Creating an issue. */
export const createIssueAction = defineTaskAction("issues/create");

/**
 * Writing one issue's fields, relations, preferences or checkpoints. The whole
 * group shares one action because the board disables the whole context menu of
 * a row while any of them runs.
 */
export const updateIssueAction = defineTaskAction("issues/update");

/** Deleting an issue, or transferring it out of the team. */
export const deleteIssueAction = defineTaskAction("issues/delete");

/**
 * Retrying, cancelling, resuming, reworking or moving a run.
 *
 * Its failure is the one the run detail view renders next to the run rather
 * than in the shell, which is why this group is separate from the edits: they
 * report through the session error.
 */
export const recoverRunAction = defineTaskAction("issues/recover");

/** An issue creation is in flight. */
export const isCreatingIssueAtom = actionPendingAtom(
  createIssueAction.result,
  "issues/isCreating",
);

/** The issue being edited, or `null`. */
export const updatingIssueIdAtom = updateIssueAction.pendingTarget;

/** The issue being deleted or transferred, or `null`. */
export const deletingIssueIdAtom = deleteIssueAction.pendingTarget;

/** The run being recovered, resumed, reworked or moved, or `null`. */
export const recoveringRunIdAtom = recoverRunAction.pendingTarget;

/**
 * The last run recovery failure. It is separate from the session error because
 * the run detail view renders it next to the run rather than in the shell, and
 * it empties the moment the next attempt starts — the explicit "clear it first"
 * write every recovery opened with.
 */
export const runRecoveryFailureAtom = actionErrorAtom(
  recoverRunAction.result,
  "issues/recoveryFailure",
);

/**
 * One run's edit / delete / recovery flags, for the views that only ever ask
 * about the run they are already rendering. Reading these instead of comparing
 * the id above keeps a mutation of one run from committing another run's view.
 */
export const runIsUpdatingAtom = Atom.family((runId: string) =>
  Atom.map(updatingIssueIdAtom, (pending) => pending === runId).pipe(
    Atom.withLabel(`issues/${runId}/isUpdating`),
  ),
);

/** {@link runIsUpdatingAtom} for a deletion or transfer. */
export const runIsDeletingAtom = Atom.family((runId: string) =>
  Atom.map(deletingIssueIdAtom, (pending) => pending === runId).pipe(
    Atom.withLabel(`issues/${runId}/isDeleting`),
  ),
);

/** {@link runIsUpdatingAtom} for a retry, cancel, resume, rework or move. */
export const runIsRecoveringAtom = Atom.family((runId: string) =>
  Atom.map(recoveringRunIdAtom, (pending) => pending === runId).pipe(
    Atom.withLabel(`issues/${runId}/isRecovering`),
  ),
);
