import { describe, expect, it } from "vitest";

import type { ChannelSummary } from "../../lib/channels-contract";
import { demoDashboard } from "../../lib/demo-data";
import type {
  DashboardPayload,
  Organization,
  OrganizationMember,
  Project,
  SessionUser,
} from "../../types";
import { organizationChannelIdsAtom } from "../entities/channels";
import { retainedTeamIdsAtom } from "../entities/retention";
import { runsByIdAtom } from "../entities/runs";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom, userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { readActiveTeamView } from "../../test/team-view";
import { activeTeamIdAtom, teamCursorAtom, teamsAtom } from "../team/atoms";
import {
  SNAPSHOT_SCHEMA_VERSION,
  applySnapshot,
  collectSnapshot,
  deserializeSnapshot,
  serializeSnapshot,
} from "./snapshot";

/*
  What survives a restart, and what must not.

  The round trip is asserted through the store rather than field by field: a
  snapshot is written from the atoms and read back into a second registry, and
  the reassembled dashboard — the thing the screen actually renders — has to be
  the payload the server sent. Anything the snapshot forgets shows up there.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const organization: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const teamOf = (id: string, organizationId: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  organizationId,
  organizationName: "Org A",
});

const teamA = teamOf("team-a", organization.id);
const teamB = teamOf("team-b", "org-b");

const member: OrganizationMember = {
  userId: "user-1",
  name: "Tester",
  email: "tester@briar.local",
  image: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const channel: ChannelSummary = {
  id: "channel-1",
  organizationId: organization.id,
  kind: "channel",
  slug: "general",
  name: "general",
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  createdByUserId: user.id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
};

const payloadOf = (team: Project, cursor: number): DashboardPayload => ({
  ...demoDashboard,
  team,
  runs: demoDashboard.runs.slice(0, 2).map((run, index) => ({
    ...run,
    id: `${team.id}-run-${index}`,
    teamId: team.id,
  })),
  members: [member],
  cursor,
  generatedAt: `2026-09-0${cursor}T00:00:00.000Z`,
});

const payloadA = payloadOf(teamA, 7);

/** A registry holding one signed-in account with one loaded team. */
function loadedRegistry(): AtomRegistry {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
    [teamsAtom, [teamA]],
    [activeTeamIdAtom, teamA.id],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: payloadA,
  });
  applySyncEvent(registry, {
    kind: "channel-catalog-snapshot",
    organizationId: organization.id,
    channels: [channel],
  });
  return registry;
}

describe("client snapshot", () => {
  it("puts the rendered dashboard back after a serialize and a parse", () => {
    const source = loadedRegistry();
    const snapshot = collectSnapshot(source);
    if (!snapshot) throw new Error("expected a snapshot");
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.userId).toBe(user.id);
    expect(snapshot.organizationId).toBe(organization.id);

    const restored = deserializeSnapshot(serializeSnapshot(snapshot));
    if (!restored) throw new Error("expected the snapshot to parse");

    const target = createTestRegistry();
    applySnapshot(target, restored);

    // The payload the screen renders, rebuilt from a record on disk.
    expect(readActiveTeamView(target)).toEqual(payloadA);
    expect(target.get(userAtom)).toEqual(user);
    expect(target.get(teamsAtom)).toEqual([teamA]);
    expect(target.get(organizationsAtom)).toEqual([organization]);
    expect(target.get(activeOrganizationIdAtom)).toBe(organization.id);
    expect(target.get(activeTeamIdAtom)).toBe(teamA.id);
    // …and the cursor the next boot resumes its delta from.
    expect(target.get(teamCursorAtom(teamA.id))).toBe(7);
    expect(target.get(organizationChannelIdsAtom(organization.id))).toEqual([
      channel.id,
    ]);
  });

  it("never carries the credential", () => {
    const registry = loadedRegistry();
    registry.set(tokenAtom, "super-secret-token");
    const snapshot = collectSnapshot(registry);
    if (!snapshot) throw new Error("expected a snapshot");

    const serialized = serializeSnapshot(snapshot);
    expect(serialized).not.toContain("super-secret-token");
    expect(JSON.parse(serialized)).not.toHaveProperty("token");
    expect(serialized).not.toContain("\"token\"");

    // Reading it back leaves the credential where the bootstrap put it.
    const target = createTestRegistry();
    applySnapshot(target, snapshot);
    expect(target.get(tokenAtom)).toBeNull();
  });

  it("collects only the teams of the organization it is keyed by", () => {
    const registry = loadedRegistry();
    registry.set(teamsAtom, [teamA, teamB]);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamB.id,
      payload: payloadOf(teamB, 3),
    });
    expect(registry.get(retainedTeamIdsAtom)).toEqual([teamA.id, teamB.id]);

    const snapshot = collectSnapshot(registry);
    expect(snapshot?.teamState.map((team) => team.teamId)).toEqual([teamA.id]);
    // …and with them, only their runs.
    expect(
      snapshot?.entities.runs.every((run) => run.teamId === teamA.id),
    ).toBe(true);
  });

  it("has nothing to write without an account or an organization", () => {
    const registry = loadedRegistry();
    registry.set(activeOrganizationIdAtom, null);
    expect(collectSnapshot(registry)).toBeNull();

    registry.set(activeOrganizationIdAtom, organization.id);
    registry.set(userAtom, null);
    expect(collectSnapshot(registry)).toBeNull();
  });

  it("rejects a record it cannot read into the store", () => {
    const snapshot = collectSnapshot(loadedRegistry());
    if (!snapshot) throw new Error("expected a snapshot");
    const encoded = JSON.parse(serializeSnapshot(snapshot)) as Record<
      string,
      unknown
    >;

    expect(deserializeSnapshot("not json at all")).toBeNull();
    expect(deserializeSnapshot(null)).toBeNull();
    expect(deserializeSnapshot({ ...encoded, schemaVersion: 2 })).toBeNull();
    expect(deserializeSnapshot({ ...encoded, userId: 12 })).toBeNull();
    const { savedAt: _savedAt, ...withoutSavedAt } = encoded;
    expect(deserializeSnapshot(withoutSavedAt)).toBeNull();
    expect(
      deserializeSnapshot({
        ...encoded,
        entities: {
          ...(encoded.entities as Record<string, unknown>),
          // A run without the key the store indexes it by is not a run.
          runs: [{ title: "no id here" }],
        },
      }),
    ).toBeNull();
    expect(
      deserializeSnapshot({
        ...encoded,
        teamState: [{ teamId: teamA.id }],
      }),
    ).toBeNull();
  });

  it("keeps the properties the entity schema does not name", () => {
    const registry = loadedRegistry();
    const snapshot = collectSnapshot(registry);
    if (!snapshot) throw new Error("expected a snapshot");
    const restored = deserializeSnapshot(serializeSnapshot(snapshot));

    // The schema checks the id and passes the rest of the server's DTO
    // through; a struct would have stripped it.
    expect(restored?.entities.runs[0]).toEqual(
      JSON.parse(JSON.stringify(payloadA.runs[0])),
    );
    const target = createTestRegistry();
    if (restored) applySnapshot(target, restored);
    expect([...target.get(runsByIdAtom).values()]).toEqual(
      JSON.parse(JSON.stringify(payloadA.runs)),
    );
  });
});
