/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppEffects } from "../../components/app/AppEffects";
import { AuthGate, type AuthGateProps } from "../../components/app/AuthGate";
import { I18nProvider } from "../../i18n";
import { ApiError } from "../../lib/api/errors";
import { demoDashboard } from "../../lib/demo-data";
import { initialOnboardingStorageKey } from "../../lib/initial-onboarding";
import { launchIntroStorageKey } from "../../lib/launch-intro";
import { createReactTestRoot, flush, type ReactTestRoot } from "../../test/react";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  Organization,
  PlanningProject,
  Project,
  SessionUser,
} from "../../types";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import {
  setSessionDataSources,
  type SessionDataSources,
} from "../session/api";
import { userAtom } from "../session/atoms";
import { teamRunsAtom } from "../entities/runs";
import { readActiveTeamView } from "../../test/team-view";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { writeSnapshotAccount } from "./account";
import { collectSnapshot, type ClientSnapshot } from "./snapshot";
import {
  createMemorySnapshotStore,
  setSnapshotStore,
  snapshotKey,
  type MemorySnapshotStore,
} from "./store";

/*
  The completion condition of Phase 8, driven end to end.

  Everything the app mounts is here — `AppEffects` in its real order and the
  gate that decides what a cold start looks at — with the network and the record
  store both in memory. Three questions: does the last board appear before any
  response lands, does the boot gate still appear when there is nothing stored,
  and does an expired cursor end up consistent.
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
  name: "Team A",
  organizationId: organization.id,
  organizationName: organization.name,
};

const STORED_CURSOR = 12;

const storedPayload: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [
    {
      ...demoDashboard.runs[0]!,
      id: "run-stored",
      title: "Yesterday's run",
      teamId: team.id,
    },
  ],
  cursor: STORED_CURSOR,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const freshPayload: DashboardPayload = {
  ...storedPayload,
  runs: [{ ...storedPayload.runs[0]!, title: "Today's run" }],
  cursor: 400,
  generatedAt: "2026-09-04T00:00:00.000Z",
};

function storedSnapshot(): ClientSnapshot {
  const source = createTestRegistry([
    [userAtom, user],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
  ]);
  applySyncEvent(source, {
    kind: "team-snapshot",
    teamId: team.id,
    payload: storedPayload,
  });
  const snapshot = collectSnapshot(source);
  if (!snapshot) throw new Error("expected a snapshot to store");
  return snapshot;
}

class BootServer {
  readonly snapshotRequests: string[] = [];
  readonly deltaRequests: { teamId: string; cursor: number }[] = [];
  private pendingSession: ((value: SessionUser) => void)[] = [];
  /** Answers every delta with an expired cursor, as a server would. */
  expireCursor = false;

  readonly dataSources: SessionDataSources = {
    loadConnectedTeamIds: async () => [],
    loadDashboard: (_token, teamId) => {
      this.snapshotRequests.push(teamId);
      return Promise.resolve(freshPayload);
    },
    loadDashboardDelta: (_token, teamId, cursor) => {
      this.deltaRequests.push({ teamId, cursor });
      return this.expireCursor
        ? Promise.reject(new ApiError(410, "cursor expired"))
        : Promise.resolve({
            reset: false,
            cursor: cursor + 1,
            hasMore: false,
            runs: freshPayload.runs,
            deletedRunIds: [],
            workers: [],
            organizationProviders: [],
            generatedAt: freshPayload.generatedAt,
          } satisfies DashboardDeltaPayload);
    },
    loadOrganizations: async () => [organization],
    loadSession: () =>
      new Promise<SessionUser>((resolve) => {
        this.pendingSession.push(resolve);
      }),
    loadTeamProjects: async () => [] as PlanningProject[],
    loadTeams: async () => [team],
  };

  get sessionRequests() {
    return this.pendingSession.length;
  }

  releaseSession() {
    const pending = this.pendingSession;
    this.pendingSession = [];
    for (const resolve of pending) resolve(user);
  }
}

