/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Organization, Project, SessionUser } from "../../types";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  createSessionActions,
  pollLoginNow,
  type SessionActionApi,
  type SessionActions,
} from "./actions";
import { setSessionDataSources } from "./api";
import { loadingAtom, loginCodeAtom, sessionErrorAtom, tokenAtom, userAtom } from "./atoms";

/*
  The device-authorization sign-in, as a state machine rather than a screen.

  It was three `useCallback`s and three refs on `useBriar`, and the refs are what
  made it worth pinning: every continuation compares itself against an attempt
  counter, so a cancelled or superseded sign-in cannot commit a session — not
  after the poll answers, and not after the credential has already been written.
*/

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

const team: Project = {
  ...demoDashboard.team,
  id: "team-a",
  name: "team-a",
  organizationId: organization.id,
  organizationName: organization.name,
};

/** In-memory device-authorization endpoint and browser hand-off. */
class AuthorizationServer {
  readonly openedUrls: string[] = [];
  readonly writtenTokens: string[] = [];
  sessionTokenCleared = 0;
  browserSignOuts = 0;
  pollCalls = 0;
  /** What the next poll answers with; `null` keeps it pending. */
  nextToken: string | null = null;
  beginError: Error | null = null;
  /** Blocks the credential write so a test can interleave a cancellation. */
  private heldTokenWrite: Promise<void> | null = null;

  holdTokenWrite(): () => void {
    let release: () => void = () => undefined;
    this.heldTokenWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  readonly api: Partial<SessionActionApi> = {
    beginDeviceAuthorization: async () => {
      if (this.beginError) throw this.beginError;
      return {
        deviceCode: "device-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://example.test/device",
        interval: 5,
      };
    },
    openAuthorization: async (url: string) => {
      this.openedUrls.push(url);
      return "launched" as const;
    },
    pollDeviceToken: async () => {
      this.pollCalls += 1;
      return this.nextToken
        ? { access_token: this.nextToken }
        : { error: "authorization_pending" as const };
    },
    clearSessionToken: async () => {
      this.sessionTokenCleared += 1;
    },
    signOutBrowserSession: async () => {
      this.browserSignOuts += 1;
    },
    writeSessionToken: async (token: string) => {
      if (this.heldTokenWrite) await this.heldTokenWrite;
      this.writtenTokens.push(token);
    },
  };
}

interface Harness {
  readonly actions: SessionActions;
  readonly registry: AtomRegistry;
  readonly server: AuthorizationServer;
}

const harness = (): Harness => {
  const registry = createTestRegistry();
  const server = new AuthorizationServer();
  setSessionDataSources(registry, {
    loadSession: async () => user,
    loadTeams: async () => [team],
    loadOrganizations: async () => [organization],
    loadConnectedTeamIds: async () => [],
  });
  const actions = createSessionActions(registry, { api: server.api });
  return { actions, registry, server };
};

/** Lets every already-resolved promise in the login chain settle. */
const settle = async () => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("device authorization sign-in", () => {
  it("shows the user code and signs in once the poll is approved", async () => {
    const { actions, registry, server } = harness();

    await actions.login({ locale: "en" });
    expect(registry.get(loginCodeAtom)).toBe("ABCD-EFGH");
    expect(server.openedUrls).toEqual(["https://example.test/device"]);
    expect(registry.get(userAtom)).toBeNull();

    server.nextToken = "token-1";
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();

    expect(registry.get(tokenAtom)).toBe("token-1");
    expect(registry.get(userAtom)).toEqual(user);
    expect(registry.get(teamsAtom)).toEqual([team]);
    expect(registry.get(organizationsAtom)).toEqual([organization]);
    expect(registry.get(activeOrganizationIdAtom)).toBe(organization.id);
    expect(registry.get(activeTeamIdAtom)).toBe(team.id);
    expect(server.writtenTokens).toEqual(["token-1"]);
    expect(registry.get(loginCodeAtom)).toBeNull();
    expect(registry.get(loadingAtom)).toBe(false);
  });

  it("stops polling and clears the code when the sign-in is cancelled", async () => {
    const { actions, registry, server } = harness();

    await actions.login({ locale: "en" });
    actions.cancelLogin();
    expect(registry.get(loginCodeAtom)).toBeNull();
    expect(registry.get(loadingAtom)).toBe(false);

    // The timer is gone, so nothing polls — and even a poll that had already
    // started could not commit, because its attempt is stale.
    server.nextToken = "token-1";
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(server.pollCalls).toBe(0);
    expect(registry.get(tokenAtom)).toBeNull();
    expect(registry.get(userAtom)).toBeNull();
  });

  it("polls immediately when the companion returns from the browser", async () => {
    const { actions, registry, server } = harness();

    await actions.login({ locale: "en" });
    server.nextToken = "token-1";
    pollLoginNow(registry);
    await settle();

    // No timer was advanced: the return from the browser is what ran the poll.
    expect(server.pollCalls).toBe(1);
    expect(registry.get(tokenAtom)).toBe("token-1");
  });

  it("reports a failed hand-off and leaves the session signed out", async () => {
    const { actions, registry, server } = harness();
    server.beginError = new Error("장치 승인을 시작할 수 없습니다.");

    await actions.login({ locale: "en" });

    expect(registry.get(sessionErrorAtom)).toBe(
      "장치 승인을 시작할 수 없습니다.",
    );
    expect(registry.get(loadingAtom)).toBe(false);
    expect(registry.get(tokenAtom)).toBeNull();
  });

  it("takes back a credential written for an abandoned attempt", async () => {
    const { actions, registry, server } = harness();

    await actions.login({ locale: "en" });
    server.nextToken = "token-1";
    const releaseTokenWrite = server.holdTokenWrite();

    // The poll is approved and the credential is on its way to storage when the
    // user cancels. Storing it still finishes, so the session that must not
    // exist has to be taken back rather than left behind on the device.
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    actions.cancelLogin();
    releaseTokenWrite();
    await settle();

    expect(server.writtenTokens).toEqual(["token-1"]);
    expect(server.sessionTokenCleared).toBeGreaterThan(0);
    expect(registry.get(tokenAtom)).toBeNull();
    expect(registry.get(userAtom)).toBeNull();
  });
});
