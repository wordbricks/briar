import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useCallback } from "react";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Registry from "effect/unstable/reactivity/AtomRegistry";

import type { AtomRegistry } from "./registry";

/*
  Request state for the app's write flows.

  Every domain used to track "is this in flight" and "how did it fail" by hand:
  a boolean per flow, an id per flow, a message atom next to it, and a
  `try / catch / finally` in the action that set all three in the right order.
  The combinations that produced were states the UI never meant — an error left
  standing while the retry it belongs to is already running, a flag cleared by
  the *first* of two overlapping calls — and each new flow paid for the same
  three atoms again.

  `Atom.fn` already owns that machine. Its value is an `AsyncResult`: `Initial`
  before the first run, `waiting` while one is going, then `Success` or
  `Failure` — and a re-run carries the previous outcome as `waiting` rather than
  replacing it, which is exactly "keep showing the last result while the next
  attempt runs". So a flow declares an action atom here and derives its flags
  from that one value instead of writing them.

  What does not change is the call contract. Every action still returns a
  promise that resolves with what it always resolved with and rejects with the
  *same `Error` instance* the work threw, because `Effect.tryPromise` keeps it
  as the failure and `Effect.runPromise` squashes a `Fail` cause back to it.
  Callers that `await` an action and toast `caught.message` are untouched.
*/

/** What an action body is given besides its argument. */
export interface ActionContext {
  /**
   * The registry the run was started from. Read state through it rather than
   * through the atom graph: an action is a write, so subscribing it to what it
   * reads would re-run it on every change.
   */
  readonly registry: AtomRegistry;
}

/** The promise-returning work one action performs. */
export type ActionBody<Arg, A> = (
  arg: Arg,
  context: ActionContext,
) => Promise<A>;

/** An action's state, as every reader sees it. */
export type ActionResult<A> = AsyncResult.AsyncResult<A, Error>;

/** An action: one flow's `AsyncResult`, written by running it. */
export type ActionAtom<Arg, A> = Atom.AtomResultFn<Arg, A, Error>;

/** How an action treats overlap and how long it remembers its last run. */
export interface ActionOptions {
  /**
   * Overlapping runs all count as in flight and the atom settles when the last
   * one does. The default, `false`, is what the hand written flags modelled:
   * one run of a flow at a time, a second write replacing the first.
   */
  readonly concurrent?: boolean | undefined;
  /**
   * Keeps the last result after the final reader leaves. Defaults to `true`,
   * because an error the user has not dismissed must survive the button that
   * showed it unmounting. Per-key actions default to `false` instead — see
   * {@link defineActionFamily}.
   */
  readonly keepAlive?: boolean | undefined;
}

/** Anything thrown, as the `Error` the callers of these flows expect. */
const toError = (caught: unknown): Error =>
  caught instanceof Error ? caught : new Error(String(caught));

/**
 * One promise as an effect that fails with **the error the promise rejected
 * with**, untouched.
 *
 * `Effect.tryPromise` would do it, but its `catch` may not hand back a bare
 * `Error` — a tagged error wrapping the original is what it wants — and the
 * whole point here is that the rejection an `await`ing caller sees is
 * unchanged, down to the instance: `Effect.runPromise` squashes a `Fail` cause
 * back to its error, so this is what makes "the action still rejects with the
 * message it always did" true rather than approximately true.
 */
