import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  acceptOrganizationInvitation as acceptRemoteOrganizationInvitation,
  beginDeviceAuthorization,
  deleteAccount as deleteRemoteAccount,
  pollDeviceToken,
  updateAccountProfile as updateRemoteAccountProfile,
  type DeviceAuthorizationLaunchOptions,
} from "../../lib/api";
import { resolveActiveAccountSelection } from "../../lib/active-organization";
import {
  isAuthorizationCancelled,
  openAuthorization,
} from "../../lib/auth-session";
import {
  browserAuthClient,
  type BrowserAuthLocale,
} from "../../lib/browser-auth-client";
import { deleteAndroidPushRegistration } from "../../lib/inbox-notifications";
import type { LocalProjectInventoryObservation } from "../../lib/local-team-connection";
import { browserCookieSessionCredential } from "../../lib/session-credential";
import { disconnectLocalTeam } from "../../lib/team-connection";
import { clearSessionToken, writeSessionToken } from "../../lib/token-store";
import type { Organization, Project, SessionUser } from "../../types";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import {
  demoMode,
  deviceClientId,
  lockedTeamIdAtom,
  remoteMode,
  webMode,
} from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import {
  bumpReconnectRequest,
  getReadinessCoordinator,
} from "../workspace/api";
import {
  applyInventoryObservation,
  clearWorkspaceInventory,
  resetHealth,
} from "../workspace/atoms";
import { clearSnapshotAccount } from "../persistence/account";
import { hydratedAccountAtom } from "../persistence/hydration";
import { clearSnapshotsSafely } from "../persistence/store";
import { applySyncEvent } from "../sync/apply";
import {
  activeTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../team/atoms";
import { resolveSessionApi } from "./api";
import {
  loadingAtom,
  loginCodeAtom,
  sessionErrorAtom,
  tokenAtom,
  userAtom,
} from "./atoms";

/**
 * Remote and local writes the session actions perform. The reads live in
 * `./api` because the bootstrap effect and the sync loader share them; these
 * are the calls only a signing-in or signing-out user makes.
 */
export interface SessionActionApi {
  readonly acceptOrganizationInvitation: typeof acceptRemoteOrganizationInvitation;
  readonly beginDeviceAuthorization: typeof beginDeviceAuthorization;
  readonly clearSessionToken: typeof clearSessionToken;
  readonly deleteAccount: typeof deleteRemoteAccount;
  readonly deleteAndroidPushRegistration: typeof deleteAndroidPushRegistration;
  readonly disconnectLocalTeam: typeof disconnectLocalTeam;
  readonly openAuthorization: typeof openAuthorization;
  readonly pollDeviceToken: typeof pollDeviceToken;
  readonly sendEmailOtp: (
    email: string,
    locale: BrowserAuthLocale,
  ) => Promise<unknown>;
  readonly signInWithEmailOtp: (input: {
    email: string;
    locale: BrowserAuthLocale;
    otp: string;
  }) => Promise<unknown>;
  readonly signInWithGoogle: (input: {
    callbackURL: string;
    locale: BrowserAuthLocale;
  }) => Promise<unknown>;
  readonly signOutBrowserSession: () => Promise<unknown>;
  readonly updateAccountProfile: typeof updateRemoteAccountProfile;
  readonly writeSessionToken: typeof writeSessionToken;
}

export const liveSessionActionApi: SessionActionApi = {
  acceptOrganizationInvitation: acceptRemoteOrganizationInvitation,
  beginDeviceAuthorization,
  clearSessionToken,
  deleteAccount: deleteRemoteAccount,
  deleteAndroidPushRegistration,
  disconnectLocalTeam,
  openAuthorization,
  pollDeviceToken,
  sendEmailOtp: (email, locale) => browserAuthClient.sendEmailOTP(email, locale),
  signInWithEmailOtp: (input) => browserAuthClient.signInWithEmailOTP(input),
  signInWithGoogle: (input) => browserAuthClient.signInWithGoogle(input),
  signOutBrowserSession: () => browserAuthClient.signOut(),
  updateAccountProfile: updateRemoteAccountProfile,
  writeSessionToken,
};

export interface SessionActionDeps {
  readonly api?: Partial<SessionActionApi> | undefined;
}

/*
  Device-authorization polling state.

  It was three refs on `useBriar` — the pending timer, a "poll right now" hook
  for the companion's auth-return event, and an attempt counter that every async
  continuation compares itself against so a cancelled or superseded sign-in
  cannot commit. Refs are gone with the facade, so the three live per registry:
  the actions are rebuilt whenever a component memoises them, and an attempt
  counter that resets with them would let a cancelled poll commit.
*/
interface LoginPollState {
  timer: number | null;
  pollNow: (() => void) | null;
  attempt: number;
}

const loginPolls = new WeakMap<AtomRegistry, LoginPollState>();

const loginPollState = (registry: AtomRegistry): LoginPollState => {
  let state = loginPolls.get(registry);
  if (!state) {
    state = { timer: null, pollNow: null, attempt: 0 };
    loginPolls.set(registry, state);
  }
  return state;
};

/**
 * Runs the pending device-authorization poll immediately instead of waiting out
 * its timer. The companion app calls this when the browser hands control back,
 * which is the moment the code was most likely just approved.
 */
export function pollLoginNow(registry: AtomRegistry): void {
  const state = loginPollState(registry);
  if (state.timer !== null) {
    window.clearTimeout(state.timer);
    state.timer = null;
  }
  state.pollNow?.();
}

export interface AccountProfileInput {
  readonly username: string | null;
  readonly name: string;
  readonly image: string | null;
}

export interface SessionActions {
  /** Joins the organization an invitation token names and opens its team. */
  readonly acceptInvitation: (
    invitationToken: string,
  ) => Promise<Awaited<ReturnType<typeof acceptRemoteOrganizationInvitation>>>;
  /** Abandons a sign-in in progress and clears what it put on screen. */
  readonly cancelLogin: () => void;
  /** Exchanges a credential for a session and selects what it can open. */
  readonly completeLogin: (token: string, attempt: number) => Promise<void>;
  readonly deleteAccount: (confirmation: string) => Promise<void>;
  readonly login: (
    options?: DeviceAuthorizationLaunchOptions,
  ) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly sendLoginEmailCode: (
    email: string,
    locale: BrowserAuthLocale,
  ) => Promise<void>;
  readonly updateAccountProfile: (
    input: AccountProfileInput,
  ) => Promise<SessionUser>;
  readonly verifyLoginEmailCode: (
    email: string,
    otp: string,
    locale: BrowserAuthLocale,
  ) => Promise<void>;
}

/**
 * Everything a sign-out, an account deletion and a boot that cannot prove its
 * account clear in common. Batched so subscribers observe one transition
 * instead of eight.
 *
 * It is module level because the third caller is not an action: the session
 * bootstrap discards a hydrated snapshot through this when the account it
 * restored is not the one the snapshot belongs to.
 */
export function clearSignedOutSession(registry: AtomRegistry): void {
  Atom.batch(() => {
    registry.set(tokenAtom, null);
    registry.set(userAtom, null);
    registry.set(teamsAtom, []);
    registry.set(organizationsAtom, []);
    registry.set(activeOrganizationIdAtom, null);
    registry.set(activeTeamIdAtom, null);
    registry.set(teamConnectionAtom, null);
    registry.set(isCreatingTeamAtom, false);
    // The entity store is session scoped: nothing the previous account
    // loaded may outlive its token.
    applySyncEvent(registry, { kind: "session-cleared" });
    registry.set(hydratedAccountAtom, null);
  });
  /*
    …and so is the stored snapshot. This is the one place a sign-out and an
    account deletion agree on, so it is where the persisted copy of what was
    just cleared is dropped too: the next cold start on this device must not
    re-render the account that signed out.
  */
  clearSnapshotAccount();
  void clearSnapshotsSafely(registry);
}

/**
 * Session actions bound to one registry. They read the current state through
 * `registry.get`, so they need no dependency array and stay stable for the
 * registry's lifetime.
 */
export function createSessionActions(
  registry: AtomRegistry,
  deps: SessionActionDeps = {},
): SessionActions {
  const api: SessionActionApi = { ...liveSessionActionApi, ...deps.api };
  const poll = loginPollState(registry);

  const setError = (message: string | null) =>
    registry.set(sessionErrorAtom, message);
  const messageOf = (caught: unknown) =>
    caught instanceof Error ? caught.message : String(caught);

  const clearSessionState = () => clearSignedOutSession(registry);

  const clearLoginTimer = () => {
    if (poll.timer === null) return;
    window.clearTimeout(poll.timer);
    poll.timer = null;
  };

  const cancelLogin = () => {
    poll.attempt += 1;
    clearLoginTimer();
    poll.pollNow = null;
    Atom.batch(() => {
      registry.set(loginCodeAtom, null);
      registry.set(loadingAtom, false);
      setError(null);
    });
  };

  /**
   * The local project inventory as the session sees it. A remote build has no
   * local checkouts to inspect, so it reports an empty, loaded inventory rather
   * than asking the coordinator.
   */
  const inspectInventory = async (): Promise<LocalProjectInventoryObservation> =>
    remoteMode
      ? { status: "loaded", connectedTeamIds: null, error: null }
      : await getReadinessCoordinator(registry).inspectInventory();

  /**
   * Commits a restored or freshly signed-in account and picks what it opens:
   * the pinned team in a project window, otherwise the stored organization.
   * One batch, so no subscriber sees a user without their teams.
   */
  const commitAccount = (
    token: string,
    user: SessionUser,
    teams: Project[],
    organizations: Organization[],
    inventory: LocalProjectInventoryObservation,
  ) => {
    const selection = resolveActiveAccountSelection(
      user.id,
      organizations,
      teams,
      registry.get(lockedTeamIdAtom),
    );
    Atom.batch(() => {
      registry.set(tokenAtom, token);
      registry.set(userAtom, user);
      registry.set(teamsAtom, teams);
      registry.set(organizationsAtom, organizations);
      applyInventoryObservation(registry, inventory);
      registry.set(activeOrganizationIdAtom, selection.activeOrganizationId);
      registry.set(activeTeamIdAtom, selection.activeProjectId);
    });
  };

  const completeLogin = async (nextToken: string, attempt: number) => {
    const remote = resolveSessionApi(registry);
    const [nextUser, nextTeams, nextOrganizations] = await Promise.all([
      remote.loadSession(nextToken),
      remote.loadTeams(nextToken),
      remote.loadOrganizations(nextToken),
    ]);
    const inventory = await inspectInventory();
    if (attempt !== poll.attempt) return;
    if (nextToken === browserCookieSessionCredential) {
      await api.clearSessionToken();
    } else {
      await api.writeSessionToken(nextToken);
    }
    // Awaiting the token write gave a cancellation another chance to land, and
    // a credential stored for an abandoned attempt has to be taken back.
    if (attempt !== poll.attempt) {
      if (nextToken === browserCookieSessionCredential) {
        await api.signOutBrowserSession();
      } else {
        await api.clearSessionToken();
      }
      return;
    }
    commitAccount(nextToken, nextUser, nextTeams, nextOrganizations, inventory);
    Atom.batch(() => {
      registry.set(teamConnectionAtom, null);
      setError(null);
      registry.set(loginCodeAtom, null);
      registry.set(loadingAtom, false);
    });
    poll.pollNow = null;
  };

  return {
    async acceptInvitation(invitationToken) {
      bumpReconnectRequest(registry);
      const token = registry.get(tokenAtom);
      if (!token) throw new Error("로그인이 필요합니다.");
      registry.set(loadingAtom, true);
      setError(null);
      try {
        const remote = resolveSessionApi(registry);
        const result = await api.acceptOrganizationInvitation(
          token,
          invitationToken,
        );
        const [nextOrganizations, nextTeams] = await Promise.all([
          remote.loadOrganizations(token),
          remote.loadTeams(token),
        ]);
        Atom.batch(() => {
          registry.set(organizationsAtom, nextOrganizations);
          registry.set(teamsAtom, nextTeams);
          registry.set(
            activeOrganizationIdAtom,
            result.invitation.organizationId,
          );
          registry.set(activeTeamIdAtom, result.invitation.initialProjectId);
          // A joined team starts from the server, never from anything this
          // account happened to have stored for that id.
          applySyncEvent(registry, {
            kind: "team-cleared",
            teamId: result.invitation.initialProjectId,
          });
        });
        resetHealth(registry);
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        registry.set(loadingAtom, false);
      }
    },

    cancelLogin,

    completeLogin,

    async login(options = {}) {
      const attempt = ++poll.attempt;
      clearLoginTimer();
      Atom.batch(() => {
        registry.set(loadingAtom, true);
        setError(null);
      });
      try {
        if (webMode) {
          if (options.method === "google") {
            await api.signInWithGoogle({
              callbackURL: window.location.href,
              locale: options.locale ?? "en",
            });
            return;
          }
          registry.set(loadingAtom, false);
          return;
        }
        const authorization = await api.beginDeviceAuthorization(
          deviceClientId,
          options,
        );
        if (attempt !== poll.attempt) return;
        registry.set(loginCodeAtom, authorization.userCode);
        await api.openAuthorization(authorization.verificationUrl);
        if (attempt !== poll.attempt) return;
        let delay = authorization.interval * 1_000;
        const runPoll = async () => {
          poll.timer = null;
          if (attempt !== poll.attempt) return;
          try {
            const result = await api.pollDeviceToken(
              authorization.deviceCode,
              deviceClientId,
            );
            if (attempt !== poll.attempt) return;
            if (result.access_token) {
              await completeLogin(result.access_token, attempt);
              return;
            }
            if (result.error === "slow_down") delay += 5_000;
            if (
              result.error === "access_denied" ||
              result.error === "expired_token"
            ) {
              throw new Error(
                result.error_description ?? "로그인 승인이 종료되었습니다.",
              );
            }
            if (attempt !== poll.attempt) return;
            poll.timer = window.setTimeout(() => void runPoll(), delay);
          } catch (caught) {
            if (attempt !== poll.attempt) return;
            Atom.batch(() => {
              setError(messageOf(caught));
              registry.set(loadingAtom, false);
              registry.set(loginCodeAtom, null);
            });
            poll.pollNow = null;
          }
        };
        poll.pollNow = () => void runPoll();
        poll.timer = window.setTimeout(() => void runPoll(), delay);
      } catch (caught) {
        if (attempt !== poll.attempt) return;
        if (isAuthorizationCancelled(caught)) {
          Atom.batch(() => {
            registry.set(loginCodeAtom, null);
            registry.set(loadingAtom, false);
          });
          poll.pollNow = null;
          return;
        }
        Atom.batch(() => {
          setError(messageOf(caught));
          registry.set(loadingAtom, false);
        });
        poll.pollNow = null;
      }
    },

    async sendLoginEmailCode(email, locale) {
      Atom.batch(() => {
        registry.set(loadingAtom, true);
        setError(null);
      });
      try {
        await api.sendEmailOtp(email, locale);
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        registry.set(loadingAtom, false);
      }
    },

    async verifyLoginEmailCode(email, otp, locale) {
      const attempt = ++poll.attempt;
      clearLoginTimer();
      Atom.batch(() => {
        registry.set(loadingAtom, true);
        setError(null);
      });
      try {
        await api.signInWithEmailOtp({ email, locale, otp });
        if (attempt !== poll.attempt) {
          await api.signOutBrowserSession();
          return;
        }
        await completeLogin(browserCookieSessionCredential, attempt);
      } catch (caught) {
        if (attempt !== poll.attempt) return;
        Atom.batch(() => {
          setError(messageOf(caught));
          registry.set(loadingAtom, false);
        });
        throw caught;
      }
    },

    async deleteAccount(confirmation) {
      bumpReconnectRequest(registry);
      const token = registry.get(tokenAtom);
      if (!token) throw new Error("로그인이 필요합니다.");
      await api.deleteAccount(token, confirmation);
      await Promise.allSettled(
        registry.get(teamsAtom).map((team) => api.disconnectLocalTeam(team.id)),
      );
      cancelLogin();
      if (webMode && token === browserCookieSessionCredential) {
        await api.signOutBrowserSession().catch(() => undefined);
      }
      await api.clearSessionToken();
      clearWorkspaceInventory(registry);
      clearSessionState();
    },

    async logout() {
      bumpReconnectRequest(registry);
      cancelLogin();
      const token = registry.get(tokenAtom);
      if (token) {
        await api.deleteAndroidPushRegistration(token).catch(() => false);
      }
      if (webMode && token === browserCookieSessionCredential) {
        await api.signOutBrowserSession();
      }
      await api.clearSessionToken();
      clearWorkspaceInventory(registry);
      clearSessionState();
    },

    async updateAccountProfile(input) {
      const user = registry.get(userAtom);
      if (!user) throw new Error("로그인이 필요합니다.");
      const token = registry.get(tokenAtom);
      const nextUser =
        demoMode || !token
          ? { ...user, ...input }
          : await api.updateAccountProfile(token, input);
      registry.set(userAtom, nextUser);
      return nextUser;
    },
  };
}

export function useSessionActions(
  deps: SessionActionDeps = {},
): SessionActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => createSessionActions(registry, { api }),
    [api, registry],
  );
}
