import * as Atom from "effect/unstable/reactivity/Atom";

import { sessionErrorAtom } from "./session/atoms";
import { localInventoryErrorAtom } from "./workspace/atoms";

/**
 * The one error line the app shows.
 *
 * It is the sum the facade's `error` key was: whatever the session last failed
 * at, and otherwise whatever inspecting the device's local checkouts failed at.
 * The sign-in screens, both shells and the board all render it the same way, so
 * they read it here instead of each recomputing the same `??`.
 */
export const appErrorAtom = Atom.make(
  (get): string | null =>
    get(sessionErrorAtom) ?? get(localInventoryErrorAtom),
).pipe(Atom.keepAlive, Atom.withLabel("app/error"));
