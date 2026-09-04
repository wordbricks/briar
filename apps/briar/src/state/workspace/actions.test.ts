import { describe, expect, it } from "vitest";

import type {
  PreparedProjectRepository,
  RepositoryReadiness,
} from "../../generated/tauri";
import { demoDashboard, demoRepositoryReadiness } from "../../lib/demo-data";
import type {
  DashboardPayload,
  Project,
  TeamSettings,
} from "../../types";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { loadingAtom, sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { readActiveTeamView } from "../../test/team-view";
import {
  activeTeamIdAtom,
  teamConnectionAtom,
  teamSettingsAtom,
  teamsAtom,
} from "../team/atoms";
import { createWorkspaceActions } from "./actions";
import {
  workspaceApiAtom,
  workspaceModesAtom,
  type WorkspaceApi,
} from "./api";
import {
  connectedTeamIdsAtom,
  healthAtom,
  teamReadinessAtom,
} from "./atoms";

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  icon: null,
  iconName: null,
});
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const settingsOf = (overrides: Partial<TeamSettings> = {}): TeamSettings => ({
  ...demoDashboard.settings,
  githubRepositoryId: 42,
  githubRepository: "wordbricks/briar",
  ...overrides,
});

const dashboardOf = (team: Project, settings = settingsOf()): DashboardPayload => ({
  ...demoDashboard,
  team,
  settings,
  runs: [],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const readinessOf = (path: string): RepositoryReadiness => ({
  ...demoRepositoryReadiness,
  repositoryPath: path,
});

const preparedOf = (path: string): PreparedProjectRepository => ({
  repositoryPath: path,
  repositoryId: 42,
  repository: "wordbricks/briar",
  reused: false,
  completedSteps: [],
});

/**
 * In-memory stand-ins for the Tauri commands and team endpoints the workspace
 * flows call. Every one of them records what it was asked to do, so a test can
 * assert the order the flows keep between this device and the server.
 */
class WorkspaceServer {
  connectedTeamIds: string[] = [];
  readonly connected: string[] = [];
  readonly disconnected: string[] = [];
  readonly workersConfigured: string[] = [];
  readonly settingsWrites: { teamId: string; settings: TeamSettings }[] = [];
  readonly localWorkflowWrites: string[] = [];
  readonly deletedTeams: string[] = [];
  readonly readiness = new Map<string, RepositoryReadiness>();
  inventoryError: Error | null = null;
  connectError: Error | null = null;
  disconnectError: Error | null = null;
  repairError: Error | null = null;
  healthy = true;

  api: Partial<WorkspaceApi> = {
    loadConnectedTeamIds: async () => {
      if (this.inventoryError) throw this.inventoryError;
      return [...this.connectedTeamIds];
    },
    loadTeamRepositoryReadiness: async (teamId) =>
      this.readiness.get(teamId) ?? null,
    loadAutoHuntHealth: async (teamId) => ({
      ...(demoDashboard as unknown as { health?: never }),
      projectId: teamId,
      healthy: this.healthy,
    }) as never,
    repairAutoHunt: async (teamId) => {
      if (this.repairError) throw this.repairError;
      return { projectId: teamId, healthy: true } as never;
    },
    updateLocalTeamWorkflow: async (teamId, workflow) => {
      this.localWorkflowWrites.push(teamId);
      return workflow;
    },
    connectLocalTeam: async (input) => {
      if (this.connectError) throw this.connectError;
      this.connected.push(input.projectId);
      this.connectedTeamIds = [...this.connectedTeamIds, input.projectId];
      return {
        repositoryPath: input.repositoryPath,
        workflow: input.autoHunt.workflow,
      } as never;
    },
    disconnectLocalTeam: async (teamId) => {
      if (this.disconnectError) throw this.disconnectError;
      this.disconnected.push(teamId);
    },
    configureLocalExecutionWorker: async (teamId) => {
      this.workersConfigured.push(teamId);
      return true as never;
    },
    createAgentToken: async () => ({ agentToken: "agent-token" }) as never,
    createProjectGithubCredential: async () =>
      ({
        project: { id: teamA.id, organizationId: teamA.organizationId },
        repository: {
          id: 42,
          fullName: "wordbricks/briar",
          cloneUrl: "https://example.invalid/briar.git",
        },
        username: "x-access-token",
        password: "secret",
        expiresAt: "2026-09-02T00:00:00.000Z",
      }) as never,
    prepareTeamRepository: async (teamId) => preparedOf(`/repos/${teamId}`),
    discoverRepositoryIcon: async () => null,
    updateTeamSettings: async (_token, teamId, settings) => {
      this.settingsWrites.push({ teamId, settings });
      return { settings } as never;
    },
    deleteTeam: async (_token, teamId) => {
      this.deletedTeams.push(teamId);
      this.connectedTeamIds = this.connectedTeamIds.filter(
        (candidate) => candidate !== teamId,
      );
      return undefined as never;
    },
    loadDashboard: async (_token, teamId) => dashboardOf(teamOf(teamId)),
    generateTeamWorkflow: async () => demoDashboard.settings.workflow,
    loadGithubIntegration: async () =>
      ({
        connected: true,
        repositories: [{ fullName: "wordbricks/briar" }],
      }) as never,
  };
}

interface Harness {
  readonly actions: ReturnType<typeof createWorkspaceActions>;
  readonly registry: AtomRegistry;
  readonly server: WorkspaceServer;
}

const harness = (
  options: { readonly demoMode?: boolean; readonly teams?: Project[] } = {},
): Harness => {
  const server = new WorkspaceServer();
  const registry = createTestRegistry([
    [tokenAtom, "token-1"],
    [teamsAtom, options.teams ?? [teamA, teamB]],
    [activeTeamIdAtom, teamA.id],
    [organizationsAtom, [{ ...demoDashboard.team, id: teamA.organizationId }]],
    [activeOrganizationIdAtom, teamA.organizationId],
    [workspaceApiAtom, server.api],
    [
      workspaceModesAtom,
      { demoMode: options.demoMode ?? false, remoteMode: false },
    ],
  ]);
  return { actions: createWorkspaceActions(registry), registry, server };
};

/** Puts a team's payload in the store, as a snapshot load does. */
const loadTeam = (
  registry: AtomRegistry,
  team: Project,
  settings = settingsOf(),
) =>
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: team.id,
    payload: dashboardOf(team, settings),
  });

