import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Workspace, Project } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { reconnectRequestGeneration } from "../local-workspace/api";
import { healthAtom } from "../local-workspace/atoms";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { readTeamView } from "../../test/team-view";
import { activeTeamIdAtom, staleTeamIdAtom, teamsAtom } from "../team/atoms";
import { lockedTeamIdAtom } from "../platform";
import {
  createWorkspaceActions,
  type WorkspaceActionApi,
} from "./actions";
import { activeWorkspaceIdAtom, workspacesAtom } from "./atoms";

const organizationA: Workspace = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const organizationB: Workspace = {
  ...organizationA,
  id: "org-b",
  name: "Org B",
  handle: "org-b",
};

const teamOf = (id: string, workspace: Workspace): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  workspaceId: workspace.id,
  workspaceName: workspace.name,
});

const teamA = teamOf("team-a", organizationA);
const teamB = teamOf("team-b", organizationB);

/**
 * In-memory stand-in for the workspace RPCs. It records what was asked so a
 * test can assert an action reached the server exactly once, and echoes the
 * requested change back the way the Worker does.
 */
class WorkspaceServer {
  readonly created: { name: string; handle: string }[] = [];
  readonly renamed: [string, string][] = [];
  readonly logos: [string, string | null][] = [];
  readonly handleChecks: string[] = [];
  takenHandles = new Set<string>();

  private workspaces: Workspace[];

  constructor(workspaces: Workspace[]) {
    this.workspaces = [...workspaces];
  }

  private require(workspaceId: string) {
    const workspace = this.workspaces.find(
      (candidate) => candidate.id === workspaceId,
    );
    if (!workspace) throw new Error(`unknown workspace ${workspaceId}`);
    return workspace;
  }

  readonly api: WorkspaceActionApi = {
    createWorkspace: async (_token, input) => {
      this.created.push({ ...input });
      const workspace: Workspace = {
        id: `remote-${input.handle}`,
        name: input.name,
        handle: input.handle,
        logo: null,
        role: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      };
      this.workspaces.push(workspace);
      return { workspace };
    },
    isWorkspaceHandleAvailable: async (_token, handle) => {
      this.handleChecks.push(handle);
      return !this.takenHandles.has(handle);
    },
    updateWorkspace: async (_token, workspaceId, name) => {
      this.renamed.push([workspaceId, name]);
      return { workspace: { ...this.require(workspaceId), name } };
    },
    updateWorkspaceLogo: async (_token, workspaceId, logo) => {
      this.logos.push([workspaceId, logo]);
      return { workspace: { ...this.require(workspaceId), logo } };
    },
  };
}

interface Harness {
  readonly registry: AtomRegistry;
  readonly server: WorkspaceServer;
  readonly reconnectBumps: () => number;
  /** Puts a probed value back on the health atom. */
  readonly armHealth: () => void;
  /** The health probe is blanked exactly when the switch changes the board. */
  readonly healthResets: () => number;
  readonly actions: ReturnType<typeof createWorkspaceActions>;
}

const harness = (
  overrides: { lockedTeamId?: string | null } = {},
  workspaces: Workspace[] = [organizationA, organizationB],
  teams: Project[] = [teamA, teamB],
): Harness => {
  const registry = createTestRegistry([
    [workspacesAtom, workspaces],
    [teamsAtom, teams],
    [tokenAtom, "token-1"],
    [lockedTeamIdAtom, overrides.lockedTeamId ?? null],
  ]);
  const server = new WorkspaceServer(workspaces);
  const baseReconnectGeneration = reconnectRequestGeneration(registry);
  const actions = createWorkspaceActions(registry, { api: server.api });
  /*
    The health probe is workspace state now, so "was it blanked" is read off the
    atom rather than counted through an injected callback. Each assertion arms
    it with a probed value first, and a reset takes it back to idle.
  */
  const armHealth = () =>
    registry.set(healthAtom, {
      status: "ready",
      value: null,
      error: "이전 오류",
    });
  armHealth();
  return {
    actions,
    armHealth,
    healthResets: () =>
      registry.get(healthAtom).status === "idle" ? 1 : 0,
    reconnectBumps: () =>
      reconnectRequestGeneration(registry) - baseReconnectGeneration,
    registry,
    server,
  };
};

/** Puts a team's payload in the store and selects it, as a snapshot load does. */
const loadTeam = (registry: AtomRegistry, team: Project) => {
  registry.set(activeTeamIdAtom, team.id);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: team.id,
    payload: {
      ...demoDashboard,
      team,
      runs: [],
      generatedAt: "2026-09-01T00:00:00.000Z",
    },
  });
};

