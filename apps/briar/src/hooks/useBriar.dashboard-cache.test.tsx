/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, type ReactTestRoot } from "../test/react";
import { demoDashboard } from "../lib/demo-data";
import { createTestRegistry } from "../state/registry";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  Organization,
  PlanningProject,
  Project,
  SessionUser,
} from "../types";
import { type BriarDataSources, useBriar } from "./useBriar";

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
 * In-memory stand-in for the reads `useBriar` performs on its own. Dashboard
 * snapshots stay pending until the test settles them, which is how "the cached
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

  readonly dataSources: BriarDataSources = {
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
let briar: ReturnType<typeof useBriar>;
let view: ReactTestRoot;

function Harness({ lockedProjectId }: { lockedProjectId: string | null }) {
  briar = useBriar({
    dataSources: server.dataSources,
    deferDefaultOrganization: true,
    lockedProjectId,
  });
  return null;
}

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

const mount = async (
  projects: Project[],
  organizations: Organization[],
  lockedProjectId: string | null = null,
) => {
  server = new DashboardServer(projects, organizations);
  view = createReactTestRoot();
  // `useBriar` reads its root state from atoms, which are module singletons: a
  // registry per test is what keeps one test's session out of the next one.
  await view.render(
    <RegistryContext.Provider value={createTestRegistry()}>
      <Harness lockedProjectId={lockedProjectId} />
    </RegistryContext.Provider>,
  );
  await flush();
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  // `token-store` falls back to localStorage outside Tauri, so the hook
  // restores a real session without any module mocking.
  window.localStorage.setItem("briar.session-token", "token-1");
});

afterEach(async () => {
  await view?.cleanup();
  vi.restoreAllMocks();
});

