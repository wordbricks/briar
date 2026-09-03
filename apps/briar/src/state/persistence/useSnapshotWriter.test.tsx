/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type {
  DashboardPayload,
  Organization,
  Project,
  SessionUser,
} from "../../types";
import { createReactTestRoot, type ReactTestRoot } from "../../test/react";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { createSessionActions } from "../session/actions";
import { tokenAtom, userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { readSnapshotAccount } from "./account";
import type { ClientSnapshot } from "./snapshot";
import {
  createMemorySnapshotStore,
  setSnapshotStore,
  snapshotKey,
  type SnapshotStore,
} from "./store";
import { SNAPSHOT_WRITE_DELAY_MS, useSnapshotWriter } from "./useSnapshotWriter";

/*
  When a record is written, and when it is taken away.

  The writer is the only thing in the app that touches storage on a schedule, so
  these fix its schedule: a burst of changes costs one write, leaving the tab
  costs one more, and the two events that must remove a record — leaving an
  organization and signing out — actually remove it.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const organizationA: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const organizationB: Organization = { ...organizationA, id: "org-b", handle: "org-b" };

const teamOf = (id: string, organizationId: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  organizationId,
});

const teamA = teamOf("team-a", organizationA.id);
const teamB = teamOf("team-b", organizationB.id);

const payloadOf = (team: Project, cursor: number): DashboardPayload => ({
  ...demoDashboard,
  team,
  runs: [{ ...demoDashboard.runs[0]!, id: `${team.id}-run`, teamId: team.id }],
  cursor,
  generatedAt: `2026-09-0${cursor}T00:00:00.000Z`,
});

/** A store that also counts what the writer asked it to do. */
interface CountingStore extends SnapshotStore {
  readonly writes: string[];
  readonly deletes: string[];
  readonly clears: () => number;
  readonly records: () => ReadonlyMap<string, string>;
}

function countingStore(): CountingStore {
  const inner = createMemorySnapshotStore();
  const writes: string[] = [];
  const deletes: string[] = [];
  let clears = 0;
  return {
    writes,
    deletes,
    clears: () => clears,
    records: () => inner.entries(),
    read: (key) => inner.read(key),
    write: (key: string, snapshot: ClientSnapshot) => {
      writes.push(key);
      return inner.write(key, snapshot);
    },
    delete: (key) => {
      deletes.push(key);
      return inner.delete(key);
    },
    clear: () => {
      clears += 1;
      return inner.clear();
    },
  };
}

function Harness() {
  useSnapshotWriter();
  return null;
}

let view: ReactTestRoot;
let registry: AtomRegistry;
let store: CountingStore;

const signedIn = () => {
  registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [organizationsAtom, [organizationA, organizationB]],
    [activeOrganizationIdAtom, organizationA.id],
    [teamsAtom, [teamA, teamB]],
    [activeTeamIdAtom, teamA.id],
  ]);
  store = countingStore();
  setSnapshotStore(registry, store);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: payloadOf(teamA, 1),
  });
  return registry;
};

const mount = async () => {
  view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
};

/** Lets the store's promises settle without moving the writer's timer. */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  window.localStorage.clear();
  setVisibility("visible");
});

afterEach(async () => {
  await view?.cleanup();
  vi.useRealTimers();
});

describe("useSnapshotWriter", () => {
  it("collects a burst of changes into one record", async () => {
    signedIn();
    await mount();

    await advance(SNAPSHOT_WRITE_DELAY_MS - 1);
    expect(store.writes).toEqual([]);

    await advance(1);
    expect(store.writes).toEqual([snapshotKey(user.id, organizationA.id)]);

    // Three changes inside one window are one write, and the record that lands
    // is the state as of the write rather than as of the first change.
    await act(async () => {
      for (const cursor of [2, 3, 4]) {
        applySyncEvent(registry, {
          kind: "team-snapshot",
          teamId: teamA.id,
          payload: payloadOf(teamA, cursor),
        });
      }
    });
    await advance(SNAPSHOT_WRITE_DELAY_MS);
    expect(store.writes).toHaveLength(2);
    const stored = await store.read(snapshotKey(user.id, organizationA.id));
    expect(stored?.teamState[0]?.cursor).toBe(4);
    // …and the pointer the next cold start reads its key from.
    expect(readSnapshotAccount()).toEqual({
      organizationId: organizationA.id,
      userId: user.id,
    });
  });

  it("writes without waiting when the tab goes away", async () => {
    signedIn();
    await mount();
    await advance(SNAPSHOT_WRITE_DELAY_MS);
    expect(store.writes).toHaveLength(1);

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: teamA.id,
        payload: payloadOf(teamA, 5),
      });
    });
    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(store.writes).toHaveLength(2);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect(store.writes).toHaveLength(3);
  });

  it("removes the record of the organization the account left", async () => {
    signedIn();
    await mount();
    await advance(SNAPSHOT_WRITE_DELAY_MS);
    const keyA = snapshotKey(user.id, organizationA.id);
    expect([...store.records().keys()]).toEqual([keyA]);

    await act(async () => {
      registry.set(activeOrganizationIdAtom, organizationB.id);
      registry.set(activeTeamIdAtom, teamB.id);
    });
    await settle();
    expect(store.deletes).toEqual([keyA]);
    expect([...store.records().keys()]).toEqual([]);

    // The new organization gets its own record on the next window.
    await advance(SNAPSHOT_WRITE_DELAY_MS);
    expect([...store.records().keys()]).toEqual([
      snapshotKey(user.id, organizationB.id),
    ]);
  });

  it("drops a scheduled write when the organization changed under it", async () => {
    signedIn();
    await mount();
    await advance(SNAPSHOT_WRITE_DELAY_MS);
    store.writes.length = 0;

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: teamA.id,
        payload: payloadOf(teamA, 9),
      });
      registry.set(activeOrganizationIdAtom, organizationB.id);
      registry.set(activeTeamIdAtom, teamB.id);
    });
    await advance(SNAPSHOT_WRITE_DELAY_MS);

    // Nothing was written under organization A's key after the account left it.
    expect(store.writes).toEqual([snapshotKey(user.id, organizationB.id)]);
  });

  it("clears every record when the account signs out", async () => {
    signedIn();
    await mount();
    await advance(SNAPSHOT_WRITE_DELAY_MS);
    expect(store.records().size).toBe(1);

    const actions = createSessionActions(registry, {
      api: {
        clearSessionToken: async () => undefined,
        deleteAndroidPushRegistration: async () => true,
        signOutBrowserSession: async () => undefined,
      },
    });
    await act(async () => {
      await actions.logout();
    });
    await settle();

    expect(store.clears()).toBe(1);
    expect(store.records().size).toBe(0);
    expect(readSnapshotAccount()).toBeNull();

    // …and a signed-out app writes nothing more.
    await advance(SNAPSHOT_WRITE_DELAY_MS * 2);
    expect(store.records().size).toBe(0);
  });
});
