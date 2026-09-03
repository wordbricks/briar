/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChannelSummary } from "../../lib/channels-contract";
import { demoDashboard } from "../../lib/demo-data";
import { createReactTestRoot, type ReactTestRoot } from "../../test/react";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  Organization,
  PlanningProject,
  Project,
  SessionUser,
} from "../../types";
import { organizationChannelIdsAtom } from "../entities/channels";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import {
  setSessionDataSources,
  type SessionDataSources,
} from "../session/api";
import {
  restoringSessionAtom,
  tokenAtom,
  userAtom,
} from "../session/atoms";
import { useSessionBootstrap } from "../session/useSessionBootstrap";
import { applySyncEvent } from "../sync/apply";
import { useTeamSync } from "../sync/useTeamSync";
import { activeDashboardAtom } from "../sync/view";
import { activeTeamIdAtom, teamCursorAtom, teamsAtom } from "../team/atoms";
import { readSnapshotAccount, writeSnapshotAccount } from "./account";
import { hydratedAccountAtom } from "./hydration";
import { collectSnapshot, type ClientSnapshot } from "./snapshot";
import {
  createMemorySnapshotStore,
  setSnapshotStore,
  snapshotKey,
  type MemorySnapshotStore,
  type SnapshotStore,
} from "./store";
import { useHydration } from "./useHydration";

/*
  A cold start that already has something to show.

  Every case here is the same three-way race: the record on disk, the session
  bootstrap, and the delta catch-up that follows it. What they fix is who wins —
  the snapshot renders first, the bootstrap replaces it, and a bootstrap that
  disagrees about the account takes it away.

  The session request is held open on purpose. "Before the network answers" is
  only meaningful while the network has not answered.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const otherUser: SessionUser = { ...user, id: "user-2", name: "Someone Else" };

const organization: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  organizationId: organization.id,
  organizationName: organization.name,
});

const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const channel: ChannelSummary = {
  id: "channel-1",
  organizationId: organization.id,
  kind: "channel",
  slug: "general",
  name: "general",
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  createdByUserId: user.id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
};

const STORED_CURSOR = 41;

const storedPayload: DashboardPayload = {
  ...demoDashboard,
  team: teamA,
  runs: [
    { ...demoDashboard.runs[0]!, id: "run-stored", title: "Stored run", teamId: teamA.id },
  ],
  cursor: STORED_CURSOR,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

/** The record a previous run of the app would have left behind. */
function storedSnapshot(): ClientSnapshot {
  const source = createTestRegistry([
    [userAtom, user],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
    [teamsAtom, [teamA]],
    [activeTeamIdAtom, teamA.id],
  ]);
  applySyncEvent(source, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: storedPayload,
  });
  applySyncEvent(source, {
    kind: "channel-catalog-snapshot",
    organizationId: organization.id,
    channels: [channel],
  });
  const snapshot = collectSnapshot(source);
  if (!snapshot) throw new Error("expected a snapshot to store");
  return snapshot;
}

const deltaOf = (cursor: number): DashboardDeltaPayload => ({
  reset: false,
  cursor: cursor + 1,
  hasMore: false,
  runs: [{ ...storedPayload.runs[0]!, title: "Fresh run" }],
  deletedRunIds: [],
  workers: [],
  organizationProviders: [],
  generatedAt: "2026-09-02T00:00:00.000Z",
});

/** The reads a boot performs, with the session held until a test lets it go. */
class BootServer {
  readonly snapshotRequests: string[] = [];
  readonly deltaRequests: { teamId: string; cursor: number }[] = [];
  private pendingSession: ((value: SessionUser) => void)[] = [];
  teams: Project[] = [teamA];

  readonly dataSources: SessionDataSources = {
    loadConnectedTeamIds: async () => [],
    loadDashboard: (_token, teamId) => {
      this.snapshotRequests.push(teamId);
      return Promise.resolve({ ...storedPayload, team: teamOf(teamId), cursor: 99 });
    },
    loadDashboardDelta: (_token, teamId, cursor) => {
      this.deltaRequests.push({ teamId, cursor });
      return Promise.resolve(deltaOf(cursor));
    },
    loadOrganizations: async () => [organization],
    loadSession: () =>
      new Promise<SessionUser>((resolve) => {
        this.pendingSession.push(resolve);
      }),
    loadTeamProjects: async () => [] as PlanningProject[],
    loadTeams: async () => this.teams,
  };

  get sessionRequests() {
    return this.pendingSession.length;
  }

  /** Answers the held session request, which is what starts the commit. */
  releaseSession(as: SessionUser = user) {
    const pending = this.pendingSession;
    this.pendingSession = [];
    for (const resolve of pending) resolve(as);
  }
}

function Harness() {
  useHydration();
  useTeamSync();
  useSessionBootstrap();
  return null;
}

let view: ReactTestRoot;
let registry: AtomRegistry;
let store: MemorySnapshotStore;
let server: BootServer;

const flush = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

interface MountOptions {
  readonly record?: ClientSnapshot | null;
  readonly pointer?: boolean;
  readonly storeOverride?: SnapshotStore;
}

