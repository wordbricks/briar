import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  deleteAccount as deleteRemoteAccount,
  updateAccountProfile as updateRemoteAccountProfile,
} from "../../lib/api";
import { browserAuthClient } from "../../lib/browser-auth-client";
import { deleteAndroidPushRegistration } from "../../lib/inbox-notifications";
import { browserCookieSessionCredential } from "../../lib/session-credential";
import { disconnectLocalTeam } from "../../lib/team-connection";
import { clearSessionToken } from "../../lib/token-store";
import type { SessionUser } from "../../types";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { demoMode, webMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { bumpReconnectRequest } from "../workspace/api";
import { clearWorkspaceInventory } from "../workspace/atoms";
import { applySyncEvent } from "../sync/apply";
import {
  activeTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../team/atoms";
import { tokenAtom, userAtom } from "./atoms";

/** Remote and local writes the session actions perform. */
export interface SessionActionApi {
  readonly clearSessionToken: typeof clearSessionToken;
  readonly deleteAccount: typeof deleteRemoteAccount;
  readonly deleteAndroidPushRegistration: typeof deleteAndroidPushRegistration;
  readonly disconnectLocalTeam: typeof disconnectLocalTeam;
  readonly signOutBrowserSession: () => Promise<unknown>;
  readonly updateAccountProfile: typeof updateRemoteAccountProfile;
}

export const liveSessionActionApi: SessionActionApi = {
  clearSessionToken,
  deleteAccount: deleteRemoteAccount,
  deleteAndroidPushRegistration,
  disconnectLocalTeam,
  signOutBrowserSession: () => browserAuthClient.signOut(),
  updateAccountProfile: updateRemoteAccountProfile,
};

/**
 * The one part of a sign-out these actions do not own: `useBriar` still holds
 * the device-authorization poll timers, so it supplies the canceller here
 * instead of these actions reaching back into React.
 */
export interface SessionActionDeps {
  readonly api?: Partial<SessionActionApi> | undefined;
  /** Stops device-authorization polling and clears its transient state. */
  readonly cancelLogin: () => void;
}

export interface AccountProfileInput {
  readonly username: string | null;
  readonly name: string;
  readonly image: string | null;
}

export interface SessionActions {
  readonly deleteAccount: (confirmation: string) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly updateAccountProfile: (
    input: AccountProfileInput,
  ) => Promise<SessionUser>;
}

/**
 * Session actions bound to one registry. They read the current state through
 * `registry.get`, so they need no dependency array and stay stable for the
 * registry's lifetime.
 */
export function createSessionActions(
  registry: AtomRegistry,
  deps: SessionActionDeps,
): SessionActions {
  const api: SessionActionApi = { ...liveSessionActionApi, ...deps.api };

  /**
   * Everything a sign-out and an account deletion clear in common. Batched so
   * subscribers observe one transition instead of eight.
   */
  const clearSessionState = () => {
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
    });
  };

  return {
    async deleteAccount(confirmation) {
      bumpReconnectRequest(registry);
      const token = registry.get(tokenAtom);
      if (!token) throw new Error("로그인이 필요합니다.");
      await api.deleteAccount(token, confirmation);
      await Promise.allSettled(
        registry.get(teamsAtom).map((team) => api.disconnectLocalTeam(team.id)),
      );
      deps.cancelLogin();
      if (webMode && token === browserCookieSessionCredential) {
        await api.signOutBrowserSession().catch(() => undefined);
      }
      await api.clearSessionToken();
      clearWorkspaceInventory(registry);
      clearSessionState();
    },

    async logout() {
      bumpReconnectRequest(registry);
      deps.cancelLogin();
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

export function useSessionActions(deps: SessionActionDeps): SessionActions {
  const registry = useRegistry();
  const { api, cancelLogin } = deps;
  return useMemo(
    () =>
      createSessionActions(registry, { api, cancelLogin }),
    [api, cancelLogin, registry],
  );
}
