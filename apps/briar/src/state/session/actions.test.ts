import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Organization, Project, SessionUser } from "../../types";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { runsByIdAtom } from "../entities/runs";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import { dashboardViewAtom } from "../sync/view";
import {
  activeTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../team/atoms";
import {
  createSessionActions,
  type SessionActionApi,
  type SessionActions,
} from "./actions";
import { tokenAtom, userAtom } from "./atoms";

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const organization: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

/** In-memory stand-in for the account RPCs and the local sign-out chores. */
class AccountServer {
  readonly deleted: string[] = [];
  readonly disconnected: string[] = [];
  readonly pushRegistrationsDeleted: string[] = [];
  readonly profiles: { username: string | null; name: string }[] = [];
  sessionTokenCleared = 0;
  deleteAccountError: Error | null = null;

  readonly api: SessionActionApi = {
    clearSessionToken: async () => {
      this.sessionTokenCleared += 1;
    },
    deleteAccount: async (_token, confirmation) => {
      if (this.deleteAccountError) throw this.deleteAccountError;
      this.deleted.push(confirmation);
    },
    deleteAndroidPushRegistration: async (token) => {
      this.pushRegistrationsDeleted.push(token);
      return true;
    },
    disconnectLocalTeam: async (teamId) => {
      this.disconnected.push(teamId);
    },
    signOutBrowserSession: async () => undefined,
    updateAccountProfile: async (_token, input) => {
      this.profiles.push({ username: input.username, name: input.name });
      return { ...user, ...input };
    },
  };
}

interface Harness {
  readonly actions: SessionActions;
  readonly cancelledLogins: () => number;
  readonly clearedViews: () => number;
  readonly reconnectBumps: () => number;
  readonly registry: AtomRegistry;
  readonly server: AccountServer;
}

const harness = (): Harness => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [teamsAtom, [teamA, teamB]],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
    [activeTeamIdAtom, teamA.id],
    [isCreatingTeamAtom, true],
  ]);
  // A signed-in account has its team's board in the entity store; signing out
  // has to take that with it.
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: {
      ...demoDashboard,
      team: teamA,
      runs: [],
      generatedAt: "2026-09-01T00:00:00.000Z",
    },
  });
  const server = new AccountServer();
  let cancelledLogins = 0;
  let clearedViews = 0;
  let reconnectBumps = 0;
  const actions = createSessionActions(registry, {
    api: server.api,
    bumpReconnectRequest: () => {
      reconnectBumps += 1;
    },
    cancelLogin: () => {
      cancelledLogins += 1;
    },
    clearWorkspaceViews: () => {
      clearedViews += 1;
    },
  });
  return {
    actions,
    cancelledLogins: () => cancelledLogins,
    clearedViews: () => clearedViews,
    reconnectBumps: () => reconnectBumps,
    registry,
    server,
  };
};

const expectSignedOut = (registry: AtomRegistry) => {
  expect(registry.get(userAtom)).toBeNull();
  expect(registry.get(tokenAtom)).toBeNull();
  expect(registry.get(teamsAtom)).toEqual([]);
  expect(registry.get(organizationsAtom)).toEqual([]);
  expect(registry.get(activeOrganizationIdAtom)).toBeNull();
  expect(registry.get(activeTeamIdAtom)).toBeNull();
  expect(registry.get(teamConnectionAtom)).toBeNull();
  expect(registry.get(isCreatingTeamAtom)).toBe(false);
  // Nothing the previous account loaded may outlive its token.
  expect(registry.get(dashboardViewAtom(teamA.id))).toBeNull();
  expect(registry.get(runsByIdAtom).size).toBe(0);
};

describe("createSessionActions", () => {
  it("clears every root atom on logout", async () => {
    const { actions, cancelledLogins, clearedViews, registry, server } =
      harness();

    await actions.logout();

    expectSignedOut(registry);
    expect(server.pushRegistrationsDeleted).toEqual(["token-1"]);
    expect(server.sessionTokenCleared).toBe(1);
    expect(cancelledLogins()).toBe(1);
    expect(clearedViews()).toBe(1);
  });

  it("still signs out locally when no token was held", async () => {
    const { actions, registry, server } = harness();
    registry.set(tokenAtom, null);

    await actions.logout();

    // Nothing to deregister without a credential, but the local session and
    // its stored token must go regardless.
    expect(server.pushRegistrationsDeleted).toEqual([]);
    expect(server.sessionTokenCleared).toBe(1);
    expectSignedOut(registry);
  });

  it("disconnects every local team before clearing a deleted account", async () => {
    const { actions, registry, server, reconnectBumps } = harness();

    await actions.deleteAccount("DELETE");

    expect(server.deleted).toEqual(["DELETE"]);
    expect([...server.disconnected].sort()).toEqual([teamA.id, teamB.id]);
    expect(reconnectBumps()).toBe(1);
    expectSignedOut(registry);
  });

  it("keeps the session when account deletion fails", async () => {
    const { actions, registry, server } = harness();
    server.deleteAccountError = new Error("확인 문구가 다릅니다.");

    await expect(actions.deleteAccount("nope")).rejects.toThrow(
      "확인 문구가 다릅니다.",
    );
    expect(server.disconnected).toEqual([]);
    expect(registry.get(userAtom)).toBe(user);
    expect(registry.get(tokenAtom)).toBe("token-1");
  });

  it("refuses to delete an account without a session", async () => {
    const { actions, registry, server } = harness();
    registry.set(tokenAtom, null);

    await expect(actions.deleteAccount("DELETE")).rejects.toThrow(
      "로그인이 필요합니다.",
    );
    expect(server.deleted).toEqual([]);
  });

  it("stores the profile the server confirms", async () => {
    const { actions, registry, server } = harness();

    const nextUser = await actions.updateAccountProfile({
      username: "tester",
      name: "Renamed",
      image: null,
    });

    expect(server.profiles).toEqual([{ username: "tester", name: "Renamed" }]);
    expect(nextUser.name).toBe("Renamed");
    expect(registry.get(userAtom)).toEqual(nextUser);
  });

  it("edits the profile locally when there is no session token", async () => {
    const { actions, registry, server } = harness();
    registry.set(tokenAtom, null);

    const nextUser = await actions.updateAccountProfile({
      username: null,
      name: "Offline",
      image: null,
    });

    expect(server.profiles).toEqual([]);
    expect(nextUser.name).toBe("Offline");
    expect(registry.get(userAtom)).toEqual(nextUser);
  });

  it("refuses to edit a profile while signed out", async () => {
    const { actions, registry } = harness();
    registry.set(userAtom, null);

    await expect(
      actions.updateAccountProfile({
        username: null,
        name: "Nobody",
        image: null,
      }),
    ).rejects.toThrow("로그인이 필요합니다.");
  });
});
