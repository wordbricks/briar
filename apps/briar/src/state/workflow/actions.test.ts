import { describe, expect, it } from "vitest";

import { demoDashboard, demoRepositoryReadiness } from "../../lib/demo-data";
import type { DashboardPayload, Project, TeamSettings } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamSettingsAtom, teamsAtom } from "../team/atoms";
import {
  workspaceApiAtom,
  workspaceModesAtom,
  type WorkspaceApi,
} from "../workspace/api";
import { connectedTeamIdsAtom, healthAtom } from "../workspace/atoms";
import { createWorkflowActions } from "./actions";

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

const revisedWorkflow = {
  ...demoDashboard.settings.workflow,
  label: "revised",
} as TeamSettings["workflow"];

/** Records the local and remote writes a workflow change performs, in order. */
class WorkflowServer {
  readonly writes: string[] = [];
  readonly localWorkflows: TeamSettings["workflow"][] = [];
  settingsError: Error | null = null;
  localRollbackError: Error | null = null;

  readonly api: Partial<WorkspaceApi> = {
    updateLocalTeamWorkflow: async (_teamId, workflow) => {
      if (
        this.localRollbackError &&
        this.localWorkflows.length > 0
      ) {
        throw this.localRollbackError;
      }
      this.writes.push("local");
      this.localWorkflows.push(workflow);
      return workflow;
    },
    updateTeamSettings: async (_token, _teamId, settings) => {
      if (this.settingsError) throw this.settingsError;
      this.writes.push("server");
      return { settings } as never;
    },
    updateCheckpointPolicy: async (_token, _teamId, input) => {
      this.writes.push("checkpoints");
      return {
        checkpointPolicy: {
          availableBoundaries: [],
          teamMandatory: input.checkpoints,
          userDefaults: [],
          effective: [],
          teamRevision: input.expectedRevision + 1,
          userRevision: 0,
        },
      } as never;
    },
    generateTeamWorkflow: async () => revisedWorkflow,
    analyzeTeamWorkflowRequirements: async () => revisedWorkflow,
    reviseTeamWorkflow: async () => revisedWorkflow,
    loadConnectedTeamIds: async () => [teamA.id],
    loadTeamRepositoryReadiness: async () => demoRepositoryReadiness,
    loadAutoHuntHealth: async (teamId) =>
      ({ projectId: teamId, healthy: true }) as never,
  };
}

interface Harness {
  readonly actions: ReturnType<typeof createWorkflowActions>;
  readonly registry: AtomRegistry;
  readonly server: WorkflowServer;
}

const harness = (options: { readonly demoMode?: boolean } = {}): Harness => {
  const server = new WorkflowServer();
  const registry = createTestRegistry([
    [tokenAtom, "token-1"],
    [teamsAtom, [teamA, teamB]],
    [activeTeamIdAtom, teamA.id],
    [connectedTeamIdsAtom, [teamA.id]],
    [workspaceApiAtom, server.api],
    [
      workspaceModesAtom,
      { demoMode: options.demoMode ?? false, remoteMode: false },
    ],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: dashboardOf(teamA),
  });
  return { actions: createWorkflowActions(registry), registry, server };
};

describe("createWorkflowActions", () => {
  it("writes the local config before the server and probes what changed", async () => {
    const { actions, registry, server } = harness();

    const workflow = await actions.regenerateWorkflow(teamA.id);

    expect(workflow).toBe(revisedWorkflow);
    // A machine whose config claims a workflow the team never accepted would
    // run the wrong checks, so the local write always comes first.
    expect(server.writes.slice(0, 2)).toEqual(["local", "server"]);
    // The health probe that follows mirrors the accepted workflow again, which
    // is how the tool checks stop reporting the previous one.
    expect(server.writes).toEqual(["local", "server", "local"]);
    expect(registry.get(teamSettingsAtom(teamA.id))?.workflow).toBe(
      revisedWorkflow,
    );
    // The tools the probe checks just changed, so both probes re-run.
    expect(registry.get(healthAtom).status).toBe("ready");
  });

  it("rolls the local config back when the server refuses", async () => {
    const { actions, registry, server } = harness();
    server.settingsError = new Error("권한이 없습니다");

    await expect(actions.regenerateWorkflow(teamA.id)).rejects.toThrow(
      "권한이 없습니다",
    );

    expect(server.localWorkflows).toEqual([
      revisedWorkflow,
      demoDashboard.settings.workflow,
    ]);
    expect(registry.get(teamSettingsAtom(teamA.id))?.workflow).toBe(
      demoDashboard.settings.workflow,
    );
  });

  it("reports both failures when the rollback also fails", async () => {
    const { actions, server } = harness();
    server.settingsError = new Error("권한이 없습니다");
    server.localRollbackError = new Error("디스크가 잠겼습니다");

    await expect(actions.regenerateWorkflow(teamA.id)).rejects.toThrow(
      "워크플로우 저장에 실패했고 로컬 설정도 복구하지 못했습니다: 권한이 없습니다 (디스크가 잠겼습니다)",
    );
  });

  it("refuses to change a workflow for a team that is not on screen", async () => {
    const { actions } = harness();

    await expect(actions.regenerateWorkflow(teamB.id)).rejects.toThrow(
      "워크플로우를 갱신할 팀 설정이 없습니다.",
    );
    await expect(
      actions.analyzeWorkflowRequirements(teamB.id),
    ).rejects.toThrow("필요 도구를 분석할 팀 설정이 없습니다.");
    await expect(
      actions.saveCheckpointPolicy(teamB.id, "project", [], 0),
    ).rejects.toThrow("체크포인트를 저장할 팀 설정이 없습니다.");
  });

  it("keeps every generator off the demo build", async () => {
    const { actions } = harness({ demoMode: true });

    await expect(actions.regenerateWorkflow(teamA.id)).rejects.toThrow(
      "워크플로우 재생성은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
    );
    await expect(
      actions.analyzeWorkflowRequirements(teamA.id),
    ).rejects.toThrow("필요 도구 분석은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
    await expect(actions.reviseWorkflow(teamA.id, "x")).rejects.toThrow(
      "워크플로우 수정은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
    );
  });

  it("commits a checkpoint policy without touching the workflow", async () => {
    const { actions, registry, server } = harness();

    const policy = await actions.saveCheckpointPolicy(
      teamA.id,
      "project",
      [],
      3,
    );

    expect(policy.teamRevision).toBe(4);
    expect(server.writes).toEqual(["checkpoints"]);
    expect(registry.get(teamSettingsAtom(teamA.id))?.checkpointPolicy).toEqual(
      policy,
    );
    expect(registry.get(teamSettingsAtom(teamA.id))?.workflow).toBe(
      demoDashboard.settings.workflow,
    );
  });
});