describe("useBriar dashboard cache", () => {
  it("shows the cached dashboard immediately when returning to a visited project", async () => {
    await mount([projectA1, projectA2], [organizationA]);

    const firstA1 = await settleDashboard(projectA1, 1);
    expect(briar.dashboard).toEqual(firstA1);
    expect(briar.dashboardStale).toBe(false);

    await act(async () => briar.setActiveProjectId(projectA2.id));
    await settleDashboard(projectA2, 2);
    expect(briar.dashboard?.team.id).toBe(projectA2.id);

    // Switching back must not blank the UI: the cached payload is committed
    // synchronously, before any network response.
    server.forget();
    await act(async () => briar.setActiveProjectId(projectA1.id));
    expect(briar.dashboard).toEqual(firstA1);
    expect(briar.dashboard?.team.id).toBe(projectA1.id);
    expect(briar.dashboardStale).toBe(true);

    // …and the stale payload is replaced by a full snapshot, never a delta.
    expect(server.deltaRequests).toEqual([]);
    expect(server.snapshotRequests).toEqual([projectA1.id]);

    const freshA1 = await settleDashboard(projectA1, 3);
    expect(briar.dashboard).toEqual(freshA1);
    expect(briar.dashboardStale).toBe(false);
  });

  it("keeps the loading state when switching to a never visited project", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);

    await act(async () => briar.setActiveProjectId(projectA2.id));
    expect(briar.dashboard).toBeNull();
    expect(briar.dashboardStale).toBe(false);

    const freshA2 = await settleDashboard(projectA2, 2);
    expect(briar.dashboard).toEqual(freshA2);
    expect(briar.dashboardStale).toBe(false);
  });

  it("ignores a late response for the project that is no longer active", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    const firstA1 = await settleDashboard(projectA1, 1);

    // Leave project A2's snapshot in flight, then return to A1.
    await act(async () => briar.setActiveProjectId(projectA2.id));
    expect(briar.dashboard).toBeNull();

    await act(async () => briar.setActiveProjectId(projectA1.id));
    expect(briar.dashboard).toEqual(firstA1);

    await settleDashboard(projectA2, 99);
    expect(briar.dashboard?.team.id).toBe(projectA1.id);
    expect(briar.dashboard).toEqual(firstA1);

    const freshA1 = await settleDashboard(projectA1, 2);
    expect(briar.dashboard).toEqual(freshA1);
  });

  it("ignores a response from a refresh closure bound to the previous project", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);

    // A consumer can hold on to the `refresh` bound to the project that was
    // active when it rendered (`unassignRun` does exactly that).
    const staleRefresh = briar.refresh;

    await act(async () => briar.setActiveProjectId(projectA2.id));
    expect(briar.dashboard).toBeNull();

    // The stale closure starts a brand new request for project A1, so the
    // request generation alone cannot invalidate it.
    await act(async () => {
      void staleRefresh("snapshot");
      await Promise.resolve();
    });
    await settleDashboard(projectA1, 42);
    expect(briar.dashboard).toBeNull();

    await act(async () => {
      void briar.refresh("snapshot");
      await Promise.resolve();
    });
    const freshA2 = await settleDashboard(projectA2, 2);
    expect(briar.dashboard).toEqual(freshA2);
  });

  it("drops cached dashboards of organizations the user left", async () => {
    await mount(
      [projectA1, projectA2, projectB1],
      [organizationA, organizationB],
    );
    await settleDashboard(projectA1, 1);

    await act(async () => briar.setActiveOrganizationId(organizationB.id));
    expect(briar.dashboard).toBeNull();
    await settleDashboard(projectB1, 2);
    expect(briar.dashboard?.team.id).toBe(projectB1.id);

    // Organization A's cache was pruned when the active organization changed.
    await act(async () => briar.setActiveOrganizationId(organizationA.id));
    expect(briar.dashboard).toBeNull();
    expect(briar.dashboardStale).toBe(false);
  });

  it("drops every cached dashboard when the session token changes", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);
    await act(async () => briar.setActiveProjectId(projectA2.id));
    await settleDashboard(projectA2, 2);
    await act(async () => briar.setActiveProjectId(projectA1.id));
    await settleDashboard(projectA1, 3);
    expect(briar.dashboard?.team.id).toBe(projectA1.id);

    // Restore a different session while the active organization stays the
    // same, so only the token change can invalidate the cache.
    server.dropPending();
    window.localStorage.setItem("briar.session-token", "token-2");
    await view.render(<Harness lockedProjectId={projectA2.id} />);
    await flush();
    expect(briar.token).toBe("token-2");
    expect(briar.activeOrganizationId).toBe(organizationA.id);
    expect(briar.activeProjectId).toBe(projectA2.id);

    // Nothing cached under the previous session may resurface.
    await act(async () => briar.setActiveProjectId(projectA2.id));
    expect(briar.dashboard).toBeNull();
    expect(briar.dashboardStale).toBe(false);
  });

  it("clears the dashboard and its cache on logout", async () => {
    await mount([projectA1, projectA2], [organizationA]);
    await settleDashboard(projectA1, 1);
    await act(async () => briar.setActiveProjectId(projectA2.id));
    await settleDashboard(projectA2, 2);

    await act(async () => {
      await briar.logout();
    });
    expect(briar.dashboard).toBeNull();
    expect(briar.dashboardStale).toBe(false);
    expect(briar.token).toBeNull();
    expect(window.localStorage.getItem("briar.session-token")).toBeNull();
  });

  it("evicts the least recently used project once the cache is full", async () => {
    const projects = Array.from({ length: 10 }, (_unused, index) =>
      projectOf(`project-lru-${index}`, organizationA),
    );
    await mount(projects, [organizationA]);

    await settleDashboard(projects[0]!, 1);
    for (const project of projects.slice(1)) {
      await act(async () => briar.setActiveProjectId(project.id));
      await settleDashboard(project, 1);
    }

    // Ten visits with a cache of eight evicted the two oldest entries.
    await act(async () => briar.setActiveProjectId(projects[0]!.id));
    expect(briar.dashboard).toBeNull();
    await settleDashboard(projects[0]!, 2);

    // The most recently visited projects are still warm.
    await act(async () => briar.setActiveProjectId(projects[9]!.id));
    expect(briar.dashboard?.team.id).toBe(projects[9]!.id);
    expect(briar.dashboardStale).toBe(true);
  });
});
