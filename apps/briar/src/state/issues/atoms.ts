import * as Atom from "effect/unstable/reactivity/Atom";

import type { AtomRegistry } from "../registry";

/*
  Which issue mutation is in flight, and what the last recovery attempt said.

  `useBriar` kept four independent booleans and ids — `isCreatingIssue`,
  `updatingIssueId`, `deletingIssueId`, `recoveringRunId` — which could describe
  states that cannot happen: one run being deleted while another is edited, from
  a UI that disables both. One discriminated union says the same thing without
  the impossible combinations, and the views derive the four flags back out of
  it so their prop contracts are untouched.
*/

/** The single issue mutation currently in flight, if any. */
export type PendingIssueMutation =
  /** An issue is being created; no run exists to point at yet. */
  | { readonly kind: "creating" }
  /** One issue's fields, relations or checkpoints are being written. */
  | { readonly kind: "updating"; readonly runId: string }
  /** One issue is being deleted or transferred out of the team. */
  | { readonly kind: "deleting"; readonly runId: string }
  /** One run is being retried, cancelled, resumed, reworked or moved. */
  | { readonly kind: "recovering"; readonly runId: string };

/** The mutation in flight, or `null` when nothing is pending. */
export const pendingIssueMutationAtom =
  Atom.make<PendingIssueMutation | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("issues/pendingMutation"),
  );

/**
 * The last run recovery failure. It is separate from the session error because
 * the run detail view renders it next to the run rather than in the shell.
 */
export const recoveryErrorAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("issues/recoveryError"),
);

/** An issue creation is in flight. */
export const isCreatingIssueAtom = Atom.map(
  pendingIssueMutationAtom,
  (pending) => pending?.kind === "creating",
).pipe(Atom.keepAlive, Atom.withLabel("issues/isCreating"));

/** The issue being edited, or `null`. */
export const updatingIssueIdAtom = Atom.map(
  pendingIssueMutationAtom,
  (pending) => (pending?.kind === "updating" ? pending.runId : null),
).pipe(Atom.keepAlive, Atom.withLabel("issues/updatingId"));

/** The issue being deleted or transferred, or `null`. */
export const deletingIssueIdAtom = Atom.map(
  pendingIssueMutationAtom,
  (pending) => (pending?.kind === "deleting" ? pending.runId : null),
).pipe(Atom.keepAlive, Atom.withLabel("issues/deletingId"));

/** The run being recovered, resumed, reworked or moved, or `null`. */
export const recoveringRunIdAtom = Atom.map(
  pendingIssueMutationAtom,
  (pending) => (pending?.kind === "recovering" ? pending.runId : null),
).pipe(Atom.keepAlive, Atom.withLabel("issues/recoveringRunId"));

/**
 * Marks `mutation` as in flight and returns the function that ends it.
 *
 * The end function clears the atom only while it still holds *this* mutation,
 * which keeps the four independent flags' behaviour: a second action that
 * started while the first was still running owns the marker, and the first
 * one finishing does not blank it out from under it.
 */
export function beginIssueMutation(
  registry: AtomRegistry,
  mutation: PendingIssueMutation,
): () => void {
  registry.set(pendingIssueMutationAtom, mutation);
  return () => {
    if (registry.get(pendingIssueMutationAtom) === mutation) {
      registry.set(pendingIssueMutationAtom, null);
    }
  };
}
