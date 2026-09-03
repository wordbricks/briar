import { describe, expect, it } from "vitest";

import type { MessageKey } from "../i18n/messages";
import { demoDashboard } from "./demo-data";
import type { ChannelSummary } from "./channels-contract";
import {
  channelNavigationLocation,
  issueNavigationLocation,
  organizationNavigationLocation,
  projectNavigationLocation,
  settingsNavigationLocation,
  type AppNavigationLocation,
} from "./app-navigation";
import { buildNavigationHistoryItems } from "./navigation-history-items";
import type { DashboardPayload, Organization, Project } from "../types";

/*
  A history entry is only ids, so every label is a lookup that can miss. What
  these cases pin is which lookup wins and what each one falls back to when the
  thing it points at is gone — the part that was hardest to see while this was a
  two hundred line `useMemo` in the app shell.
*/

// The identity translator: an assertion reads the key, not a translation.
const t = (key: MessageKey) => key;

const team: Project = {
  ...demoDashboard.team,
  id: "team-a",
  name: "Team A",
  organizationId: "org-a",
  issueKeyPrefix: "TA",
};

const organization: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const run = { ...demoDashboard.runs[0]!, id: "run-1", title: "Fix the thing", runNumber: 42 };

const dashboard: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [run],
};

const channel = (overrides: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id: "channel-1",
  organizationId: organization.id,
  kind: "channel",
  slug: "general",
  name: "General",
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

const build = (
  entries: AppNavigationLocation[],
  overrides: {
    channels?: ChannelSummary[];
    dashboard?: DashboardPayload | null;
    currentUserId?: string | null;
  } = {},
) =>
  buildNavigationHistoryItems({
    channels: overrides.channels ?? [],
    currentUserId: overrides.currentUserId ?? "user-1",
    dashboard: overrides.dashboard === undefined ? dashboard : overrides.dashboard,
    entries,
    organizations: [organization],
    t,
    teams: [team],
  });

describe("buildNavigationHistoryItems", () => {
  it("keeps the entry order and index", () => {
    const items = build(["lobby", "issues"]);
    expect(items.map((item) => item.index)).toEqual([0, 1]);
    expect(items.map((item) => item.location)).toEqual(["lobby", "issues"]);
  });

  it("labels a run with its issue key and title", () => {
    const [item] = build([issueNavigationLocation(team.id, run.id)]);
    expect(item?.label).toBe(run.title);
    expect(item?.eyebrow).toBe("TA-42");
    expect(item?.context).toBe(team.name);
  });

  it("falls back to the issue list when the run is no longer loaded", () => {
    const [item] = build([issueNavigationLocation(team.id, "run-gone")]);
    expect(item?.label).toBe("sidebar.issues");
    expect(item?.eyebrow).toBe("sidebar.issues");
  });

  it("falls back the same way when another team's payload is open", () => {
    const [item] = build([issueNavigationLocation(team.id, run.id)], {
      dashboard: { ...dashboard, team: { ...team, id: "team-b" } },
    });
    expect(item?.label).toBe("sidebar.issues");
  });

  it("labels a channel with its name and slug", () => {
    const [item] = build(
      [
        channelNavigationLocation(
          "channels",
          organization.id,
          "channel-1",
          team.id,
        ),
      ],
      { channels: [channel()] },
    );
    expect(item?.label).toBe("General");
    expect(item?.eyebrow).toBe("#general");
    expect(item?.context).toBe(organization.name);
  });

  it("labels a direct message by its participants", () => {
    const [item] = build(
      [
        channelNavigationLocation("dms", organization.id, "channel-1", team.id),
      ],
      {
        channels: [
          channel({
            kind: "dm",
            dmParticipants: [
              { type: "user", id: "user-1", name: "Me", image: null },
              { type: "user", id: "user-2", name: "Sam", image: null },
            ],
          }),
        ],
      },
    );
    expect(item?.label).toBe("Sam");
    expect(item?.eyebrow).toBe("sidebar.dms");
  });

  it("labels a settings entry by its scope and section", () => {
    const [application] = build([
      settingsNavigationLocation({ scope: "application", section: "account" }),
    ]);
    expect(application?.context).toBeNull();

    const [project] = build([
      settingsNavigationLocation({
        scope: "project",
        projectId: team.id,
        section: "workflow",
      }),
    ]);
    expect(project?.label).toBe("settings.navWorkflow");
    expect(project?.eyebrow).toBe(team.name);
    expect(project?.context).toBe("sidebar.projectSettings");

    const [organizationItem] = build([
      settingsNavigationLocation({
        scope: "organization",
        organizationId: organization.id,
        section: "members",
      }),
    ]);
    expect(organizationItem?.label).toBe("organization.membersAndInvites");
    expect(organizationItem?.eyebrow).toBe(organization.name);
  });

  it("names an organization page after the organization", () => {
    const [item] = build([
      organizationNavigationLocation(organization.id, "inbox"),
    ]);
    expect(item?.label).toBe("sidebar.inbox");
    expect(item?.eyebrow).toBe(organization.name);
  });

  it("names a team page after the team, and an unknown team after the list", () => {
    const [known] = build([projectNavigationLocation("agents", team.id)]);
    expect(known?.eyebrow).toBe(team.name);

    const [unknown] = build([projectNavigationLocation("agents", "team-gone")]);
    expect(unknown?.eyebrow).toBe("sidebar.projects");
  });

  it("falls back to the product name for a bare page", () => {
    const [item] = build(["lobby"]);
    expect(item?.label).toBe("lobby.eyebrow");
    expect(item?.eyebrow).toBe("Briar");
  });
});