describe("createWorkspaceActions", () => {
  it("probes the selected team's health only once it is connected here", async () => {
    const { actions, registry, server } = harness();

    // Nothing is connected to this device yet, so there is nothing to probe.
    expect(await actions.refreshHealth()).toBeNull();
    expect(registry.get(healthAtom).status).toBe("idle");

    registry.set(connectedTeamIdsAtom, [teamA.id]);
    const health = await actions.refreshHealth();

    expect(health?.projectId).toBe(teamA.id);
    expect(registry.get(healthAtom)).toEqual({
      status: "ready",
      value: health,
      error: null,
    });
    expect(server.settingsWrites).toEqual([]);
  });

  it("keeps the last health on screen when a repair fails", async () => {
    const { actions, registry, server } = harness();
    registry.set(connectedTeamIdsAtom, [teamA.id]);
    const probed = await actions.refreshHealth();

    server.repairError = new Error("설치 실패");
    expect(await actions.repairHealth()).toBeNull();

    expect(registry.get(healthAtom)).toEqual({
      status: "error",
      value: probed,
      error: "설치 실패",
    });
  });

  it("drops a health probe that outlived its team", async () => {
    const { actions, registry } = harness();
    registry.set(connectedTeamIdsAtom, [teamA.id, teamB.id]);

    const probe = actions.refreshHealth();
    registry.set(activeTeamIdAtom, teamB.id);

    expect(await probe).toBeNull();
    // The superseded probe wrote nothing, so the loading marker the newer one
    // owns is still up.
    expect(registry.get(healthAtom).value).toBeNull();
  });

  it("blanks a team's readiness before re-probing it", async () => {
    const { actions, registry, server } = harness();
    server.connectedTeamIds = [teamA.id];
    server.readiness.set(teamA.id, readinessOf("/repos/team-a"));

    const readiness = await actions.refreshProjectReadiness(teamA.id);

    expect(readiness?.repositoryPath).toBe("/repos/team-a");
    expect(registry.get(teamReadinessAtom(teamA.id))).toEqual({
      readiness,
      error: null,
      loading: false,
    });
    // The probe carried the inventory it read, so nothing else has to fetch it.
    expect(registry.get(connectedTeamIdsAtom)).toEqual([teamA.id]);
  });

  it("reports a readiness probe failure against the team that failed", async () => {
    const { actions, registry, server } = harness();
    server.connectedTeamIds = [teamA.id];

    await actions.refreshProjectReadiness(teamA.id);

    expect(registry.get(teamReadinessAtom(teamA.id)).error).toBe(
      "로컬 저장소 준비 상태를 확인할 수 없습니다.",
    );
    expect(registry.get(teamReadinessAtom(teamB.id)).error).toBeNull();
  });

  it("connects a repository and mirrors the settings the server accepted", async () => {
    const { actions, registry, server } = harness();
    loadTeam(registry, teamA);
    registry.set(teamConnectionAtom, {
      kind: "new",
      project: teamA,
      agentToken: null,
      workflow: undefined,
    });
    server.readiness.set(teamA.id, readinessOf("/repos/team-a"));

    const connected = await actions.connectProject(
      {
        velenOrg: "wordbricks",
        dataSource: null,
        linearEnabled: false,
        workflow: demoDashboard.settings.workflow,
      },
      "/repos/team-a",
    );

    expect(connected.repositoryPath).toBe("/repos/team-a");
    // Local config first, then the server settings that share the workflow.
    expect(server.connected).toEqual([teamA.id]);
    expect(server.localWorkflowWrites).toEqual([teamA.id]);
    expect(server.workersConfigured).toEqual([teamA.id]);
    expect(registry.get(connectedTeamIdsAtom)).toEqual([teamA.id]);
    // The generated draft is canonicalized on its way through, so the flow is
    // asserted on rather than the literal it started from.
    expect(registry.get(teamConnectionAtom)?.workflow?.version).toBe(
      demoDashboard.settings.workflow.version,
    );
    expect(registry.get(loadingAtom)).toBe(false);
  });

  it("refuses a connection the local inventory does not confirm", async () => {
    const { actions, registry, server } = harness();
    loadTeam(registry, teamA);
    registry.set(teamConnectionAtom, {
      kind: "new",
      project: teamA,
      agentToken: null,
      workflow: undefined,
    });
    // The command reports success but the inventory does not list the team.
    server.api = {
      ...server.api,
      connectLocalTeam: async (input) =>
        ({ repositoryPath: input.repositoryPath }) as never,
    };
    registry.set(workspaceApiAtom, server.api);

    await expect(
      actions.connectProject(
        {
          velenOrg: null,
          linearEnabled: false,
          workflow: demoDashboard.settings.workflow,
        },
        "/repos/team-a",
      ),
    ).rejects.toThrow("저장된 로컬 프로젝트 연결을 다시 확인하지 못했습니다.");
    expect(registry.get(sessionErrorAtom)).toContain(
      "저장된 로컬 프로젝트 연결",
    );
  });

  it("prepares a configured repository and commits its settings", async () => {
    const { actions, registry, server } = harness();
    loadTeam(registry, teamA);

    const prepared = await actions.prepareGithubProjectRepository(
      teamA.id,
      "wordbricks/briar",
    );

    expect(prepared.repository).toBe("wordbricks/briar");
    expect(registry.get(teamSettingsAtom(teamA.id))?.githubRepository).toBe(
      "wordbricks/briar",
    );
    expect(server.settingsWrites).toHaveLength(1);
  });

  it("rejects a repository outside the organization's GitHub App scope", async () => {
    const { actions } = harness();

    await expect(
      actions.resolveGithubProjectRepository("someone/else"),
    ).rejects.toThrow("저장소 접근 범위에 없습니다");
    await expect(
      actions.resolveGithubProjectRepository("WordBricks/Briar"),
    ).resolves.toBe("wordbricks/briar");
  });

  it("connects a second machine to a team that is already configured", async () => {
    const { actions, registry, server } = harness();
    loadTeam(registry, teamA);
    server.readiness.set(teamA.id, readinessOf("/repos/team-a"));

    const result = await actions.startWorkingOnProject(teamA.id);

    expect(result?.readiness.repositoryPath).toBe("/repos/team-a");
    expect(server.connected).toEqual([teamA.id]);
    expect(server.workersConfigured).toEqual([teamA.id]);
    expect(registry.get(teamReadinessAtom(teamA.id))).toEqual({
      readiness: result?.readiness,
      error: null,
      loading: false,
    });
  });

  it("deletes a team, its local connection and everything it owned", async () => {
    const { actions, registry, server } = harness();
    loadTeam(registry, teamA);
    registry.set(connectedTeamIdsAtom, [teamA.id, teamB.id]);
    registry.set(teamReadinessAtom(teamA.id), {
      readiness: readinessOf("/repos/team-a"),
      error: null,
      loading: false,
    });
    registry.set(healthAtom, {
      status: "ready",
      value: null,
      error: null,
    });

    await actions.removeProject(teamA.id);

    expect(server.deletedTeams).toEqual([teamA.id]);
    expect(server.disconnected).toEqual([teamA.id]);
    expect(registry.get(teamsAtom)).toEqual([teamB]);
    expect(registry.get(activeTeamIdAtom)).toBe(teamB.id);
    expect(registry.get(connectedTeamIdsAtom)).toEqual([teamB.id]);
    expect(registry.get(teamReadinessAtom(teamA.id)).readiness).toBeNull();
    expect(registry.get(healthAtom).status).toBe("idle");
  });

  it("keeps the team deleted when only the local cleanup failed", async () => {
    const { actions, registry, server } = harness();
    server.disconnectError = new Error("파일이 잠겼습니다");

    await actions.removeProject(teamA.id);

    expect(server.deletedTeams).toEqual([teamA.id]);
    expect(registry.get(teamsAtom)).toEqual([teamB]);
    expect(registry.get(sessionErrorAtom)).toContain(
      "로컬 연결 정리에 실패했습니다",
    );
  });

  it("opens reconnect with the workflow the team already has", async () => {
    const { actions, registry } = harness();
    loadTeam(registry, teamA);

    expect(await actions.reconnectProject(teamA.id)).toBe("opened");

    expect(registry.get(teamConnectionAtom)).toEqual({
      kind: "reconnect",
      project: teamA,
      agentToken: null,
      workflow: settingsOf().workflow,
    });
    expect(registry.get(activeTeamIdAtom)).toBe(teamA.id);
  });

  it("reports a reconnect for a team the account does not have", async () => {
    const { actions, registry } = harness();

    expect(await actions.reconnectProject("team-missing")).toBe("failed");
    expect(registry.get(teamConnectionAtom)).toBeNull();
  });

  it("drops a reconnect a newer one replaced", async () => {
    const { actions, registry, server } = harness();
    // The selected team's payload is on screen, so its own reconnect resolves
    // without waiting for the fetch the other team's is stuck on.
    loadTeam(registry, teamA);
    let releaseDashboard: (payload: DashboardPayload) => void = () => undefined;
    server.api = {
      ...server.api,
      loadDashboard: () =>
        new Promise<DashboardPayload>((resolve) => {
          releaseDashboard = resolve;
        }),
    };
    registry.set(workspaceApiAtom, server.api);

    const first = actions.reconnectProject(teamB.id);
    // A second attempt bumps the shared generation the first one holds.
    await actions.reconnectProject(teamA.id).catch(() => undefined);
    releaseDashboard(dashboardOf(teamB));

    expect(await first).toBe("superseded");
    expect(registry.get(teamConnectionAtom)?.project.id).toBe(teamA.id);
  });

  it("creates a demo team locally and opens its connection flow", async () => {
    const { actions, registry } = harness({ demoMode: true, teams: [] });

    const { project, agentToken } = await actions.addProject({ name: " Demo " });

    expect(agentToken).toBeNull();
    expect(project.name).toBe("Demo");
    expect(registry.get(teamsAtom)).toEqual([project]);
    expect(registry.get(activeTeamIdAtom)).toBe(project.id);
    expect(readActiveTeamView(registry)?.team.id).toBe(project.id);
  });
});