describe("createWorkspaceActions", () => {
  it("appends a created workspace and selects it with no team", async () => {
    const { actions, registry, healthResets, server, reconnectBumps } =
      harness();

    const workspace = await actions.addWorkspace({
      name: "Org C",
      handle: "org-c",
    });

    expect(server.created).toEqual([{ name: "Org C", handle: "org-c" }]);
    expect(registry.get(workspacesAtom)).toEqual([
      organizationA,
      organizationB,
      workspace,
    ]);
    expect(registry.get(activeWorkspaceIdAtom)).toBe(workspace.id);
    expect(registry.get(activeTeamIdAtom)).toBeNull();
    expect(healthResets()).toBe(1);
    expect(reconnectBumps()).toBe(1);
  });

  it("refuses to create a workspace without a session", async () => {
    const { actions, registry, server } = harness();
    registry.set(tokenAtom, null);

    await expect(
      actions.addWorkspace({ name: "Org C", handle: "org-c" }),
    ).rejects.toThrow("로그인이 필요합니다.");
    expect(server.created).toEqual([]);
  });

  it("mirrors a rename into the team list and the dashboard", async () => {
    const { actions, registry, server } = harness();
    loadTeam(registry, teamA);

    const workspace = await actions.renameWorkspace(
      organizationA.id,
      "Org A renamed",
    );

    expect(server.renamed).toEqual([[organizationA.id, "Org A renamed"]]);
    expect(workspace.name).toBe("Org A renamed");
    expect(registry.get(workspacesAtom)).toEqual([
      workspace,
      organizationB,
    ]);
    // The team list carries a denormalised workspace name of its own.
    expect(
      registry.get(teamsAtom).map((team) => team.workspaceName),
    ).toEqual(["Org A renamed", "Org B"]);
    // …and so does the team entity the dashboard renders.
    expect(readTeamView(registry, teamA.id)?.team.workspaceName)
      .toBe("Org A renamed");
  });

  it("rejects renaming a workspace the account does not have", async () => {
    const { actions, server } = harness();

    await expect(actions.renameWorkspace("org-missing", "x")).rejects.toThrow(
      "변경할 워크스페이스를 찾을 수 없습니다.",
    );
    expect(server.renamed).toEqual([]);
  });

  it("replaces only the edited workspace when changing a logo", async () => {
    const { actions, registry, server } = harness();

    const workspace = await actions.changeWorkspaceLogo(
      organizationB.id,
      "data:image/png;base64,",
    );

    expect(server.logos).toEqual([[organizationB.id, "data:image/png;base64,"]]);
    expect(registry.get(workspacesAtom)).toEqual([
      organizationA,
      workspace,
    ]);
  });

  it("reports handle availability from the server", async () => {
    const { actions, server } = harness();
    server.takenHandles.add("taken");

    expect(await actions.checkWorkspaceHandle("free")).toBe(true);
    expect(await actions.checkWorkspaceHandle("taken")).toBe(false);
    expect(server.handleChecks).toEqual(["free", "taken"]);
  });

  it("selects a workspace together with its first team", () => {
    const { actions, registry, healthResets, reconnectBumps } = harness();

    actions.selectWorkspace(organizationB.id);

    expect(registry.get(activeWorkspaceIdAtom)).toBe(organizationB.id);
    expect(registry.get(activeTeamIdAtom)).toBe(teamB.id);
    // Nothing is stored for that team, so the board shows the loading state.
    expect(registry.get(staleTeamIdAtom)).toBeNull();
    expect(healthResets()).toBe(1);
    expect(reconnectBumps()).toBe(1);
  });

  it("renders a stored team immediately and marks it for a fresh snapshot", () => {
    const { actions, registry } = harness();
    loadTeam(registry, teamB);
    registry.set(activeTeamIdAtom, teamA.id);

    actions.selectWorkspace(organizationB.id);

    expect(readTeamView(registry, teamB.id)?.team.id).toBe(teamB.id);
    expect(registry.get(staleTeamIdAtom)).toBe(teamB.id);
  });

  it("ignores a workspace the account is not a member of", () => {
    const { actions, registry, healthResets, reconnectBumps } = harness();

    actions.selectWorkspace("org-missing");

    expect(registry.get(activeWorkspaceIdAtom)).toBeNull();
    expect(healthResets()).toBe(0);
    expect(reconnectBumps()).toBe(0);
  });

  it("treats reselecting the settled workspace as a no-op", () => {
    const { actions, registry, healthResets, reconnectBumps } = harness();
    // The board on screen already belongs to the team this workspace
    // resolves to, so nothing has to be reloaded.
    loadTeam(registry, teamB);
    registry.set(activeWorkspaceIdAtom, organizationB.id);
    registry.set(sessionErrorAtom, "이전 오류");

    actions.selectWorkspace(organizationB.id);

    expect(registry.get(sessionErrorAtom)).toBeNull();
    expect(registry.get(staleTeamIdAtom)).toBeNull();
    expect(healthResets()).toBe(0);
    expect(reconnectBumps()).toBe(0);
  });

  it("keeps a project window pinned to its own team's workspace", () => {
    const { actions, registry, healthResets } = harness({
      lockedTeamId: teamB.id,
    });

    actions.selectWorkspace(organizationA.id);
    expect(registry.get(activeWorkspaceIdAtom)).toBeNull();
    expect(registry.get(activeTeamIdAtom)).toBeNull();

    actions.selectWorkspace(organizationB.id);
    expect(registry.get(activeWorkspaceIdAtom)).toBe(organizationB.id);
    expect(registry.get(activeTeamIdAtom)).toBe(teamB.id);
    // A locked window never reloads the board: it only ever shows one team.
    expect(healthResets()).toBe(0);
  });
});
