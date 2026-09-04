/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { repositoryWorkflowBootstrap } from "../../lib/auto-hunt-contract";
import { demoDashboard } from "../../lib/demo-data";
import { createReactTestRoot } from "../../test/react";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  HuntRun,
  Project,
  SessionUser,
  TeamSettings,
} from "../../types";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { hydratedAccountAtom } from "../persistence/hydration";
import { applySnapshot, collectSnapshot } from "../persistence/snapshot";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom, userAtom } from "../session/atoms";
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

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

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

/**
 * The page the loader's resumed cursor comes back with. It carries no
 * `settings`, so the workflow on screen stays the one the record held — the
 * server has confirmed it rather than replaced it.
 */
const resumeDelta = (
  generatedAt = "2026-09-02T00:00:00.000Z",
): DashboardDeltaPayload => ({
  cursor: 2,
  hasMore: false,
  reset: false,
  runs: [],
  deletedRunIds: [],
  workers: [],
  organizationProviders: [],
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

/** A signed-in registry with nothing loaded for the team yet. */
const seedRegistry = () => {
  server = new GenerationServer();
  return createTestRegistry([
    [tokenAtom, "token-1"],
    [userAtom, user],
    [activeOrganizationIdAtom, teamA.organizationId],
    [teamsAtom, [teamA]],
    [activeTeamIdAtom, teamA.id],
    [connectedTeamIdsAtom, [teamA.id]],
    [workspaceApiAtom, server.api],
    [workspaceModesAtom, { demoMode: false, remoteMode: false }],
  ]);
};

/** A boot that read no record: the pending settings came from the server. */
const makeRegistry = () => {
  const registry = seedRegistry();
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: dashboardOf(repositoryWorkflowBootstrap),
  });
  return registry;
};

/**
 * A cold boot that put the last run's store back from disk, the way
 * `useHydration` does: the record is written with `applySnapshot`, the account
 * it belongs to is recorded, and nothing has synced yet.
 */
const hydratedRegistry = () => {
  const stored = collectSnapshot(makeRegistry());
  if (!stored) throw new Error("the previous run stored nothing");
  const registry = seedRegistry();
  Atom.batch(() => {
    applySnapshot(registry, stored);
    registry.set(hydratedAccountAtom, {
      organizationId: stored.organizationId,
      userId: stored.userId,
    });
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
  // A boot that read no record. Nothing about it changed when the hydration
  // guard went in: the settings here arrived as a payload, so they are already
  // the server's answer.
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

  it("waits for the server before acting on hydrated pending settings", async () => {
    const registry = hydratedRegistry();
    const view = await mount(registry);

    // The placeholder on screen is the disk's. Another machine may well have
    // generated the workflow while this one was closed, and an LLM analysis of
    // the whole repository is not something to start on a guess.
    expect(server.generations).toEqual([]);
    expect(registry.get(teamSettingsAtom(teamA.id))?.workflow).toEqual(
      repositoryWorkflowBootstrap,
    );

    await view.cleanup();
  });

  it("generates once when the first page of the session is still pending", async () => {
    const registry = hydratedRegistry();
    const view = await mount(registry);
    expect(server.generations).toEqual([]);

    // The loader resumes from the stored cursor. Its page carries no settings,
    // which is the server confirming the pending placeholder.
    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-delta",
        teamId: teamA.id,
        payload: resumeDelta(),
      });
    });
    await flush();

    expect(server.generations).toEqual([teamA.id]);
    expect(registry.get(teamSettingsAtom(teamA.id))?.workflow).toBe(
      generatedWorkflow,
    );

    // And the next page does not start a second one.
    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-delta",
        teamId: teamA.id,
        payload: resumeDelta("2026-09-03T00:00:00.000Z"),
      });
    });
    await flush();
    expect(server.generations).toEqual([teamA.id]);

    await view.cleanup();
  });

  it("never generates when the first payload dropped the placeholder", async () => {
    const registry = hydratedRegistry();
    const view = await mount(registry);

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: teamA.id,
        payload: dashboardOf(generatedWorkflow, "2026-09-02T00:00:00.000Z"),
      });
    });
    await flush();

    // The redundant generation this guard exists to prevent.
    expect(server.generations).toEqual([]);

    await view.cleanup();
  });
});
