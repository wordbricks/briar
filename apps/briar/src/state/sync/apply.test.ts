import { describe, expect, it } from "vitest";

import type { ChannelSummary } from "../../lib/channels-contract";
import { demoDashboard } from "../../lib/demo-data";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  TeamAgentBoard,
  Team,
} from "../../types";
import {
  channelAtom,
  channelsByIdAtom,
  organizationChannelIdsAtom,
} from "../entities/channels";
import { membersByIdAtom, teamMembersAtom } from "../entities/members";
import { retainedTeamIdsAtom, TEAM_RETENTION_LIMIT } from "../entities/retention";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { createTestRegistry } from "../registry";
import {
  activeTeamIdAtom,
  loadedTeamIdAtom,
  staleTeamIdAtom,
  teamAgentBoardAtom,
  teamCursorAtom,
  teamGeneratedAtAtom,
  teamLoadedAtom,
  teamPayloadCursorAtom,
  teamSettingsAtom,
} from "../team/atoms";
import { readTeamView } from "../../test/team-view";
import { applySyncEvent, markTeamStale } from "./apply";

const teamA = "team-a";
const teamB = "team-b";

const teamOf = (id: string, organizationId = "org-a"): Team => ({
  ...demoDashboard.team,
  id,
  name: id,
  organizationId,
});

const snapshotOf = (
  id: string,
  overrides: Partial<DashboardPayload> = {},
): DashboardPayload => ({
  ...demoDashboard,
  team: teamOf(id),
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const deltaOf = (
  overrides: Partial<DashboardDeltaPayload> = {},
): DashboardDeltaPayload => ({
  reset: false,
  cursor: 2,
  hasMore: false,
  runs: [],
  deletedRunIds: [],
  workers: demoDashboard.workers ?? [],
  organizationProviders: demoDashboard.organizationProviders ?? [],
  generatedAt: "2026-09-02T00:00:00.000Z",
  ...overrides,
});

const loaded = (id = teamA, overrides: Partial<DashboardPayload> = {}) => {
  const registry = createTestRegistry([[activeTeamIdAtom, id]]);
  const payload = snapshotOf(id, overrides);
  applySyncEvent(registry, { kind: "team-snapshot", teamId: id, payload });
  return { registry, payload };
};

describe("team snapshots", () => {
  it("unpacks a payload the view rebuilds identically", () => {
    const { registry, payload } = loaded();

    expect(readTeamView(registry, teamA)).toEqual(payload);
    expect(registry.get(teamLoadedAtom(teamA))).toBe(true);
    expect(registry.get(loadedTeamIdAtom)).toBe(teamA);
    expect(registry.get(teamCursorAtom(teamA))).toBe(1);
  });

  it("renders the server's run order verbatim", () => {
    const { registry, payload } = loaded();

    expect(registry.get(teamRunIdsAtom(teamA))).toEqual(
      payload.runs.map((run) => run.id),
    );
  });

  it("leaves absent projections absent", () => {
    const { registry } = loaded(teamA, {
      workers: undefined,
      members: undefined,
      organizationProviders: undefined,
      executionPolicy: undefined,
    });
    const view = readTeamView(registry, teamA);

    expect(view?.workers).toBeUndefined();
    expect(view?.members).toBeUndefined();
    expect(view?.organizationProviders).toBeUndefined();
    expect(view?.executionPolicy).toBeUndefined();
  });

  it("notifies a view over many projections once for the whole batch", () => {
    const registry = createTestRegistry([[activeTeamIdAtom, teamA]]);
    // Four projections in one atom: a snapshot writes all of them, and the
    // batch is what turns that into a single notification.
    const seen: (TeamAgentBoard | null)[] = [];
    registry.subscribe(
      teamAgentBoardAtom(teamA),
      (board) => {
        seen.push(board);
      },
      { immediate: true },
    );
    seen.length = 0;

    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamA,
      payload: snapshotOf(teamA),
    });

    expect(seen).toHaveLength(1);
  });

  it("keeps every team's payload while another team is loaded", () => {
    const { registry, payload } = loaded();

    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamB,
      payload: snapshotOf(teamB),
    });

    expect(readTeamView(registry, teamA)).toEqual(payload);
    expect(readTeamView(registry, teamB)?.team.id).toBe(teamB);
  });
});