const mount = async ({
  record = storedSnapshot(),
  pointer = true,
  storeOverride,
}: MountOptions = {}) => {
  server = new BootServer();
  registry = createTestRegistry();
  store = createMemorySnapshotStore();
  setSnapshotStore(registry, storeOverride ?? store);
  setSessionDataSources(registry, server.dataSources);
  // Always written under the key a boot on this device looks for, so a record
  // whose own account disagrees with the pointer is still reachable.
  if (record) {
    await store.write(snapshotKey(user.id, organization.id), record);
  }
  if (pointer) {
    writeSnapshotAccount({
      organizationId: organization.id,
      userId: user.id,
    });
  }
  view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
  await flush();
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  // `token-store` falls back to localStorage outside Tauri, so the bootstrap
  // finds a real credential without any module mocking.
  window.localStorage.setItem("briar.session-token", "token-1");
});

afterEach(async () => {
  await view?.cleanup();
});

describe("useHydration", () => {
  it("renders the last dashboard before the network answers", async () => {
    await mount();

    // The session request is still open, and the screen is already past the
    // boot gate with the account's last board on it.
    expect(server.sessionRequests).toBe(1);
    expect(registry.get(restoringSessionAtom)).toBe(false);
    expect(registry.get(userAtom)).toEqual(user);
    expect(registry.get(tokenAtom)).toBeNull();
    expect(registry.get(activeDashboardAtom)).toEqual(storedPayload);
    expect(registry.get(organizationChannelIdsAtom(organization.id))).toEqual([
      channel.id,
    ]);
    expect(registry.get(hydratedAccountAtom)).toEqual({
      organizationId: organization.id,
      userId: user.id,
    });
    // Nothing was fetched: a hydrated screen carries no credential.
    expect(server.snapshotRequests).toEqual([]);
    expect(server.deltaRequests).toEqual([]);
  });

  it("catches up by delta from the stored cursor", async () => {
    await mount();
    expect(registry.get(teamCursorAtom(teamA.id))).toBe(STORED_CURSOR);

    server.releaseSession();
    await flush();

    // The credential arrived and the catch-up resumed where the record left
    // off — no snapshot, and the hydrated entities were never cleared.
    expect(server.deltaRequests).toEqual([
      { teamId: teamA.id, cursor: STORED_CURSOR },
    ]);
    expect(server.snapshotRequests).toEqual([]);
    expect(registry.get(activeDashboardAtom)?.runs[0]?.title).toBe("Fresh run");
    expect(registry.get(teamCursorAtom(teamA.id))).toBe(STORED_CURSOR + 1);
  });

  it("keeps the team the record was showing", async () => {
    await mount();
    // The account's first team is not the one it was last looking at, so the
    // selection the bootstrap resolves on its own would move the screen.
    server.teams = [teamB, teamA];

    server.releaseSession();
    await flush();

    expect(registry.get(activeTeamIdAtom)).toBe(teamA.id);
    expect(registry.get(activeDashboardAtom)?.team.id).toBe(teamA.id);
  });

  it("takes the record away when another account signs in", async () => {
    await mount();
    expect(registry.get(activeDashboardAtom)).not.toBeNull();

    server.teams = [];
    server.releaseSession(otherUser);
    await flush();

    expect(registry.get(userAtom)).toEqual(otherUser);
    expect(registry.get(activeDashboardAtom)).toBeNull();
    expect(registry.get(hydratedAccountAtom)).toBeNull();
    // …and the record itself, so the next boot cannot show it either.
    expect(store.entries().size).toBe(0);
    expect(readSnapshotAccount()).toBeNull();
  });

  it("takes the record away when the credential is gone", async () => {
    window.localStorage.removeItem("briar.session-token");
    await mount();
    await flush();

    expect(registry.get(restoringSessionAtom)).toBe(false);
    expect(registry.get(userAtom)).toBeNull();
    expect(registry.get(activeDashboardAtom)).toBeNull();
    expect(store.entries().size).toBe(0);
  });

  it("keeps the boot gate when this device has no record", async () => {
    await mount({ pointer: false, record: null });

    expect(registry.get(restoringSessionAtom)).toBe(true);
    expect(registry.get(userAtom)).toBeNull();

    server.releaseSession();
    await flush();
    expect(registry.get(restoringSessionAtom)).toBe(false);
    expect(registry.get(activeDashboardAtom)?.team.id).toBe(teamA.id);
  });

  it("keeps the boot gate for a record written by an older version", async () => {
    const outdated = { ...storedSnapshot(), schemaVersion: 99 };
    await mount({ record: outdated });

    expect(registry.get(restoringSessionAtom)).toBe(true);
    expect(registry.get(activeDashboardAtom)).toBeNull();
    expect(registry.get(hydratedAccountAtom)).toBeNull();
  });

  it("keeps the boot gate for a record belonging to someone else", async () => {
    await mount({ record: { ...storedSnapshot(), userId: otherUser.id } });

    expect(registry.get(restoringSessionAtom)).toBe(true);
    expect(registry.get(activeDashboardAtom)).toBeNull();
    expect(registry.get(hydratedAccountAtom)).toBeNull();
  });

  it("boots normally when storage itself fails", async () => {
    await mount({
      record: null,
      storeOverride: {
        read: () => Promise.reject(new Error("storage is blocked")),
        write: () => Promise.reject(new Error("storage is blocked")),
        delete: () => Promise.reject(new Error("storage is blocked")),
        clear: () => Promise.reject(new Error("storage is blocked")),
      },
    });

    expect(registry.get(restoringSessionAtom)).toBe(true);
    server.releaseSession();
    await flush();
    expect(registry.get(restoringSessionAtom)).toBe(false);
    expect(registry.get(activeDashboardAtom)?.team.id).toBe(teamA.id);
  });
});
