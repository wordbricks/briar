import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps, ReactNode } from "react";

import {
  loadingAtom,
  loginCodeAtom,
  sessionErrorAtom,
} from "../../state/session/atoms";
import { LoginScreen } from "../LoginScreen";

export interface LoginSessionState {
  readonly error: string | null;
  readonly loading: boolean;
  readonly loginCode: string | null;
}

/**
 * Subscribes to the three session atoms the sign-in screens render from, so a
 * login poll tick reaches only the login screen and not the app shell that
 * renders it.
 */
export function LoginSessionBoundary({
  children,
}: {
  children: (session: LoginSessionState) => ReactNode;
}) {
  const error = useAtomValue(sessionErrorAtom);
  const loading = useAtomValue(loadingAtom);
  const loginCode = useAtomValue(loginCodeAtom);
  return children({ error, loading, loginCode });
}

/**
 * `LoginScreen` wired to the session atoms.
 *
 * The `useBriar` facade's `error` key merges the session error with the local
 * team inventory error; only the session half is read here, because the
 * inventory error is written after a session is restored and cleared on the way
 * out, so it is always `null` while the login screen is the visible content.
 */
export function LoginScreenWithSession(
  props: Omit<
    ComponentProps<typeof LoginScreen>,
    "error" | "loading" | "loginCode"
  >,
) {
  return (
    <LoginSessionBoundary>
      {(session) => <LoginScreen {...props} {...session} />}
    </LoginSessionBoundary>
  );
}