describe("team deltas", () => {
  it("keeps every projection's reference when a sync has no changes", () => {
    const { registry } = loaded();
    const before = readTeamView(registry, teamA);
    const seen: (TeamAgentBoard | null)[] = [];
    registry.subscribe(teamAgentBoardAtom(teamA), (board) => {
      seen.push(board);
    }, { immediate: true });
    seen.length = 0;

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA,
      payload: deltaOf(),
    });

    /*
      Every part the payload is made of keeps its reference, which is what lets
      a view holding one of them sit still. Nothing subscribed hears anything.
    */
    const after = readTeamView(registry, teamA);
    expect(after?.team).toBe(before?.team);
    expect(after?.settings).toBe(before?.settings);
    expect(after?.runs).toBe(before?.runs);
    expect(after?.workers).toBe(before?.workers);
    expect(after?.members).toBe(before?.members);
    expect(after?.organizationProviders).toBe(before?.organizationProviders);
    expect(seen).toEqual([]);
    // …but the resume cursor still advanced, so the next delta continues.
    expect(registry.get(teamCursorAtom(teamA))).toBe(2);
    expect(registry.get(teamPayloadCursorAtom(teamA))).toBe(1);
  });

  it("updates one run while preserving every unchanged run reference", () => {
    const { registry, payload } = loaded();
    const target = payload.runs[0]!;
    const untouched = payload.runs[1]!;

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA,
      payload: deltaOf({
        runs: [
          {
            ...target,
            detail: "Only this issue changed",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
    });

    const view = readTeamView(registry, teamA);
    expect(view?.runs.find((run) => run.id === target.id)).not.toBe(target);
    expect(view?.runs.find((run) => run.id === untouched.id)).toBe(untouched);
    expect(view?.cursor).toBe(2);
    expect(view?.generatedAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("applies run tombstones without rebuilding surviving entities", () => {
    const { registry, payload } = loaded();
    const removed = payload.runs[0]!;
    const survivor = payload.runs[1]!;

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA,
      payload: deltaOf({ deletedRunIds: [removed.id] }),
    });

    const view = readTeamView(registry, teamA);
    expect(view?.runs.some((run) => run.id === removed.id)).toBe(false);
    expect(view?.runs.find((run) => run.id === survivor.id)).toBe(survivor);
    expect(registry.get(runsByIdAtom).has(removed.id)).toBe(false);
  });

  it("replaces conversation notifications only when that projection changes", () => {
    const { registry, payload } = loaded();
    const notification = {
      id: "notification-1",
      runId: payload.runs[0]!.id,
      runTitle: payload.runs[0]!.title,
      rootMessageId: "message-1",
      body: "A reply arrived",
      author: { id: null, name: "Briar", image: null, provider: "codex" as const },
      reason: "thread_reply" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
    };

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA,
      payload: deltaOf({ conversationNotifications: [notification] }),
    });

    const view = readTeamView(registry, teamA);
    expect(view?.conversationNotifications).toEqual([notification]);
    expect(view?.runs[0]).toBe(payload.runs[0]);
  });

  it("replaces channel notifications from the organization projection", () => {
    const { registry, payload } = loaded();
    const notification = {
      id: "channel-notification-1",
      channelId: "channel-1",
      channelName: "product",
      rootMessageId: "channel-root-1",
      body: "A channel reply arrived",
      author: { id: "member", name: "Sam", image: null, provider: null },
      reason: "thread_reply" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
    };

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA,
      payload: deltaOf({ channelNotifications: [notification] }),
    });

    const view = readTeamView(registry, teamA);
    expect(view?.channelNotifications).toEqual([notification]);
    expect(view?.runs[0]).toBe(payload.runs[0]);
  });

  it("mirrors a renamed team and changed settings", () => {
    const { registry } = loaded();
    const renamed = { ...teamOf(teamA), name: "Renamed" };
    const settings = { ...demoDashboard.settings, velenOrg: "elsewhere" };

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA,
      payload: deltaOf({ team: renamed, settings }),
    });

    const view = readTeamView(registry, teamA);
    expect(view?.team).toBe(renamed);
    expect(view?.settings).toBe(settings);
    expect(registry.get(teamEntityAtom(teamA))).toBe(renamed);
  });

  it("ignores a delta for a team that was never loaded", () => {
    const registry = createTestRegistry([[activeTeamIdAtom, teamA]]);

    applySyncEvent(registry, {
      kind: "team-delta",
      teamId: teamA,
      payload: deltaOf(),
    });

    expect(readTeamView(registry, teamA)).toBeNull();
    expect(registry.get(teamCursorAtom(teamA))).toBeNull();
  });
});

