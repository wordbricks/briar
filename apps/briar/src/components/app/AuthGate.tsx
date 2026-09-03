import { useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { leaveOrganizationInvitationRoute } from "../../lib/organization-invitation";
import { CompanionEmptyState } from "../CompanionHeader";
import { SessionLoadingScreen } from "../SessionLoadingScreen";
import { LoginScreenWithSession } from "./LoginScreenWithSession";
import { useOrganizationActions } from "../../state/organization/actions";
import { companionMode, webMode } from "../../state/platform";
import {
  loadingAtom,
  loginCodeAtom,
  restoringSessionAtom,
  sessionErrorAtom,
  userAtom,
} from "../../state/session/atoms";
import { teamsAtom } from "../../state/team/atoms";
import { localInventoryErrorAtom } from "../../state/workspace/atoms";
import type { DeviceAuthorizationLaunchOptions } from "../../lib/api";
import type { BrowserAuthLocale } from "../../lib/browser-auth-client";

/*
  Everything that can stand between a cold start and the shell.

  The order is a contract: the restore gate first so no screen flashes the login
  form at a user who is already signed in, then the invitation route, then the
  first-run onboarding, then sign-in, and only then the "you have no
  organization yet" setup. The companion shell honours the first four only while
  signed out — a signed-in companion goes straight to its own screens, and shows
  the empty state instead of the desktop's organization setup.

  Every gate reads the session from the store; what it takes as props is the
  three flags the shell derives from onboarding storage and the callbacks that
  belong to the session facade.
*/

const FirstOrganizationSetup = lazy(() =>
  import("../FirstOrganizationSetup").then((m) => ({
    default: m.FirstOrganizationSetup,
  })),
);
const InitialOnboarding = lazy(() =>
  import("../InitialOnboarding").then((m) => ({
    default: m.InitialOnboarding,
  })),
);
const InvitationOnboarding = lazy(() =>
  import("../InvitationOnboarding").then((m) => ({
    default: m.InvitationOnboarding,
  })),
);

const lazyViewFallback = <div className="lazy-view-placeholder h-full w-full" />;

/** The sign-in calls the gates make, all still the session facade's. */
export interface AuthGateSession {
  readonly cancelLogin: () => void;
  readonly login: (
    options: DeviceAuthorizationLaunchOptions,
  ) => Promise<unknown>;
  readonly logout: () => Promise<unknown>;
  readonly sendLoginEmailCode: (
    email: string,
    locale: BrowserAuthLocale,
  ) => Promise<void>;
  readonly verifyLoginEmailCode: (
    email: string,
    otp: string,
    locale: BrowserAuthLocale,
  ) => Promise<void>;
}

export interface AuthGateProps {
  /** The invitation token on the URL, or `null`. */
  readonly invitationToken: string | null;
  readonly acceptingInvitation: boolean;
  readonly onAcceptInvitation: () => Promise<void>;
  /** A token pasted into the first-organization setup starts the join screen. */
  readonly onJoinOrganization: (token: string) => void;
  readonly showsInitialOnboarding: boolean;
  readonly onInitialOnboardingComplete: () => void;
  readonly showsFirstOrganizationSetup: boolean;
  /** The first organization was created for this user. */
  readonly onOrganizationCreated: (userId: string) => void;
  readonly session: AuthGateSession;
  /** The shell, rendered once no gate owns the screen. */
  readonly children: ReactNode;
}

export function AuthGate({
  acceptingInvitation,
  children,
  invitationToken,
  onAcceptInvitation,
  onInitialOnboardingComplete,
  onJoinOrganization,
  onOrganizationCreated,
  session,
  showsFirstOrganizationSetup,
  showsInitialOnboarding,
}: AuthGateProps) {
  const { locale } = useI18n();
  const user = useAtomValue(userAtom);
  const teams = useAtomValue(teamsAtom);
  const loading = useAtomValue(loadingAtom);
  const loginCode = useAtomValue(loginCodeAtom);
  const restoringSession = useAtomValue(restoringSessionAtom);
  /*
    The facade's `error` key is this sum: the session's own failures plus the
    local project inventory's, which the sign-in screens render the same way.
  */
  const sessionError = useAtomValue(sessionErrorAtom);
  const inventoryError = useAtomValue(localInventoryErrorAtom);
  const error = sessionError ?? inventoryError;
  const { addOrganization, checkOrganizationHandle } = useOrganizationActions();

  const signedOutGate = () => {
    if (restoringSession) return <SessionLoadingScreen />;
    if (invitationToken) {
      return (
        <Suspense fallback={lazyViewFallback}>
          <InvitationOnboarding
            accepting={acceptingInvitation}
            error={error}
            loading={loading}
            loginCode={loginCode}
            onAccept={onAcceptInvitation}
            onCancelLogin={session.cancelLogin}
            onLeave={() => {
              leaveOrganizationInvitationRoute();
              window.location.reload();
            }}
            onLogin={(method) => void session.login({ method, locale })}
            onSendEmailCode={(email) => session.sendLoginEmailCode(email, locale)}
            onSwitchAccount={async () => {
              await session.logout();
              await session.login({ locale, switchAccount: true });
            }}
            onVerifyEmailCode={(email, code) =>
              session.verifyLoginEmailCode(email, code, locale)}
            token={invitationToken}
            user={user}
            webMode={webMode}
          />
        </Suspense>
      );
    }
    if (showsInitialOnboarding) {
      return (
        <Suspense fallback={lazyViewFallback}>
          <InitialOnboarding
            authenticated={Boolean(user)}
            error={error}
            loading={loading}
            loginCode={loginCode}
            onCancelLogin={session.cancelLogin}
            onComplete={onInitialOnboardingComplete}
            onLogin={(method) => void session.login({ method, locale })}
            onSendEmailCode={(email) => session.sendLoginEmailCode(email, locale)}
            onVerifyEmailCode={(email, code) =>
              session.verifyLoginEmailCode(email, code, locale)}
            webMode={webMode}
          />
        </Suspense>
      );
    }
    return (
      <LoginScreenWithSession
        companionMode={companionMode}
        onCancel={session.cancelLogin}
        onLogin={(method) => void session.login({ method, locale })}
        onSendEmailCode={(email) => session.sendLoginEmailCode(email, locale)}
        onVerifyEmailCode={(email, code) =>
          session.verifyLoginEmailCode(email, code, locale)}
        webMode={webMode}
      />
    );
  };

  if (companionMode) {
    /*
      A signed-in companion never sees the desktop gates: it went past them
      before this branch, and its own "nothing to show yet" screen is the empty
      state rather than the organization setup.
    */
    if (!user) return signedOutGate();
    if (teams.length === 0) {
      return <CompanionEmptyState onLogout={() => void session.logout()} />;
    }
    return children;
  }

  if (restoringSession || invitationToken || showsInitialOnboarding || !user) {
    return signedOutGate();
  }

  if (showsFirstOrganizationSetup) {
    return (
      <Suspense fallback={lazyViewFallback}>
        <FirstOrganizationSetup
          onCheckHandle={checkOrganizationHandle}
          onCreate={async (input) => {
            await addOrganization(input);
            onOrganizationCreated(user.id);
          }}
          onJoin={onJoinOrganization}
          onLogout={() => void session.logout()}
          user={user}
        />
      </Suspense>
    );
  }

  return children;
}
