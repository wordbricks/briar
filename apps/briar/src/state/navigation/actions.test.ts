import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import {
  channelNavigationLocation,
  channelPageNavigationLocation,
  issueNavigationLocation,
  organizationNavigationLocation,
  projectNavigationLocation,
  settingsNavigationLocation,
} from "../../lib/app-navigation";
import { channelApiAtom } from "../channels/api";
import { activeChannelIdAtom } from "../channels/atoms";
import { organizationChannelsAtom } from "../entities/channels";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { createNavigationActions } from "./actions";
import {
  activePageAtom,
  activeRunIdAtom,
  desktopActiveChannelIdAtom,
  navigationHistoryEntriesAtom,
  navigationLocationAtom,
} from "./atoms";
import type { ChannelSummary } from "../../lib/channels-contract";
import type { Project } from "../../types";

/*
  Moving, without a React tree.

  These are the shell's `useCallback`s. Bound to a registry they are ordinary
  functions, so what each one writes — the location, the visit stack, the open
  channel, the read marker — is asserted directly.
*/

const teamOf = (id: string, overrides: Partial<Project> = {}): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  organizationId: "org-a",
  ...overrides,
});
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

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

const harness = ({
  activeTeamId = teamA.id,
  activeOrganizationId = "org-a" as string | null,
  channels = [] as ChannelSummary[],
}: {
  activeTeamId?: string | null;
  activeOrganizationId?: string | null;
  channels?: ChannelSummary[];
} = {}) => {
  const reads: string[] = [];
  const registry: AtomRegistry = createTestRegistry([
    [teamsAtom, [teamA, teamB]],
    [activeTeamIdAtom, activeTeamId],
    [activeOrganizationIdAtom, activeOrganizationId],
    [tokenAtom, "token-1"],
    [
      channelApiAtom,
      {
        markChannelRead: async (
          _token: string,
          _organizationId: string,
          channelId: string,
        ) => {
          reads.push(channelId);
        },
      },
    ],
  ]);
  if (channels.length > 0) {
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-a",
      channels,
    });
  }
  return { actions: createNavigationActions(registry), reads, registry };
};

