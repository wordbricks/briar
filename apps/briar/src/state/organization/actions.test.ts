import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { Organization, Project } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  createOrganizationActions,
  type OrganizationActionApi,
  type OrganizationActionDeps,
} from "./actions";
import { activeOrganizationIdAtom, organizationsAtom } from "./atoms";

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

const teamOf = (id: string, organization: Organization): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  organizationId: organization.id,
  organizationName: organization.name,
});

const teamA = teamOf("team-a", organizationA);
const teamB = teamOf("team-b", organizationB);

/**
 * In-memory stand-in for the organization RPCs. It records what was asked so a
 * test can assert an action reached the server exactly once, and echoes the
 * requested change back the way the Worker does.
 */
class OrganizationServer {
  readonly created: { name: string; handle: string }[] = [];
  readonly renamed: [string, string][] = [];
  readonly logos: [string, string | null][] = [];
  readonly handleChecks: string[] = [];
  takenHandles = new Set<string>();

  private organizations: Organization[];

  constructor(organizations: Organization[]) {
    this.organizations = [...organizations];
  }

  private require(organizationId: string) {
    const organization = this.organizations.find(
      (candidate) => candidate.id === organizationId,
    );
    if (!organization) throw new Error(`unknown organization ${organizationId}`);
    return organization;
  }

  readonly api: OrganizationActionApi = {
    createOrganization: async (_token, input) => {
      this.created.push({ ...input });
      const organization: Organization = {
        id: `remote-${input.handle}`,
        name: input.name,
        handle: input.handle,
        logo: null,
        role: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      };
      this.organizations.push(organization);
      return { organization };
    },
    isOrganizationHandleAvailable: async (_token, handle) => {
      this.handleChecks.push(handle);
      return !this.takenHandles.has(handle);
    },
    updateOrganization: async (_token, organizationId, name) => {
      this.renamed.push([organizationId, name]);
      return { organization: { ...this.require(organizationId), name } };
    },
    updateOrganizationLogo: async (_token, organizationId, logo) => {
      this.logos.push([organizationId, logo]);
      return { organization: { ...this.require(organizationId), logo } };
    },
  };
}

interface Harness {
  readonly registry: AtomRegistry;
  readonly server: OrganizationServer;
  readonly reconnectBumps: () => number;
  readonly switches: [string | null, boolean][];
  readonly renames: [string, string][];
  readonly resets: () => number;
  readonly actions: ReturnType<typeof createOrganizationActions>;
}

const harness = (
  overrides: Partial<
    Pick<OrganizationActionDeps, "lockedTeamId" | "readDashboardTeamId">
  > = {},
  organizations: Organization[] = [organizationA, organizationB],
  teams: Project[] = [teamA, teamB],
): Harness => {
  const registry = createTestRegistry([
    [organizationsAtom, organizations],
    [teamsAtom, teams],
    [tokenAtom, "token-1"],
  ]);
  const server = new OrganizationServer(organizations);
  let reconnectBumps = 0;
  let resets = 0;
  const switches: [string | null, boolean][] = [];
  const renames: [string, string][] = [];
  const actions = createOrganizationActions(registry, {
    api: server.api,
    applyOrganizationSwitch: (team, dashboardMatchesTeam) => {
      switches.push([team?.id ?? null, dashboardMatchesTeam]);
    },
    bumpReconnectRequest: () => {
      reconnectBumps += 1;
    },
    lockedTeamId: overrides.lockedTeamId ?? null,
    readDashboardTeamId: overrides.readDashboardTeamId ?? (() => null),
    renameDashboardOrganization: (organizationId, organizationName) => {
      renames.push([organizationId, organizationName]);
    },
    resetTeamViews: () => {
      resets += 1;
    },
  });
  return {
    actions,
    reconnectBumps: () => reconnectBumps,
    registry,
    renames,
    resets: () => resets,
    server,
    switches,
  };
};

