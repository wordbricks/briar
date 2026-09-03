/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, type ReactTestRoot } from "../../test/react";
import { demoDashboard } from "../../lib/demo-data";
import { createOrganizationActions } from "../organization/actions";
import { createTestRegistry, type AtomRegistry } from "../registry";
import {
  setSessionDataSources,
  type SessionDataSources,
} from "../session/api";
import { createSessionActions } from "../session/actions";
import { useSessionBootstrap } from "../session/useSessionBootstrap";
import { tokenAtom } from "../session/atoms";
import { createTeamActions } from "../team/actions";
import { dashboardStaleAtom } from "../team/atoms";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  Organization,
  PlanningProject,
  Project,
  SessionUser,
} from "../../types";
import { createSyncActions } from "./actions";
import { getTeamSyncLoader } from "./loader";
import { useTeamSync } from "./useTeamSync";
import { activeDashboardAtom } from "./view";

/**
 * The two effects these cases need: the bootstrap that restores the stored
 * credential and the sync that fetches whichever team is selected. The desktop
 * navigation reconciliation is deliberately not mounted — it owns the location,
 * and these cases select teams directly.
 */
function Harness() {
  useSessionBootstrap();
  useTeamSync();
  return null;
}

/*
  What a team switch looks like from the outside, driven end to end: the session
  bootstrap restores a stored credential, `useTeamSync` fetches the selected
  team, and the team actions move the selection around.

  These were `useBriar.dashboard.test.tsx`'s cases. They outlived the facade
  because none of them was ever about the facade: each one fixes an invariant of
  the entity store and the loader — a visited team renders before the network
  answers, a never visited one does not, a late or misaddressed response is
  dropped, and a credential or organization change discards what the previous
  one loaded.
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

const organizationB: Organization = {
  ...organizationA,
  id: "org-b",
  name: "Org B",
  handle: "org-b",
};

const projectOf = (id: string, organization: Organization): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  organizationId: organization.id,
  organizationName: organization.name,
});

const projectA1 = projectOf("project-a1", organizationA);
const projectA2 = projectOf("project-a2", organizationA);
const projectB1 = projectOf("project-b1", organizationB);

const dashboardOf = (project: Project, revision: number): DashboardPayload => ({
  ...demoDashboard,
  team: project,
  runs: [],
  cursor: revision,
  generatedAt: `2026-09-03T00:00:0${revision}.000Z`,
});

/**
 * In-memory stand-in for the reads the session performs on its own. Dashboard
 * snapshots stay pending until the test settles them, which is how "the stored
 * board is already on screen before the network answers" becomes observable.
 */
class DashboardServer {
  private pending: {
    projectId: string;
    resolve: (payload: DashboardPayload) => void;
  }[] = [];
  readonly snapshotRequests: string[] = [];
  readonly deltaRequests: string[] = [];

  constructor(
    private projects: Project[],
    private organizations: Organization[],
  ) {}

  readonly dataSources: SessionDataSources = {
    loadConnectedTeamIds: async () => [],
    loadDashboard: (_token: string, projectId: string) => {
      this.snapshotRequests.push(projectId);
      return new Promise<DashboardPayload>((resolve) => {
        this.pending.push({ projectId, resolve });
      });
    },
    loadDashboardDelta: (_token: string, projectId: string) => {
      this.deltaRequests.push(projectId);
      return new Promise<DashboardDeltaPayload>(() => undefined);
    },
    loadOrganizations: async () => this.organizations,
    loadSession: async () => user,
    loadTeamProjects: async () => [] as PlanningProject[],
    loadTeams: async () => this.projects,
  };

  /** Answers every in-flight snapshot request for `project`. */
  takePending(projectId: string) {
    const matching = this.pending.filter(
      (request) => request.projectId === projectId,
    );
    this.pending = this.pending.filter(
      (request) => request.projectId !== projectId,
    );
    return matching;
  }

  dropPending() {
    this.pending = [];
  }

  forget() {
    this.snapshotRequests.length = 0;
    this.deltaRequests.length = 0;
  }
}

let server: DashboardServer;
let view: ReactTestRoot;
let registry: AtomRegistry;

const dashboard = () => registry.get(activeDashboardAtom);
const dashboardStale = () => registry.get(dashboardStaleAtom);
const selectTeam = async (teamId: string) => {
  await act(async () => {
    createTeamActions(registry).selectTeam(teamId);
  });
};
const selectOrganization = async (organizationId: string) => {
  await act(async () => {
    createOrganizationActions(registry, {}).selectOrganization(organizationId);
  });
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const settleDashboard = async (project: Project, revision: number) => {
  const matching = server.takePending(project.id);
  const payload = dashboardOf(project, revision);
  await act(async () => {
    for (const request of matching) request.resolve(payload);
    await Promise.resolve();
  });
  await flush();
  return payload;
};

const mount = async (projects: Project[], organizations: Organization[]) => {
  server = new DashboardServer(projects, organizations);
  view = createReactTestRoot();
  // The domain state lives in module level atoms, so a registry per test is
  // what keeps one test's session out of the next one.
  registry = createTestRegistry();
  setSessionDataSources(registry, server.dataSources);
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
  // restores a real session without any module mocking.
  window.localStorage.setItem("briar.session-token", "token-1");
});

afterEach(async () => {
  await view?.cleanup();
  vi.restoreAllMocks();
});