const gateProps: Omit<AuthGateProps, "children"> = {
  acceptingInvitation: false,
  invitationToken: null,
  onAcceptInvitation: async () => undefined,
  onInitialOnboardingComplete: () => undefined,
  onJoinOrganization: () => undefined,
  onOrganizationCreated: () => undefined,
  showsFirstOrganizationSetup: false,
  showsInitialOnboarding: false,
};

/** The board, as little of it as an assertion needs. */
function Board() {
  const teamId = useAtomValue(activeTeamIdAtom) ?? "";
  const runs = useAtomValue(teamRunsAtom(teamId));
  return (
    <div data-testid="board">
      {runs ? runs.map((run) => run.title).join(", ") : "empty"}
    </div>
  );
}

let view: ReactTestRoot;
let registry: AtomRegistry;
let store: MemorySnapshotStore;
let server: BootServer;

const bootGate = () =>
  view.container.querySelector("[data-testid=session-loading-screen]");
const board = () =>
  view.container.querySelector("[data-testid=board]")?.textContent ?? null;

const mount = async (record: ClientSnapshot | null) => {
  server = new BootServer();
  registry = createTestRegistry();
  store = createMemorySnapshotStore();
  setSnapshotStore(registry, store);
  setSessionDataSources(registry, server.dataSources);
  if (record) {
    await store.write(snapshotKey(user.id, organization.id), record);
    writeSnapshotAccount({
      organizationId: organization.id,
      userId: user.id,
    });
  }
  view = createReactTestRoot({ attachToDocument: true });
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <AppEffects />
        <AuthGate {...gateProps}>
          <Board />
        </AuthGate>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  window.localStorage.setItem("briar.locale.v1", "en");
  window.localStorage.setItem("briar.session-token", "token-1");
  // A returning account: neither the first-run onboarding nor the launch intro
  // is due, so the gate's only question is the session.
  window.localStorage.setItem(initialOnboardingStorageKey, "true");
  window.localStorage.setItem(launchIntroStorageKey, "true");
  document.body.replaceChildren();
});

afterEach(async () => {
  await view?.cleanup();
});

describe("cold boot", () => {
  it("shows the last dashboard before the network answers", async () => {
    await mount(storedSnapshot());

    // The session request has not been answered, and the app is past the gate.
    expect(server.sessionRequests).toBe(1);
    expect(bootGate()).toBeNull();
    expect(board()).toBe("Yesterday's run");

    // …and once it is answered, the catch-up replaces the board in place.
    server.releaseSession();
    await flush();
    expect(server.deltaRequests).toEqual([
      { teamId: team.id, cursor: STORED_CURSOR },
    ]);
    expect(board()).toBe("Today's run");
    expect(bootGate()).toBeNull();
  });

  it("shows the boot gate on a first run with nothing stored", async () => {
    await mount(null);

    expect(bootGate()).not.toBeNull();
    expect(board()).toBeNull();

    server.releaseSession();
    await flush();
    expect(bootGate()).toBeNull();
    expect(board()).toBe("Today's run");

    // …and this run leaves its own record behind for the next boot. Closing the
    // tab is what makes the writer skip its collection window.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await flush(2);
    expect([...store.entries().keys()]).toEqual([
      snapshotKey(user.id, organization.id),
    ]);
  });

  it("asks for a snapshot when the stored cursor expired", async () => {
    await mount(storedSnapshot());
    server.expireCursor = true;
    expect(board()).toBe("Yesterday's run");

    server.releaseSession();
    await flush();

    // The delta was tried from the record's cursor, the server rejected it, and
    // the loader replaced the whole board rather than patching a stale one.
    expect(server.deltaRequests).toEqual([
      { teamId: team.id, cursor: STORED_CURSOR },
    ]);
    expect(server.snapshotRequests).toEqual([team.id]);
    expect(readActiveTeamView(registry)).toEqual(freshPayload);
    expect(board()).toBe("Today's run");
  });
});