describe("createOrganizationActions", () => {
  it("appends a created organization and selects it with no team", async () => {
    const { actions, registry, resets, server, reconnectBumps } = harness();

    const organization = await actions.addOrganization({
      name: "Org C",
      handle: "org-c",
    });

    expect(server.created).toEqual([{ name: "Org C", handle: "org-c" }]);
    expect(registry.get(organizationsAtom)).toEqual([
      organizationA,
      organizationB,
      organization,
    ]);
    expect(registry.get(activeOrganizationIdAtom)).toBe(organization.id);
    expect(registry.get(activeTeamIdAtom)).toBeNull();
    expect(resets()).toBe(1);
    expect(reconnectBumps()).toBe(1);
  });

  it("refuses to create an organization without a session", async () => {
    const { actions, registry, server } = harness();
    registry.set(tokenAtom, null);

    await expect(
      actions.addOrganization({ name: "Org C", handle: "org-c" }),
    ).rejects.toThrow("로그인이 필요합니다.");
    expect(server.created).toEqual([]);
  });

  it("mirrors a rename into the team list and the dashboard", async () => {
    const { actions, registry, renames, server } = harness();

    const organization = await actions.renameOrganization(
      organizationA.id,
      "Org A renamed",
    );

    expect(server.renamed).toEqual([[organizationA.id, "Org A renamed"]]);
    expect(organization.name).toBe("Org A renamed");
    expect(registry.get(organizationsAtom)).toEqual([
      organization,
      organizationB,
    ]);
    // The team list carries a denormalised organization name of its own.
    expect(
      registry.get(teamsAtom).map((team) => team.organizationName),
    ).toEqual(["Org A renamed", "Org B"]);
    expect(renames).toEqual([[organizationA.id, "Org A renamed"]]);
  });

  it("rejects renaming an organization the account does not have", async () => {
    const { actions, server } = harness();

    await expect(actions.renameOrganization("org-missing", "x")).rejects.toThrow(
      "변경할 조직을 찾을 수 없습니다.",
    );
    expect(server.renamed).toEqual([]);
  });

  it("replaces only the edited organization when changing a logo", async () => {
    const { actions, registry, server } = harness();

    const organization = await actions.changeOrganizationLogo(
      organizationB.id,
      "data:image/png;base64,",
    );

    expect(server.logos).toEqual([[organizationB.id, "data:image/png;base64,"]]);
    expect(registry.get(organizationsAtom)).toEqual([
      organizationA,
      organization,
    ]);
  });

  it("reports handle availability from the server", async () => {
    const { actions, server } = harness();
    server.takenHandles.add("taken");

    expect(await actions.checkOrganizationHandle("free")).toBe(true);
    expect(await actions.checkOrganizationHandle("taken")).toBe(false);
    expect(server.handleChecks).toEqual(["free", "taken"]);
  });

  it("selects an organization together with its first team", () => {
    const { actions, registry, switches, reconnectBumps } = harness();

    actions.selectOrganization(organizationB.id);

    expect(registry.get(activeOrganizationIdAtom)).toBe(organizationB.id);
    expect(registry.get(activeTeamIdAtom)).toBe(teamB.id);
    expect(switches).toEqual([[teamB.id, false]]);
    expect(reconnectBumps()).toBe(1);
  });

  it("ignores an organization the account is not a member of", () => {
    const { actions, registry, switches, reconnectBumps } = harness();

    actions.selectOrganization("org-missing");

    expect(registry.get(activeOrganizationIdAtom)).toBeNull();
    expect(switches).toEqual([]);
    expect(reconnectBumps()).toBe(0);
  });

  it("treats reselecting the settled organization as a no-op", () => {
    const { actions, registry, switches, reconnectBumps } = harness({
      // The board on screen already belongs to the team this organization
      // resolves to, so nothing has to be reloaded.
      readDashboardTeamId: () => teamB.id,
    });
    registry.set(activeOrganizationIdAtom, organizationB.id);
    registry.set(activeTeamIdAtom, teamB.id);
    registry.set(sessionErrorAtom, "이전 오류");

    actions.selectOrganization(organizationB.id);

    expect(registry.get(sessionErrorAtom)).toBeNull();
    expect(switches).toEqual([]);
    expect(reconnectBumps()).toBe(0);
  });

  it("keeps a project window pinned to its own team's organization", () => {
    const { actions, registry, switches } = harness({ lockedTeamId: teamB.id });

    actions.selectOrganization(organizationA.id);
    expect(registry.get(activeOrganizationIdAtom)).toBeNull();
    expect(registry.get(activeTeamIdAtom)).toBeNull();

    actions.selectOrganization(organizationB.id);
    expect(registry.get(activeOrganizationIdAtom)).toBe(organizationB.id);
    expect(registry.get(activeTeamIdAtom)).toBe(teamB.id);
    // A locked window never reloads the board: it only ever shows one team.
    expect(switches).toEqual([]);
  });
});