describe("run events", () => {
  it("patches a run in place without reordering the team's list", () => {
    const { registry, payload } = loaded();
    const target = payload.runs[1]!;
    const edited = { ...target, detail: "patched" };

    applySyncEvent(registry, { kind: "run-changed", run: edited, teamId: teamA });

    expect(registry.get(teamRunIdsAtom(teamA))).toEqual(
      payload.runs.map((run) => run.id),
    );
    expect(readTeamView(registry, teamA)?.runs[1]).toBe(edited);
  });

  it("prepends a run the team did not list yet", () => {
    const { registry, payload } = loaded();
    const created = { ...payload.runs[0]!, id: "run-created" };

    applySyncEvent(registry, {
      kind: "run-changed",
      run: created,
      teamId: teamA,
    });

    expect(registry.get(teamRunIdsAtom(teamA))?.[0]).toBe("run-created");
  });

  it("drops a deleted run from the index and the store", () => {
    const { registry, payload } = loaded();
    const removed = payload.runs[0]!;

    applySyncEvent(registry, {
      kind: "run-deleted",
      teamId: teamA,
      runId: removed.id,
    });

    expect(registry.get(teamRunIdsAtom(teamA))).not.toContain(removed.id);
    expect(registry.get(runsByIdAtom).has(removed.id)).toBe(false);
  });
});

describe("clearing", () => {
  it("drops one team and leaves the others alone", () => {
    const { registry } = loaded();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamB,
      payload: snapshotOf(teamB),
    });

    applySyncEvent(registry, { kind: "team-cleared", teamId: teamB });

    expect(readTeamView(registry, teamB)).toBeNull();
    expect(readTeamView(registry, teamA)).not.toBeNull();
    expect(registry.get(retainedTeamIdsAtom)).toEqual([teamA]);
  });

  it("drops the teams of every organization but the retained one", () => {
    const { registry } = loaded();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamB,
      payload: snapshotOf(teamB, { team: teamOf(teamB, "org-b") }),
    });

    applySyncEvent(registry, {
      kind: "organization-left",
      retainedOrganizationId: "org-b",
    });

    expect(readTeamView(registry, teamA)).toBeNull();
    expect(readTeamView(registry, teamB)).not.toBeNull();
  });

  it("drops everything when the session ends", () => {
    const { registry } = loaded();
    registry.set(staleTeamIdAtom, teamA);

    applySyncEvent(registry, { kind: "session-cleared" });

    expect(readTeamView(registry, teamA)).toBeNull();
    expect(registry.get(runsByIdAtom).size).toBe(0);
    expect(registry.get(membersByIdAtom).size).toBe(0);
    expect(registry.get(retainedTeamIdsAtom)).toEqual([]);
    expect(registry.get(staleTeamIdAtom)).toBeNull();
  });

  it("keeps a member another retained team still lists", () => {
    const { registry, payload } = loaded();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamB,
      payload: snapshotOf(teamB),
    });
    const shared = payload.members?.[0]!;

    applySyncEvent(registry, { kind: "team-cleared", teamId: teamA });

    expect(registry.get(membersByIdAtom).get(shared.userId)).toBe(shared);
    expect(registry.get(teamMembersAtom(teamB))).toContain(shared);
  });

  it("evicts the least recently synced team past the retention limit", () => {
    const registry = createTestRegistry();
    const teamIds = Array.from(
      { length: TEAM_RETENTION_LIMIT + 2 },
      (_unused, index) => `team-${index}`,
    );
    for (const teamId of teamIds) {
      registry.set(activeTeamIdAtom, teamId);
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId,
        payload: snapshotOf(teamId),
      });
    }

    expect(registry.get(retainedTeamIdsAtom)).toHaveLength(
      TEAM_RETENTION_LIMIT,
    );
    expect(readTeamView(registry, teamIds[0]!)).toBeNull();
    expect(readTeamView(registry, teamIds.at(-1)!)).not.toBeNull();
  });
});

