import { useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { leaveOrganizationInvitationRoute } from "../../lib/organization-invitation";
import { CompanionEmptyState } from "../CompanionHeader";
import { SessionLoadingScreen } from "../SessionLoadingScreen";
import { LoginScreenWithSession } from "./LoginScreenWithSession";
import { useOrganizationActions } from "../../state/organization/actions";
import { companionMode, webMode } from "../../state/platform";
import { appErrorAtom } from "../../state/app-error";
import { useSessionActions } from "../../state/session/actions";
import {
  loadingAtom,
  loginCodeAtom,
  restoringSessionAtom,
  userAtom,
} from "../../state/session/atoms";
import { teamsAtom } from "../../state/team/atoms";

/*
  Everything that can stand between a cold start and the shell.

  The order is a contract: the restore gate first so no screen flashes the login
  form at a user who is already signed in, then the invitation route, then the
  first-run onboarding, then sign-in, and only then the "you have no
  organization yet" setup. The companion shell honours the first four only while
  signed out — a signed-in companion goes straight to its own screens, and shows
  the empty state instead of the desktop's organization setup.

  Every gate reads the session from the store and signs in through the session
  actions; what it takes as props is the three flags the shell derives from
  onboarding storage and the invitation flow's own callbacks.
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
  showsFirstOrganizationSetup,
  showsInitialOnboarding,
}: AuthGateProps) {
  const { locale } = useI18n();
  const user = useAtomValue(userAtom);
  const teams = useAtomValue(teamsAtom);
  const loading = useAtomValue(loadingAtom);
  const loginCode = useAtomValue(loginCodeAtom);
  const restoringSession = useAtomValue(restoringSessionAtom);
  const error = useAtomValue(appErrorAtom);
  const { addOrganization, checkOrganizationHandle } = useOrganizationActions();
  const {
    cancelLogin,
    login,
    logout,
    sendLoginEmailCode,
    verifyLoginEmailCode,
  } = useSessionActions();

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
            onCancelLogin={cancelLogin}
            onLeave={() => {
              leaveOrganizationInvitationRoute();
              window.location.reload();
            }}
            onLogin={(method) => void login({ method, locale })}
            onSendEmailCode={(email) => sendLoginEmailCode(email, locale)}
            onSwitchAccount={async () => {
              await logout();
              await login({ locale, switchAccount: true });
            }}
            onVerifyEmailCode={(email, code) =>
              verifyLoginEmailCode(email, code, locale)}
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
            onCancelLogin={cancelLogin}
            onComplete={onInitialOnboardingComplete}
            onLogin={(method) => void login({ method, locale })}
            onSendEmailCode={(email) => sendLoginEmailCode(email, locale)}
            onVerifyEmailCode={(email, code) =>
              verifyLoginEmailCode(email, code, locale)}
            webMode={webMode}
          />
        </Suspense>
      );
    }
    return (
      <LoginScreenWithSession
        companionMode={companionMode}
        onCancel={cancelLogin}
        onLogin={(method) => void login({ method, locale })}
        onSendEmailCode={(email) => sendLoginEmailCode(email, locale)}
        onVerifyEmailCode={(email, code) =>
          verifyLoginEmailCode(email, code, locale)}
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
      return <CompanionEmptyState onLogout={() => void logout()} />;
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
          onLogout={() => void logout()}
          user={user}
        />
      </Suspense>
    );
  }

  return children;
}
