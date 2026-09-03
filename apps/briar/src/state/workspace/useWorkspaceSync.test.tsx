/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { demoDashboard, demoRepositoryReadiness } from "../../lib/demo-data";
import { createReactTestRoot } from "../../test/react";
import type { DashboardPayload, HuntRun, Project } from "../../types";
import { createTestRegistry, useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  setWorkspaceScheduleBridge,
  workspaceApiAtom,
  workspaceModesAtom,
  type WorkspaceApi,
} from "./api";
import { connectedTeamIdsAtom, healthAtom, teamReadinessAtom } from "./atoms";
import { useWorkspaceSync } from "./useWorkspaceSync";

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const dashboardOf = (team: Project): DashboardPayload => ({
  ...demoDashboard,
  team,
  runs: [],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

/** Records the calls the sync effects make, without any of them doing work. */
class SyncServer {
  readonly readinessRequests: string[] = [];
  readonly pollerStarts: string[][] = [];
  readonly pollerStops: number[] = [];
  readonly workflowMirrors: string[][] = [];
  readonly healthProbes: string[] = [];
  connectedTeamIds: string[] = [];

  readonly api: Partial<WorkspaceApi> = {
    loadConnectedTeamIds: async () => [...this.connectedTeamIds],
    loadTeamRepositoryReadiness: async (teamId) => {
      this.readinessRequests.push(teamId);
      return demoRepositoryReadiness;
    },
    loadAutoHuntHealth: async (teamId) => {
      this.healthProbes.push(teamId);
      return { projectId: teamId, healthy: true } as never;
    },
    loadDashboard: async (_token, teamId) => dashboardOf(teamOf(teamId)),
    updateLocalTeamWorkflow: async (_teamId, workflow) => workflow,
    syncSharedProjectWorkflows: async (input) => {
      this.workflowMirrors.push([...input.projectIds]);
      return input.projectIds.map((projectId) => ({
        projectId,
        status: "unchanged" as const,
        key: `${projectId}:key`,
      }));
    },
    startTeamAgentSchedulePolling: (_dependencies, teamIds) => {
      const start = this.pollerStarts.length;
      this.pollerStarts.push([...teamIds]);
      return () => this.pollerStops.push(start);
    },
  };
}

let server: SyncServer;

const makeRegistry = () => {
  server = new SyncServer();
  return createTestRegistry([
    [tokenAtom, "token-1"],
    [teamsAtom, [teamA, teamB]],
    [activeTeamIdAtom, teamA.id],
    [workspaceApiAtom, server.api],
    [workspaceModesAtom, { demoMode: false, remoteMode: false }],
  ]);
};

/**
 * Stands in for `useActionBridges`: it installs the scheduled agent callbacks after
 * every render, and every render hands over fresh closures. `renderKey` forces
 * a re-render so a test can prove the poller ignores them.
 */
function ScheduleBridge({ renderKey }: { renderKey: number }) {
  const registry = useRegistry();
  setWorkspaceScheduleBridge(registry, {
    startScheduledAgentSession: () => `session-${renderKey}`,
    settleScheduledAgentSession: () => undefined,
    startScheduledAgentWorkerDispatch: () => undefined,
  });
  return null;
}

function Effects({ renderKey }: { renderKey: number }) {
  useWorkspaceSync();
  return <ScheduleBridge renderKey={renderKey} />;
}

const tree = (registry: AtomRegistry, renderKey: number) => (
  <RegistryContext.Provider value={registry}>
    <Effects renderKey={renderKey} />
  </RegistryContext.Provider>
);

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot();
  await view.render(tree(registry, 0));
  await flush();
  return view;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe("useWorkspaceSync", () => {
  it("inspects every team's checkout once", async () => {
    const registry = makeRegistry();
    server.connectedTeamIds = [teamA.id];
    const view = await mount(registry);

    expect(server.readinessRequests).toEqual([teamA.id]);
    expect(registry.get(teamReadinessAtom(teamA.id)).readiness).toEqual(
      demoRepositoryReadiness,
    );
    // Team B has no checkout here, so it is reported as disconnected rather
    // than probed for readiness.
    expect(registry.get(teamReadinessAtom(teamB.id)).readiness).toBeNull();
    expect(registry.get(connectedTeamIdsAtom)).toEqual([teamA.id]);

    await view.cleanup();
  });

  it("does not restart the schedule poller when the shell re-renders", async () => {
    const registry = makeRegistry();
    server.connectedTeamIds = [teamA.id];
    const view = await mount(registry);

    expect(server.pollerStarts).toEqual([[teamA.id]]);

    // The bridge callbacks change identity on every render, which is what used
    // to tear the poller down — and a restart claims scheduled work again.
    await view.render(tree(registry, 1));
    await flush();
    await view.render(tree(registry, 2));
    await flush();

    expect(server.pollerStarts).toEqual([[teamA.id]]);
    expect(server.pollerStops).toEqual([]);

    await view.cleanup();
    expect(server.pollerStops).toEqual([0]);
  });

  it("restarts the schedule poller when the connected set changes", async () => {
    const registry = makeRegistry();
    server.connectedTeamIds = [teamA.id];
    const view = await mount(registry);

    await act(async () => {
      // A repository connected from elsewhere: the device now lists both teams.
      server.connectedTeamIds = [teamA.id, teamB.id];
      registry.set(connectedTeamIdsAtom, [teamA.id, teamB.id]);
    });
    await flush();

    expect(server.pollerStarts).toEqual([[teamA.id], [teamA.id, teamB.id]]);
    expect(server.pollerStops).toEqual([0]);

    await view.cleanup();
  });

  it("re-probes health on a workflow change but not on a run edit", async () => {
    const registry = makeRegistry();
    server.connectedTeamIds = [teamA.id];
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamA.id,
      payload: dashboardOf(teamA),
    });
    const view = await mount(registry);

    const probesAfterMount = server.healthProbes.length;
    expect(probesAfterMount).toBeGreaterThan(0);
    expect(registry.get(healthAtom).status).toBe("ready");

    // A run edit moves entities the probe never reads.
    await act(async () => {
      const run: HuntRun = {
        ...(demoDashboard.runs[0] as HuntRun),
        teamId: teamA.id,
        updatedAt: "2026-09-02T00:00:00.000Z",
      };
      applySyncEvent(registry, { kind: "run-changed", run, teamId: teamA.id });
    });
    await flush();
    expect(server.healthProbes).toHaveLength(probesAfterMount);

    // The workflow's required tools are exactly what the probe checks.
    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: teamA.id,
        payload: {
          ...dashboardOf(teamA),
          settings: {
            ...demoDashboard.settings,
            workflow: {
              ...demoDashboard.settings.workflow,
              requirements: [
                {
                  key: "rg",
                  label: "ripgrep",
                  check: { command: "rg --version" },
                },
              ] as never,
            },
          },
        },
      });
    });
    await flush();
    expect(server.healthProbes.length).toBeGreaterThan(probesAfterMount);

    await view.cleanup();
  });

  it("mirrors the shared workflow into every connected repository", async () => {
    const registry = makeRegistry();
    server.connectedTeamIds = [teamA.id, teamB.id];
    registry.set(connectedTeamIdsAtom, [teamA.id, teamB.id]);
    const view = await mount(registry);

    expect(server.workflowMirrors).toEqual([[teamA.id, teamB.id]]);

    await view.cleanup();
  });
});