describe("team dashboard view", () => {
  it("renders a stored dashboard immediately when returning to a visited team", async () => {
    await mount([projectA1, projectA2], [organizationA]);

    const firstA1 = await settleDashboard(projectA1, 1);
    expect(dashboard()).toEqual(firstA1);
    expect(dashboardStale()).toBe(false);

    await selectTeam(projectA2.id);
    await settleDashboard(projectA2, 2);
    expect(dashboard()?.team.id).toBe(projectA2.id);

    // Switching back must not blank the UI: the entity store still holds this
    // team's payload, so it renders before any network response.
    server.forget();
    await selectTeam(projectA1.id);
    expect(dashboard()).toEqual(firstA1);
    expect(dashboard()?.team.id).toBe(projectA1.id);
    expect(dashboardStale()).toBe(true);

    // …and the stale payload is replaced by a full snapshot, never a delta.
    expect(server.deltaRequests).toEqual([]);
    expect(server.snapshotRequests).toEqual([projectA1.id]);

    const freshA1 = await settleDashboard(projectA1, 3);
    expect(dashboard()).toEqual(freshA1);
    expect(dashboardStale()).toBe(false);
  });

  it("keeps the loading state when switching to a never visited project", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);

    await selectTeam(projectA2.id);
    expect(dashboard()).toBeNull();
    expect(dashboardStale()).toBe(false);

    const freshA2 = await settleDashboard(projectA2, 2);
    expect(dashboard()).toEqual(freshA2);
    expect(dashboardStale()).toBe(false);
  });

  it("ignores a late response for the project that is no longer active", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    const firstA1 = await settleDashboard(projectA1, 1);

    // Leave project A2's snapshot in flight, then return to A1.
    await selectTeam(projectA2.id);
    expect(dashboard()).toBeNull();

    await selectTeam(projectA1.id);
    expect(dashboard()).toEqual(firstA1);

    await settleDashboard(projectA2, 99);
    expect(dashboard()?.team.id).toBe(projectA1.id);
    expect(dashboard()).toEqual(firstA1);

    const freshA1 = await settleDashboard(projectA1, 2);
    expect(dashboard()).toEqual(freshA1);
  });

  it("ignores a response for a team that stopped being the active one", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);

    await selectTeam(projectA2.id);
    expect(dashboard()).toBeNull();

    /*
      A refetch aimed at the team that was active when its caller was built.
      `refreshActiveTeam` reads the selection at call time and can no longer
      produce one, but the loader is the guard that matters: a response whose
      team is no longer selected is dropped rather than committed under the
      selected team's identity.
    */
    await act(async () => {
      void getTeamSyncLoader(registry).refresh(projectA1.id, "snapshot");
      await Promise.resolve();
    });
    await settleDashboard(projectA1, 42);
    expect(dashboard()).toBeNull();

    await act(async () => {
      void createSyncActions(registry).refreshActiveTeam("snapshot");
      await Promise.resolve();
    });
    const freshA2 = await settleDashboard(projectA2, 2);
    expect(dashboard()).toEqual(freshA2);
  });

  it("drops the stored dashboards of organizations the user left", async () => {
    await mount(
      [projectA1, projectA2, projectB1],
      [organizationA, organizationB],
    );
    await settleDashboard(projectA1, 1);

    await selectOrganization(organizationB.id);
    expect(dashboard()).toBeNull();
    await settleDashboard(projectB1, 2);
    expect(dashboard()?.team.id).toBe(projectB1.id);

    // Organization A's stored teams were pruned when the active organization
    // changed.
    await selectOrganization(organizationA.id);
    expect(dashboard()).toBeNull();
    expect(dashboardStale()).toBe(false);
  });

  it("drops every stored dashboard when the session token changes", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);
    await selectTeam(projectA2.id);
    await settleDashboard(projectA2, 2);
    await selectTeam(projectA1.id);
    await settleDashboard(projectA1, 3);
    expect(dashboard()?.team.id).toBe(projectA1.id);

    // A different credential for the same organization: only the token change
    // can invalidate what the previous session loaded.
    server.dropPending();
    await act(async () => {
      registry.set(tokenAtom, "token-2");
    });
    expect(registry.get(tokenAtom)).toBe("token-2");
    expect(dashboard()).toBeNull();
    expect(dashboardStale()).toBe(false);

    // …and neither team resurfaces on the way back.
    await selectTeam(projectA2.id);
    expect(dashboard()).toBeNull();
    expect(dashboardStale()).toBe(false);
  });

  it("clears the dashboard and every stored team on logout", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);
    await selectTeam(projectA2.id);
    await settleDashboard(projectA2, 2);

    await act(async () => {
      await createSessionActions(registry).logout();
    });
    expect(dashboard()).toBeNull();
    expect(dashboardStale()).toBe(false);
    expect(registry.get(tokenAtom)).toBeNull();
    expect(window.localStorage.getItem("briar.session-token")).toBeNull();
  });

  it("evicts the least recently synced team once retention is full", async () => {
    const projects = Array.from({ length: 10 }, (_unused, index) =>
      projectOf(`project-lru-${index}`, organizationA),
    );
    await mount(projects, [organizationA]);

    await settleDashboard(projects[0]!, 1);
    for (const project of projects.slice(1)) {
      await selectTeam(project.id);
      await settleDashboard(project, 1);
    }

    // Ten visits with a retention bound of eight dropped the two oldest teams.
    await selectTeam(projects[0]!.id);
    expect(dashboard()).toBeNull();
    await settleDashboard(projects[0]!, 2);

    // The most recently visited projects are still warm.
    await selectTeam(projects[9]!.id);
    expect(dashboard()?.team.id).toBe(projects[9]!.id);
    expect(dashboardStale()).toBe(true);
  });
});
