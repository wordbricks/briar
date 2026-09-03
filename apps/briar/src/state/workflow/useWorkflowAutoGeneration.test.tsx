/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { repositoryWorkflowBootstrap } from "../../lib/auto-hunt-contract";
import { demoDashboard } from "../../lib/demo-data";
import { createReactTestRoot } from "../../test/react";
import type { DashboardPayload, HuntRun, Project, TeamSettings } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import {
  activeTeamIdAtom,
  teamConnectionAtom,
  teamSettingsAtom,
  teamsAtom,
} from "../team/atoms";
import {
  workspaceApiAtom,
  workspaceModesAtom,
  type WorkspaceApi,
} from "../workspace/api";
import { connectedTeamIdsAtom } from "../workspace/atoms";
import { useWorkflowAutoGeneration } from "./useWorkflowAutoGeneration";

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");

const generatedWorkflow = {
  ...demoDashboard.settings.workflow,
  label: "generated",
} as TeamSettings["workflow"];

const settingsWith = (
  workflow: TeamSettings["workflow"],
): TeamSettings => ({ ...demoDashboard.settings, workflow });

const dashboardOf = (
  workflow: TeamSettings["workflow"],
  generatedAt = "2026-09-01T00:00:00.000Z",
): DashboardPayload => ({
  ...demoDashboard,
  team: teamA,
  settings: settingsWith(workflow),
  runs: [],
  cursor: 1,
  generatedAt,
});

class GenerationServer {
  readonly generations: string[] = [];
  generateError: Error | null = null;

  readonly api: Partial<WorkspaceApi> = {
    generateTeamWorkflow: async (teamId) => {
      this.generations.push(teamId);
      if (this.generateError) throw this.generateError;
      return generatedWorkflow;
    },
    updateLocalTeamWorkflow: async (_teamId, workflow) => workflow,
    updateTeamSettings: async (_token, _teamId, settings) =>
      ({ settings }) as never,
    loadConnectedTeamIds: async () => [teamA.id],
    loadTeamRepositoryReadiness: async () => null,
    loadAutoHuntHealth: async () => null,
  };
}

let server: GenerationServer;

const makeRegistry = () => {
  server = new GenerationServer();
  const registry = createTestRegistry([
    [tokenAtom, "token-1"],
    [teamsAtom, [teamA]],
    [activeTeamIdAtom, teamA.id],
    [connectedTeamIdsAtom, [teamA.id]],
    [workspaceApiAtom, server.api],
    [workspaceModesAtom, { demoMode: false, remoteMode: false }],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: dashboardOf(repositoryWorkflowBootstrap),
  });
  return registry;
};

function Effects() {
  useWorkflowAutoGeneration();
  return null;
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Effects />
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe("useWorkflowAutoGeneration", () => {
  it("generates the pending workflow once per team", async () => {
    const registry = makeRegistry();
    const view = await mount(registry);

    expect(server.generations).toEqual([teamA.id]);
    expect(registry.get(teamSettingsAtom(teamA.id))?.workflow).toBe(
      generatedWorkflow,
    );

    // The settings changed, so the effect re-runs — and finds nothing pending.
    await flush();
    expect(server.generations).toEqual([teamA.id]);

    await view.cleanup();
  });

  it("ignores a run change", async () => {
    const registry = makeRegistry();
    const view = await mount(registry);
    const generationsAfterMount = server.generations.length;

    await act(async () => {
      const run: HuntRun = {
        ...(demoDashboard.runs[0] as HuntRun),
        teamId: teamA.id,
        updatedAt: "2026-09-02T00:00:00.000Z",
      };
      applySyncEvent(registry, { kind: "run-changed", run, teamId: teamA.id });
    });
    await flush();

    expect(server.generations).toHaveLength(generationsAfterMount);

    await view.cleanup();
  });

  it("leaves the team alone while its connection flow is open", async () => {
    const registry = makeRegistry();
    registry.set(teamConnectionAtom, {
      kind: "reconnect",
      project: teamA,
      agentToken: null,
      workflow: undefined,
    });
    const view = await mount(registry);

    // The connection flow generates its own workflow; two analyses of the same
    // repository would race each other.
    expect(server.generations).toEqual([]);

    await view.cleanup();
  });

  it("does not retry a team whose generation failed", async () => {
    const registry = makeRegistry();
    server.generateError = new Error("LLM 응답 없음");
    const view = await mount(registry);

    expect(server.generations).toEqual([teamA.id]);

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: teamA.id,
        payload: dashboardOf(
          repositoryWorkflowBootstrap,
          "2026-09-02T00:00:00.000Z",
        ),
      });
    });
    await flush();

    expect(server.generations).toEqual([teamA.id]);

    await view.cleanup();
  });

  it("does nothing for a team with no local checkout", async () => {
    const registry = makeRegistry();
    registry.set(connectedTeamIdsAtom, []);
    const view = await mount(registry);

    expect(server.generations).toEqual([]);

    await view.cleanup();
  });
});
