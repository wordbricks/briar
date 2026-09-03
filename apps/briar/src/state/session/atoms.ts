import * as Atom from "effect/unstable/reactivity/Atom";

import type { SessionUser } from "../../types";
import { demoUser } from "../demo-fixtures";
import { demoMode } from "../platform";

/*
  Session-lifetime state: who is signed in, the credential their requests are
  made with, and the three flags the sign-in screens render from.

  Every atom here is `keepAlive` because the app's `RegistryProvider` runs
  without a `defaultIdleTTL`: an atom whose last subscriber unmounts would
  otherwise be dropped and rebuilt from its initial value, which would sign the
  user out the moment the last view reading `userAtom` unmounted.
*/

/** The signed-in account, or `null` while signed out. */
export const userAtom = Atom.make<SessionUser | null>(
  demoMode ? demoUser : null,
).pipe(Atom.keepAlive, Atom.withLabel("session/user"));

/**
 * The credential every authenticated request carries. Demo mode never gets one,
 * so `demoMode` code paths branch on the absence of a token.
 */
export const tokenAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("session/token"),
);

/**
 * True until the stored token has been exchanged for a session (or found to be
 * absent). It gates the app on a cold start so no screen flashes the login
 * form at a user who is already signed in.
 */
export const restoringSessionAtom = Atom.make(!demoMode).pipe(
  Atom.keepAlive,
  Atom.withLabel("session/restoring"),
);

/** A sign-in or account request is in flight. */
export const loadingAtom = Atom.make(!demoMode).pipe(
  Atom.keepAlive,
  Atom.withLabel("session/loading"),
);

/** The device-authorization user code to read out, while one is pending. */
export const loginCodeAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("session/loginCode"),
);

/**
 * The last session-scoped error message. The `useBriar` facade still merges it
 * with the local project inventory error under its `error` key, so this atom
 * holds only the half the session owns.
 */
export const sessionErrorAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("session/error"),
);