describe("staleness", () => {
  it("marks a loaded team stale and clears the marker for an empty one", () => {
    const { registry } = loaded();

    expect(markTeamStale(registry, teamA)).toBe(true);
    expect(registry.get(staleTeamIdAtom)).toBe(teamA);

    expect(markTeamStale(registry, teamB)).toBe(false);
    expect(registry.get(staleTeamIdAtom)).toBeNull();
  });

  it("keeps the store's settings reachable for the stale team", () => {
    const { registry, payload } = loaded();
    markTeamStale(registry, teamA);

    expect(registry.get(teamSettingsAtom(teamA))).toBe(payload.settings);
    expect(registry.get(teamGeneratedAtAtom(teamA))).toBe(payload.generatedAt);
  });
});

const channelOf = (
  id: string,
  overrides: Partial<ChannelSummary> = {},
): ChannelSummary => ({
  id,
  organizationId: "org-a",
  kind: "channel",
  slug: id,
  name: id,
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  createdByUserId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  ...overrides,
});

describe("channel catalog", () => {
  it("keeps the server's order for a snapshot and name order for a delta", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-a",
      channels: [channelOf("zeta"), channelOf("alpha")],
    });
    expect(registry.get(organizationChannelIdsAtom("org-a"))).toEqual([
      "zeta",
      "alpha",
    ]);

    applySyncEvent(registry, {
      kind: "channel-catalog-delta",
      organizationId: "org-a",
      channels: [channelOf("mid")],
      removedChannelIds: [],
      reset: false,
    });
    expect(registry.get(organizationChannelIdsAtom("org-a"))).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("drops what a reset delta did not re-send", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-a",
      channels: [channelOf("alpha"), channelOf("zeta")],
    });

    applySyncEvent(registry, {
      kind: "channel-catalog-delta",
      organizationId: "org-a",
      channels: [channelOf("zeta")],
      removedChannelIds: [],
      reset: true,
    });

    expect(registry.get(organizationChannelIdsAtom("org-a"))).toEqual(["zeta"]);
    expect(registry.get(channelsByIdAtom).has("alpha")).toBe(false);
  });

  it("leaves the list alone for a change to a channel it already lists", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-a",
      channels: [channelOf("zeta"), channelOf("alpha")],
    });
    const before = registry.get(organizationChannelIdsAtom("org-a"));

    applySyncEvent(registry, {
      kind: "channel-changed",
      channel: channelOf("zeta", { hasUnread: true }),
    });

    expect(registry.get(organizationChannelIdsAtom("org-a"))).toBe(before);
    expect(registry.get(channelAtom("zeta"))?.hasUnread).toBe(true);
  });

  it("appends a channel the organization does not list yet", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-a",
      channels: [channelOf("zeta")],
    });

    applySyncEvent(registry, {
      kind: "channel-changed",
      channel: channelOf("new"),
    });

    expect(registry.get(organizationChannelIdsAtom("org-a"))).toEqual([
      "zeta",
      "new",
    ]);
  });

  it("removes a channel from the index and the store", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-a",
      channels: [channelOf("zeta"), channelOf("alpha")],
    });

    applySyncEvent(registry, {
      kind: "channel-removed",
      organizationId: "org-a",
      channelId: "alpha",
    });

    expect(registry.get(organizationChannelIdsAtom("org-a"))).toEqual(["zeta"]);
    expect(registry.get(channelsByIdAtom).has("alpha")).toBe(false);
  });

  it("forgets every catalog when the session ends", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-a",
      channels: [channelOf("zeta")],
    });
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-b",
      channels: [channelOf("other", { organizationId: "org-b" })],
    });

    applySyncEvent(registry, { kind: "session-cleared" });

    expect(registry.get(organizationChannelIdsAtom("org-a"))).toBeNull();
    expect(registry.get(organizationChannelIdsAtom("org-b"))).toBeNull();
    expect(registry.get(channelsByIdAtom).size).toBe(0);
  });
});
