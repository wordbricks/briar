import { describe, expect, it } from "vitest";
import {
  groupChannels,
  organizationSidebarChannels,
  projectSidebarChannels,
} from "./channel-grouping";
import type { ChannelSummary } from "./channels-contract";

const channel = (
  id: string,
  name: string,
  defaultProjectId: string | null,
  overrides: Partial<ChannelSummary> = {},
): ChannelSummary => ({
  id,
  organizationId: "org-1",
  slug: name.toLowerCase(),
  name,
  topic: null,
  visibility: "public",
  defaultProjectId,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  kind: "channel",
  createdByUserId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  ...overrides,
});

const labels = {
  commonLabel: "공통",
  unknownProjectLabel: "다른 프로젝트",
};

describe("groupChannels", () => {
  it("orders common channels, the active project, then other projects by name", () => {
    const groups = groupChannels(
      [
        channel("c-3", "Sprout", "project-2"),
        channel("c-1", "General", null),
        channel("c-2", "Briar dev", "project-1"),
        channel("c-4", "Acorn", "project-3"),
      ],
      {
        activeProjectId: "project-1",
        projects: [
          { id: "project-1", name: "Briar" },
          { id: "project-2", name: "Sprout" },
          { id: "project-3", name: "Acorn" },
        ],
        ...labels,
      },
    );

    expect(groups.map((group) => [group.kind, group.label])).toEqual([
      ["common", "공통"],
      ["current-project", "Briar"],
      ["other-project", "Acorn"],
      ["other-project", "Sprout"],
    ]);
  });

  it("omits the common group when no channel is organization-wide", () => {
    const groups = groupChannels([channel("c-1", "Briar dev", "project-1")], {
      activeProjectId: "project-1",
      projects: [{ id: "project-1", name: "Briar" }],
      ...labels,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("current-project");
  });

  it("omits the active project group when it has no channels", () => {
    const groups = groupChannels(
      [channel("c-1", "General", null), channel("c-2", "Sprout", "project-2")],
      {
        activeProjectId: "project-1",
        projects: [
          { id: "project-1", name: "Briar" },
          { id: "project-2", name: "Sprout" },
        ],
        ...labels,
      },
    );

    expect(groups.map((group) => group.kind)).toEqual([
      "common",
      "other-project",
    ]);
  });

  it("keeps a channel whose project the member cannot see, under a neutral label", () => {
    const groups = groupChannels([channel("c-1", "Secret", "project-9")], {
      activeProjectId: "project-1",
      projects: [{ id: "project-1", name: "Briar" }],
      ...labels,
    });

    expect(groups).toEqual([
      expect.objectContaining({
        kind: "other-project",
        label: "다른 프로젝트",
        projectId: "project-9",
      }),
    ]);
  });

  it("drops archived channels", () => {
    const groups = groupChannels(
      [
        channel("c-1", "General", null),
        channel("c-2", "Old", null, {
          archivedAt: "2026-08-02T00:00:00.000Z",
        }),
      ],
      { activeProjectId: null, projects: [], ...labels },
    );

    expect(groups[0]?.channels.map((item) => item.name)).toEqual(["General"]);
  });

  it("sorts channels inside a group by name", () => {
    const groups = groupChannels(
      [
        channel("c-2", "Zeta", null),
        channel("c-1", "Alpha", null),
        channel("c-3", "Mid", null),
      ],
      { activeProjectId: null, projects: [], ...labels },
    );

    expect(groups[0]?.channels.map((item) => item.name)).toEqual([
      "Alpha",
      "Mid",
      "Zeta",
    ]);
  });

  it("returns nothing when there are no visible channels", () => {
    expect(
      groupChannels([], { activeProjectId: "project-1", projects: [], ...labels }),
    ).toEqual([]);
  });
});

describe("sidebar channel split", () => {
  it("keeps organization-wide channels out of a project's list", () => {
    const channels = [
      channel("c-1", "General", null),
      channel("c-2", "Briar dev", "project-1"),
      channel("c-3", "Sprout", "project-2"),
    ];

    expect(organizationSidebarChannels(channels).map((item) => item.id)).toEqual([
      "c-1",
    ]);
    expect(
      projectSidebarChannels(channels, "project-1").map((item) => item.id),
    ).toEqual(["c-2"]);
    expect(projectSidebarChannels(channels, "project-3")).toEqual([]);
  });
});