describe("navigation actions", () => {
  it("carries the selected team onto a project page", () => {
    const { actions, registry } = harness();

    actions.navigateToPage("agents");

    expect(registry.get(navigationLocationAtom)).toBe(
      projectNavigationLocation("agents", teamA.id),
    );
  });

  it("takes the team it is given over the selected one", () => {
    const { actions, registry } = harness();

    actions.navigateToPage("issues", teamB.id);

    expect(registry.get(navigationLocationAtom)).toBe(
      projectNavigationLocation("issues", teamB.id),
    );
  });

  it("sends the organization pages to the organization location", () => {
    const { actions, registry } = harness();

    actions.navigateToPage("inbox");
    expect(registry.get(navigationLocationAtom)).toBe(
      organizationNavigationLocation("org-a", "inbox"),
    );

    actions.navigateToPage("channels");
    expect(registry.get(navigationLocationAtom)).toBe(
      channelPageNavigationLocation("channels", "org-a", teamA.id),
    );
  });

  it("leaves a page that belongs to neither as itself", () => {
    const { actions, registry } = harness({ activeOrganizationId: null });

    actions.navigateToPage("organization-create");

    expect(registry.get(navigationLocationAtom)).toBe("organization-create");
  });

  it("opens an issue only when a team owns it", () => {
    const withTeam = harness();
    withTeam.actions.navigateToIssue("run-1");
    expect(withTeam.registry.get(navigationLocationAtom)).toBe(
      issueNavigationLocation(teamA.id, "run-1"),
    );
    expect(withTeam.registry.get(activeRunIdAtom)).toBe("run-1");

    const withoutTeam = harness({ activeTeamId: null });
    withoutTeam.actions.navigateToIssue("run-1");
    expect(withoutTeam.registry.get(navigationLocationAtom)).toBe("dms");
  });

  it("opens a channel, selects it and marks it read", () => {
    const { actions, reads, registry } = harness({
      channels: [channelOf("channel-a", { hasUnread: true })],
    });

    actions.navigateToChannel("channel-a", "channels");

    expect(registry.get(navigationLocationAtom)).toBe(
      channelNavigationLocation("channels", "org-a", "channel-a", teamA.id),
    );
    expect(registry.get(activeChannelIdAtom)).toBe("channel-a");
    expect(registry.get(desktopActiveChannelIdAtom)).toBe("channel-a");
    expect(
      registry
        .get(organizationChannelsAtom("org-a"))
        .find((channel) => channel.id === "channel-a")?.hasUnread,
    ).toBe(false);
    expect(reads).toEqual(["channel-a"]);
  });

  it("does nothing with a channel and no organization to put it in", () => {
    const { actions, registry } = harness({ activeOrganizationId: null });

    actions.navigateToChannel("channel-a", "channels");

    expect(registry.get(navigationLocationAtom)).toBe("dms");
    expect(registry.get(activeChannelIdAtom)).toBeNull();
  });

  it("replaces the channel on screen without recording a visit", () => {
    const { actions, registry } = harness({
      channels: [channelOf("channel-a"), channelOf("channel-b")],
    });
    actions.navigateToChannel("channel-a", "channels");
    const visits = registry.get(navigationHistoryEntriesAtom).length;

    actions.replaceChannelDestination("channel-b", "channels");

    expect(registry.get(navigationHistoryEntriesAtom)).toHaveLength(visits);
    expect(registry.get(desktopActiveChannelIdAtom)).toBe("channel-b");
  });

  it("drops to the bare channel page when the replacement has no channel", () => {
    const { actions, registry } = harness({
      channels: [channelOf("channel-a")],
    });
    actions.navigateToChannel("channel-a", "channels");

    actions.replaceChannelDestination(null, "channels");

    expect(registry.get(navigationLocationAtom)).toBe(
      channelPageNavigationLocation("channels", "org-a", teamA.id),
    );
    expect(registry.get(activeChannelIdAtom)).toBeNull();
  });

  it("ignores a channel fallback reported for another organization", () => {
    const { actions, registry } = harness({
      channels: [channelOf("channel-a")],
    });
    actions.navigateToChannel("channel-a", "channels");
    const location = registry.get(navigationLocationAtom);

    // The view reporting the fallback is the one that is leaving; the
    // organization already moved on.
    registry.set(activeOrganizationIdAtom, "org-b");
    actions.handleDesktopChannelFallback(null, "channels");

    expect(registry.get(navigationLocationAtom)).toBe(location);
  });

  it("returns past every settings entry the stack holds", () => {
    const { actions, registry } = harness();
    actions.navigateToPage("issues");
    actions.navigateToLocation(
      settingsNavigationLocation({ scope: "application", section: "account" }),
    );
    actions.navigateToLocation(
      settingsNavigationLocation({
        scope: "project",
        projectId: teamA.id,
        section: "general",
      }),
    );

    actions.closeSettings();

    expect(registry.get(navigationLocationAtom)).toBe(
      projectNavigationLocation("issues", teamA.id),
    );
    expect(registry.get(activePageAtom)).toBe("issues");
  });

  it("starts a clean stack when nothing before settings matched", () => {
    const { actions, registry } = harness();
    actions.resetNavigation("settings");
    actions.navigateToLocation(
      settingsNavigationLocation({ scope: "application", section: "usage" }),
    );

    actions.closeSettings();

    expect(registry.get(navigationLocationAtom)).toBe(
      projectNavigationLocation("issues", teamA.id),
    );
    expect(registry.get(navigationHistoryEntriesAtom)).toHaveLength(1);
  });

  it("walks the stack the shell's buttons walk", () => {
    const { actions, registry } = harness();
    actions.navigateToPage("issues");
    actions.navigateToPage("agents");

    actions.goBack();
    expect(registry.get(activePageAtom)).toBe("issues");

    actions.goForward();
    expect(registry.get(activePageAtom)).toBe("agents");

    actions.goToNavigationHistory(0);
    expect(registry.get(activePageAtom)).toBe("dms");

    actions.resetNavigation("lobby");
    expect(registry.get(navigationHistoryEntriesAtom)).toEqual(["lobby"]);
  });
});
