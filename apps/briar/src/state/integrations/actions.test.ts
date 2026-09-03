import { describe, expect, it } from "vitest";

import type { VelenInspection } from "../../generated/tauri";
import { demoDashboard } from "../../lib/demo-data";
import type { DashboardPayload, Project, TeamSettings } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamSettingsAtom, teamsAtom } from "../team/atoms";
import {
  workspaceApiAtom,
  workspaceModesAtom,
  type WorkspaceApi,
} from "../workspace/api";
import { connectedTeamIdsAtom, healthAtom } from "../workspace/atoms";
import { createIntegrationActions } from "./actions";
import { velenAtom } from "./atoms";

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const settingsOf = (overrides: Partial<TeamSettings> = {}): TeamSettings => ({
  ...demoDashboard.settings,
  velenOrg: "wordbricks",
  dataSource: "linear-wordbricks",
  linear: { enabled: true, source: "linear-wordbricks", teamKey: "BRI" },
  githubRepository: null,
  ...overrides,
});

const dashboardOf = (
  team: Project,
  settings = settingsOf(),
): DashboardPayload => ({
  ...demoDashboard,
  team,
  settings,
  runs: [],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const inspection: VelenInspection = {
  authenticated: true,
  email: "tester@briar.local",
  currentOrg: "wordbricks",
  organizations: [{ name: "Wordbricks", slug: "wordbricks" }],
  sources: [],
};

class IntegrationServer {
  readonly localVelenOrgs: (string | null)[] = [];
  readonly settingsWrites: TeamSettings[] = [];
  readonly imports: string[] = [];
  velenError: Error | null = null;
  settingsError: Error | null = null;
  localRollbackError: Error | null = null;

  readonly api: Partial<WorkspaceApi> = {
    inspectVelen: async () => {
      if (this.velenError) throw this.velenError;
      return inspection;
    },
    updateLocalTeamVelenOrg: async (_teamId, org) => {
      if (this.localRollbackError && this.localVelenOrgs.length > 0) {
        throw this.localRollbackError;
      }
      this.localVelenOrgs.push(org);
      return org;
    },
    updateTeamSettings: async (_token, _teamId, settings) => {
      if (this.settingsError) throw this.settingsError;
      this.settingsWrites.push(settings);
      return { settings } as never;
    },
    connectLinearImport: async () =>
      ({ viewer: { name: "V" }, teams: [] }) as never,
    loadLinearImportStates: async () => ({ states: [] }) as never,
    importLinearIssues: async (_token, teamId) => {
      this.imports.push(teamId);
      return { imported: 1, skipped: 0, failed: 0, total: 1 } as never;
    },
    loadDashboard: async (_token, teamId) => dashboardOf(teamOf(teamId)),
  };
}

interface Harness {
  readonly actions: ReturnType<typeof createIntegrationActions>;
  readonly registry: AtomRegistry;
  readonly server: IntegrationServer;
}

const harness = (
  options: {
    readonly demoMode?: boolean;
    readonly remoteMode?: boolean;
    readonly settings?: TeamSettings;
  } = {},
): Harness => {
  const server = new IntegrationServer();
  const registry = createTestRegistry([
    [tokenAtom, "token-1"],
    [teamsAtom, [teamA, teamB]],
    [activeTeamIdAtom, teamA.id],
    [workspaceApiAtom, server.api],
    [
      workspaceModesAtom,
      {
        demoMode: options.demoMode ?? false,
        remoteMode: options.remoteMode ?? false,
      },
    ],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: dashboardOf(teamA, options.settings ?? settingsOf()),
  });
  return { actions: createIntegrationActions(registry), registry, server };
};

describe("createIntegrationActions", () => {
  it("stores the Velen inspection and clears the app error", async () => {
    const { actions, registry } = harness();
    registry.set(sessionErrorAtom, "이전 오류");

    expect(await actions.refreshVelen("wordbricks")).toBe(inspection);
    expect(registry.get(velenAtom)).toBe(inspection);
    expect(registry.get(sessionErrorAtom)).toBeNull();
  });

  it("reports a failed inspection instead of throwing", async () => {
    const { actions, registry, server } = harness();
    registry.set(velenAtom, inspection);
    server.velenError = new Error("velen 로그인이 필요합니다");

    expect(await actions.refreshVelen()).toBeNull();
    expect(registry.get(velenAtom)).toBeNull();
    expect(registry.get(sessionErrorAtom)).toBe("velen 로그인이 필요합니다");
  });

  it("writes the local Velen organization before the server", async () => {
    const { actions, registry, server } = harness();

    expect(await actions.saveVelenIntegration(teamA.id, " acme ")).toBe("acme");

    expect(server.localVelenOrgs).toEqual(["acme"]);
    expect(server.settingsWrites).toHaveLength(1);
    expect(registry.get(teamSettingsAtom(teamA.id))?.velenOrg).toBe("acme");
  });

  it("clears what the Velen organization addressed when it is removed", async () => {
    const { actions, registry, server } = harness();

    expect(await actions.saveVelenIntegration(teamA.id, "  ")).toBeNull();

    expect(server.settingsWrites[0]).toMatchObject({
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
    });
    expect(registry.get(teamSettingsAtom(teamA.id))?.linear.enabled).toBe(false);
  });

  it("rolls the local Velen organization back when the server refuses", async () => {
    const { actions, registry, server } = harness();
    server.settingsError = new Error("권한이 없습니다");

    await expect(
      actions.saveVelenIntegration(teamA.id, "acme"),
    ).rejects.toThrow("권한이 없습니다");

    expect(server.localVelenOrgs).toEqual(["acme", "wordbricks"]);
    expect(registry.get(teamSettingsAtom(teamA.id))?.velenOrg).toBe(
      "wordbricks",
    );
  });

  it("reports both failures when the Velen rollback also fails", async () => {
    const { actions, server } = harness();
    server.settingsError = new Error("권한이 없습니다");
    server.localRollbackError = new Error("디스크가 잠겼습니다");

    await expect(
      actions.saveVelenIntegration(teamA.id, "acme"),
    ).rejects.toThrow(
      "Velen 연결 저장에 실패했고 로컬 설정도 복구하지 못했습니다: 권한이 없습니다 (디스크가 잠겼습니다)",
    );
  });

  it("never writes this device's config in companion mode", async () => {
    const { actions, server } = harness({ remoteMode: true });

    expect(await actions.saveVelenIntegration(teamA.id, "acme")).toBe("acme");

    expect(server.localVelenOrgs).toEqual([]);
    expect(server.settingsWrites).toHaveLength(1);
  });

  it("refuses a Velen write for a team that is not on screen", async () => {
    const { actions } = harness();

    await expect(
      actions.saveVelenIntegration(teamB.id, "acme"),
    ).rejects.toThrow("Velen 연결을 저장할 팀 설정이 없습니다.");
  });

  it("requires a repository before importing Linear issues", async () => {
    const { actions, registry } = harness();

    await expect(
      actions.connectLinearForImport(teamA.id, "lin_api"),
    ).rejects.toThrow("저장소를 연결한 뒤에 Linear 이슈를 가져올 수 있습니다.");

    // Either half of the check is enough: a GitHub repository in team settings…
    registry.set(
      teamSettingsAtom(teamA.id),
      settingsOf({ githubRepository: "wordbricks/briar" }),
    );
    await expect(
      actions.connectLinearForImport(teamA.id, "lin_api"),
    ).resolves.toMatchObject({ viewer: { name: "V" } });

    // …or a checkout on this device.
    registry.set(teamSettingsAtom(teamA.id), settingsOf());
    registry.set(connectedTeamIdsAtom, [teamA.id]);
    await expect(
      actions.loadLinearStatesForImport(teamA.id, {
        apiKey: "lin_api",
        teamIds: ["linear-team"],
      }),
    ).resolves.toEqual({ states: [] });
  });

  it("accepts the local repository path the health probe found", async () => {
    const { actions, registry } = harness();
    registry.set(healthAtom, {
      status: "ready",
      value: { projectId: teamA.id, repositoryPath: "/repos/team-a" } as never,
      error: null,
    });

    await expect(
      actions.runLinearIssueImport(teamA.id, {
        apiKey: "lin_api",
        teamIds: ["linear-team"],
        statusMapping: {} as never,
      }),
    ).resolves.toMatchObject({ imported: 1 });
  });

  it("substitutes a fixed import result in demo mode", async () => {
    const { actions, registry, server } = harness({ demoMode: true });
    registry.set(connectedTeamIdsAtom, [teamA.id]);

    const result = await actions.runLinearIssueImport(teamA.id, {
      apiKey: "lin_api",
      teamIds: ["linear-team"],
      statusMapping: {} as never,
    });

    expect(result.imported).toBe(3);
    expect(server.imports).toEqual([]);
  });
});