const fromPromise = <A>(start: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.callback<A, Error>((resume) => {
    const fail = (caught: unknown) => resume(Effect.fail(toError(caught)));
    try {
      start().then((value) => resume(Effect.succeed(value)), fail);
    } catch (caught) {
      fail(caught);
    }
  });

/**
 * Declares one write flow's request state.
 *
 * The returned atom is the flow's `AsyncResult`. Views subscribe to it (or to
 * something derived from it — {@link actionPendingAtom},
 * {@link actionErrorAtom}); callers run it with {@link runAction} from registry
 * code or {@link useAction} from a component.
 */
export function defineAction<Arg, A>(
  label: string,
  body: ActionBody<Arg, A>,
  options: ActionOptions = {},
): ActionAtom<Arg, A> {
  const atom = Atom.fn<Arg>()(
    (arg, get) => fromPromise(() => body(arg, { registry: get.registry })),
    { concurrent: options.concurrent },
  ).pipe(Atom.withLabel(label));
  return options.keepAlive === false ? atom : atom.pipe(Atom.keepAlive);
}

/**
 * {@link defineAction} once per key, so one run's pending state cannot wake the
 * views watching another's.
 *
 * The per-key atoms are not kept alive: the key space is the id space (runs,
 * teams, channels), and a key nobody is watching any more should be collectable
 * — `Atom.family` holds them weakly for exactly that reason.
 */
export function defineActionFamily<Arg, A>(
  label: string,
  body: (key: string, arg: Arg, context: ActionContext) => Promise<A>,
  options: ActionOptions = {},
): (key: string) => ActionAtom<Arg, A> {
  return Atom.family((key: string) =>
    defineAction<Arg, A>(
      `${label}/${key}`,
      (arg, context) => body(key, arg, context),
      { ...options, keepAlive: options.keepAlive ?? false },
    ),
  );
}

/**
 * Runs an action from registry code and resolves with what it returned.
 *
 * The mount is what keeps the run alive while nothing is watching it: an atom
 * with no readers is disposed, and disposing the node interrupts the fiber
 * underneath it. It is released once the run settles, so a per-key action
 * outlives its call only while a view is actually reading it.
 */
export function runAction<Arg, A>(
  registry: AtomRegistry,
  atom: ActionAtom<Arg, A>,
  arg: Arg,
): Promise<A> {
  const release = registry.mount(atom);
  registry.set(atom, arg);
  return Effect.runPromise(
    Registry.getResult(registry, atom, { suspendOnWaiting: true }),
  ).finally(release);
}

/** Forgets an action's last run, putting it back to `Initial`. */
export function resetAction<Arg, A>(
  registry: AtomRegistry,
  atom: ActionAtom<Arg, A>,
): void {
  registry.set(atom, Atom.Reset);
}

/**
 * An action bound to the surrounding registry: the runner and the current
 * `AsyncResult`, so a button can both start the flow and disable itself while
 * it runs.
 */
export function useAction<Arg, A>(
  atom: ActionAtom<Arg, A>,
): readonly [run: (arg: Arg) => Promise<A>, result: ActionResult<A>] {
  const result = useAtomValue(atom);
  const set = useAtomSet(atom, { mode: "promise" });
  const run = useCallback((arg: Arg) => set(arg), [set]);
  return [run, result];
}

/** A run is in flight. */
export const actionIsWaiting = (result: ActionResult<unknown>): boolean =>
  AsyncResult.isWaiting(result);

/**
 * How the last *settled* run failed, or `null`.
 *
 * A re-run keeps the previous failure and only marks it `waiting`, which is
 * what lets a panel hold the last error on screen; a view that shows the error
 * as "what went wrong just now" wants it gone the moment the retry starts, so
 * the waiting case reads as no error. An interrupted run has no failure of its
 * own and reads the same way.
 */
export const actionError = (result: ActionResult<unknown>): Error | null =>
  AsyncResult.isFailure(result) && !result.waiting
    ? Option.getOrNull(AsyncResult.error(result))
    : null;

/** {@link actionError} as the message the views render. */
export const actionErrorMessage = (
  result: ActionResult<unknown>,
): string | null => actionError(result)?.message ?? null;

/** An action's "is it running" as an atom, for views that read only that. */
export function actionPendingAtom<Arg, A>(
  atom: ActionAtom<Arg, A>,
  label: string,
): Atom.Atom<boolean> {
  return Atom.map(atom, actionIsWaiting).pipe(
    Atom.keepAlive,
    Atom.withLabel(label),
  );
}

/** An action's last settled failure message as an atom. */
export function actionErrorAtom<Arg, A>(
  atom: ActionAtom<Arg, A>,
  label: string,
): Atom.Atom<string | null> {
  return Atom.map(atom, actionErrorMessage).pipe(
    Atom.keepAlive,
    Atom.withLabel(label),
  );
}

/*
  Actions whose work lives in a `createXxxActions(registry, deps)` factory.

  Those bodies close over the injected api and the demo flag, so they cannot be
  written at module scope — but the request state has to be at module scope,
  because that is where the views import it from. A task action splits the two:
  the atom owns the state machine and the factory hands it the already-bound
  closure as the argument. The target the run is about travels with it, which is
  what the id-shaped flags ("which issue is being deleted") are derived from.
*/

/** One run of a task action: what it is about, and the work. */
export interface ActionTask<A> {
  /** The id the pending state names, or `null` for a flow with no target. */
  readonly target: string | null;
  /** The work, already bound to its inputs. */
  readonly run: () => Promise<A>;
}

/** A task action's atom. The result type is per call, so the atom's is opaque. */
export type TaskActionAtom = ActionAtom<ActionTask<unknown>, unknown>;

/** One flow's request state, when the work comes from an action factory. */
export interface TaskAction {
  /** The `AsyncResult` of the last run. */
  readonly result: TaskActionAtom;
  /**
   * The target of the run in flight, or `null` between runs. It is derived —
   * the id is remembered when the run starts and stops being visible the moment
   * the result stops waiting — so no flow has to clear it.
   */
  readonly pendingTarget: Atom.Atom<string | null>;
  /** Written by {@link runTask} only. @internal */
  readonly lastTarget: Atom.Writable<string | null, string | null>;
}

/** Declares one write flow whose work is bound by an action factory. */
export function defineTaskAction(
  label: string,
  options: ActionOptions = {},
): TaskAction {
  const result: TaskActionAtom = defineAction<ActionTask<unknown>, unknown>(
    label,
    (task) => task.run(),
    options,
  );
  const lastTarget = Atom.make<string | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`${label}/lastTarget`),
  );
  const pendingTarget = Atom.make((get): string | null =>
    AsyncResult.isWaiting(get(result)) ? get(lastTarget) : null,
  ).pipe(Atom.keepAlive, Atom.withLabel(`${label}/pendingTarget`));
  return { result, pendingTarget, lastTarget };
}

/**
 * Runs one task action and resolves with what the work returned.
 *
 * The target is written before the run starts so that the pending id is
 * readable in the same tick the flag turns on, the way the hand written
 * "mark it in flight" call was.
 */
export function runTask<A>(
  registry: AtomRegistry,
  action: TaskAction,
  target: string | null,
  run: () => Promise<A>,
): Promise<A> {
  registry.set(action.lastTarget, target);
  return runAction(registry, action.result, {
    target,
    run,
  } satisfies ActionTask<A>) as Promise<A>;
}
