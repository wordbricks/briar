/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import {
  channelNavigationLocation,
  channelPageNavigationLocation,
  organizationNavigationLocation,
  projectNavigationLocation,
  settingsNavigationLocation,
} from "../../lib/app-navigation";
import { organizationChannelsAtom } from "../entities/channels";
import { applySyncEvent } from "../sync/apply";
import { channelApiAtom } from "../channels/api";
import {
  activeChannelIdAtom,
  channelCatalogCursorAtom,
  directMessageComposeAtom,
} from "../channels/atoms";
import {
  activePageAtom,
  activeRunIdAtom,
  canGoBackAtom,
  canGoForwardAtom,
  desktopActiveChannelIdAtom,
  navigationHistoryEntriesAtom,
  navigationHistoryIndexAtom,
  navigationLocationAtom,
  navigationTeamIdAtom,
  settingsTargetAtom,
} from "./atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import {
  loadingAtom,
  restoringSessionAtom,
  tokenAtom,
  userAtom,
} from "../session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { createReactTestRoot, flush } from "../../test/react";
import type { ChannelSummary } from "../../lib/channels-contract";
import type { Organization, Project, SessionUser } from "../../types";
import { createNavigationActions, type NavigationActions } from "./actions";
import { useNavigationReconciliation } from "./useNavigationReconciliation";

/*
  The reconciliation the location and the store owe each other.

  These cases pin every outcome of the six effects that run in a fixed order —
  user boundary reset, settings target sync, team id backfill, team existence
  fallback, organization existence fallback, schedule tab gate — plus the
  navigation actions that feed them. They were written against the block while
  it still lived in the app shell and have followed it unchanged since, which is
  what makes them this phase's characterization.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const teamOf = (id: string, overrides: Partial<Project> = {}): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
  ...overrides,
});
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");
const scheduleLessTeam = teamOf("team-no-schedule", {
  scheduleTabEnabled: false,
});

const organizationOf = (id: string): Organization => ({
  id,
  name: id,
  handle: id,
  logo: null,
  role: "owner",
  createdAt: "2026-09-01T00:00:00.000Z",
});
const organization = organizationOf(teamA.organizationId);
const otherOrganization = organizationOf("organization-b");

const channelOf = (id: string): ChannelSummary => ({
  id,
  organizationId: organization.id,
  kind: "channel",
  slug: id,
  name: id,
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  createdByUserId: user.id,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
});

const seedChannels = (registry: AtomRegistry, channels: ChannelSummary[]) => {
  applySyncEvent(registry, {
    kind: "channel-catalog-snapshot",
    organizationId: organization.id,
    channels,
  });
};

let actions: NavigationActions;

function Harness() {
  useNavigationReconciliation();
  return null;
}

const harness = (
  teams: Project[] = [teamA, teamB],
  organizations: Organization[] = [organization],
): AtomRegistry =>
  createTestRegistry([
    [userAtom, user],
    [restoringSessionAtom, false],
    // The fallback effects wait for the session to settle before replacing a
    // location, exactly as they did inline.
    [loadingAtom, false],
    [tokenAtom, "token-1"],
    [teamsAtom, teams],
    [activeTeamIdAtom, teams[0]?.id ?? null],
    [organizationsAtom, organizations],
    [activeOrganizationIdAtom, organizations[0]?.id ?? null],
    // Marking a channel read confirms with the server; nothing here needs the
    // round trip, and the local write is what the assertions look at.
    [channelApiAtom, { markChannelRead: async () => undefined }],
  ]);

const mount = async (registry: AtomRegistry) => {
  actions = createNavigationActions(registry);
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

describe("navigation reconciliation", () => {
  it("puts the selected team into a project page's location", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("issues");
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("issues");
    expect(registry.get(navigationTeamIdAtom)).toBe(teamA.id);
    await view.cleanup();
  });

  it("selects the team a location names", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("issues", teamB.id);
    });
    await flush();
    expect(registry.get(navigationTeamIdAtom)).toBe(teamB.id);
    expect(registry.get(activeTeamIdAtom)).toBe(teamB.id);
    await view.cleanup();
  });

  it("falls back when the location names a team the account lost", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("issues", teamB.id);
    });
    await flush();
    expect(registry.get(navigationTeamIdAtom)).toBe(teamB.id);

    await act(async () => {
      registry.set(teamsAtom, [teamA]);
    });
    await flush();
    // The gone team is replaced rather than left on screen.
    expect(registry.get(navigationTeamIdAtom)).toBe(teamA.id);
    await view.cleanup();
  });

  it("keeps the settings location and the settings target in step", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      registry.set(settingsTargetAtom, {
        scope: "application",
        section: "account",
      });
      actions.navigateToPage("settings");
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("settings");
    expect(registry.get(settingsTargetAtom)).toEqual({
      scope: "application",
      section: "account",
    });

    // Leaving settings goes back past every settings entry in the history.
    await act(async () => {
      actions.closeSettings();
    });
    await flush();
    expect(registry.get(activePageAtom)).not.toBe("settings");
    await view.cleanup();
  });

  it("resets the history when a different account signs in", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("agents", teamA.id);
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("agents");

    await act(async () => {
      registry.set(userAtom, { ...user, id: "user-2" });
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("dms");
    await view.cleanup();
  });

  it("backfills the selected team onto a bare project page location", async () => {
    const registry = harness();
    const view = await mount(registry);

    // `resetNavigation` writes the page with no team in it, which is the one
    // entry point the team backfill effect exists for.
    await act(async () => {
      actions.resetNavigation("agents");
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("agents");
    expect(registry.get(navigationLocationAtom)).toBe(
      projectNavigationLocation("agents", teamA.id),
    );
    await view.cleanup();
  });

  it("adopts the settings target a settings location names", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToLocation(
        settingsNavigationLocation({
          scope: "organization",
          organizationId: organization.id,
          section: "members",
        }),
      );
    });
    await flush();
    expect(registry.get(settingsTargetAtom)).toEqual({
      scope: "organization",
      organizationId: organization.id,
      section: "members",
    });
    await view.cleanup();
  });

  it("writes the stored settings target into a bare settings location", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      registry.set(settingsTargetAtom, {
        scope: "application",
        section: "keybindings",
      });
      actions.navigateToLocation("settings");
    });
    await flush();
    expect(registry.get(navigationLocationAtom)).toBe(
      settingsNavigationLocation({
        scope: "application",
        section: "keybindings",
      }),
    );
    await view.cleanup();
  });

  it("keeps a channel location on a team the account lost, on the same organization", async () => {
    const registry = harness();
    seedChannels(registry, [
      channelOf("channel-a"),
    ]);
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToChannel(
        "channel-a",
        "channels",
        organization.id,
        teamB.id,
      );
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("channels");
    expect(registry.get(desktopActiveChannelIdAtom)).toBe("channel-a");

    await act(async () => {
      registry.set(teamsAtom, [teamA]);
    });
    await flush();
    // The channel survives; only the team in the location is swapped.
    expect(registry.get(navigationLocationAtom)).toBe(
      channelNavigationLocation(
        "channels",
        organization.id,
        "channel-a",
        teamA.id,
      ),
    );
    await view.cleanup();
  });

  it("sends a settings location for a lost team to the account settings", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToLocation(
        settingsNavigationLocation({
          scope: "project",
          projectId: teamB.id,
          section: "general",
        }),
      );
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("settings");

    await act(async () => {
      registry.set(teamsAtom, [teamA]);
    });
    await flush();
    expect(registry.get(navigationLocationAtom)).toBe(
      settingsNavigationLocation({
        scope: "application",
        section: "account",
      }),
    );
    await view.cleanup();
  });

  it("falls back to the lobby when no team is left to land on", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("issues", teamB.id);
    });
    await flush();

    await act(async () => {
      // Losing the last team clears the selection too; leaving a selected id
      // behind makes the backfill and the fallback undo each other forever.
      registry.set(teamsAtom, []);
      registry.set(activeTeamIdAtom, null);
    });
    await flush();
    expect(registry.get(navigationLocationAtom)).toBe("lobby");
    await view.cleanup();
  });

  it("falls back when the location names an organization the account lost", async () => {
    const registry = harness([teamA, teamB], [organization, otherOrganization]);
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToLocation(
        organizationNavigationLocation(otherOrganization.id, "inbox"),
      );
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("inbox");

    await act(async () => {
      registry.set(organizationsAtom, [organization]);
    });
    await flush();
    expect(registry.get(navigationLocationAtom)).toBe(
      organizationNavigationLocation(organization.id, "inbox"),
    );
    await view.cleanup();
  });

  it("keeps a channel page on the fallback organization when the named one is gone", async () => {
    const registry = harness([teamA, teamB], [organization, otherOrganization]);
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToLocation(
        channelPageNavigationLocation("channels", otherOrganization.id),
      );
    });
    await flush();

    await act(async () => {
      registry.set(organizationsAtom, [organization]);
    });
    await flush();
    expect(registry.get(navigationLocationAtom)).toBe(
      channelPageNavigationLocation("channels", organization.id, teamA.id),
    );
    await view.cleanup();
  });

  it("leaves the schedule page when the team turned its tab off", async () => {
    const registry = harness([scheduleLessTeam]);
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("schedule", scheduleLessTeam.id);
    });
    await flush();
    expect(registry.get(navigationLocationAtom)).toBe(
      projectNavigationLocation("issues", scheduleLessTeam.id),
    );
    expect(registry.get(activePageAtom)).toBe("issues");
    await view.cleanup();
  });

  it("stays on the schedule page while the tab is enabled", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("schedule");
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("schedule");
    await view.cleanup();
  });

  it("opens an issue on the team that owns it", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToIssue("run-1", teamB.id);
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("issues");
    expect(registry.get(activeRunIdAtom)).toBe("run-1");
    expect(registry.get(navigationTeamIdAtom)).toBe(teamB.id);
    await view.cleanup();
  });

  it("ignores an issue with no team to open it under", async () => {
    const registry = harness([]);
    const view = await mount(registry);
    const before = registry.get(navigationLocationAtom);

    await act(async () => {
      actions.navigateToIssue("run-1", null);
    });
    await flush();
    expect(registry.get(navigationLocationAtom)).toBe(before);
    expect(registry.get(activeRunIdAtom)).toBeNull();
    await view.cleanup();
  });

  it("opens a channel and marks it read", async () => {
    const registry = harness();
    seedChannels(registry, [
      { ...channelOf("channel-a"), hasUnread: true },
    ]);
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToChannel("channel-a", "channels");
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("channels");
    expect(registry.get(activeChannelIdAtom)).toBe("channel-a");
    expect(
      registry
        .get(organizationChannelsAtom(organization.id))
        .find((channel) => channel.id === "channel-a")?.hasUnread,
    ).toBe(false);
    await view.cleanup();
  });

  it("replaces the desktop channel destination without adding a visit", async () => {
    const registry = harness();
    seedChannels(registry, [
      channelOf("channel-a"),
      channelOf("channel-b"),
    ]);
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToChannel("channel-a", "channels");
    });
    await flush();
    const entriesBefore = registry.get(navigationHistoryEntriesAtom).length;

    await act(async () => {
      actions.handleDesktopChannelFallback("channel-b", "channels");
    });
    await flush();
    expect(registry.get(navigationHistoryEntriesAtom)).toHaveLength(entriesBefore);
    expect(registry.get(desktopActiveChannelIdAtom)).toBe("channel-b");
    await view.cleanup();
  });

  it("clears the open channel when the fallback has none to offer", async () => {
    const registry = harness();
    seedChannels(registry, [
      channelOf("channel-a"),
    ]);
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToChannel("channel-a", "channels");
    });
    await flush();
    expect(registry.get(activeChannelIdAtom)).toBe("channel-a");

    await act(async () => {
      actions.handleDesktopChannelFallback(null, "channels");
    });
    await flush();
    expect(registry.get(activeChannelIdAtom)).toBeNull();
    expect(registry.get(navigationLocationAtom)).toBe(
      channelPageNavigationLocation("channels", organization.id, teamA.id),
    );
    await view.cleanup();
  });

  it("moves back and forward through the history it recorded", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("issues");
    });
    await flush();
    await act(async () => {
      actions.navigateToPage("agents");
    });
    await flush();
    expect(registry.get(canGoBackAtom)).toBe(true);
    expect(registry.get(canGoForwardAtom)).toBe(false);

    await act(async () => {
      actions.goBack();
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("issues");
    expect(registry.get(canGoForwardAtom)).toBe(true);

    await act(async () => {
      actions.goForward();
    });
    await flush();
    expect(registry.get(activePageAtom)).toBe("agents");

    await act(async () => {
      actions.goToNavigationHistory(0);
    });
    await flush();
    expect(registry.get(navigationHistoryIndexAtom)).toBe(0);
    await view.cleanup();
  });

  it("drops the history the account before it built", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      actions.navigateToPage("issues");
    });
    await flush();
    await act(async () => {
      actions.navigateToPage("agents");
    });
    await flush();
    expect(registry.get(navigationHistoryEntriesAtom).length).toBeGreaterThan(1);

    await act(async () => {
      registry.set(userAtom, { ...user, id: "user-2" });
    });
    await flush();
    expect(registry.get(canGoBackAtom)).toBe(false);
    expect(registry.get(canGoForwardAtom)).toBe(false);
    await view.cleanup();
  });
});

describe("the DM page's latest conversation", () => {
  const directMessageOf = (id: string, lastMessageAt: string): ChannelSummary => ({
    ...channelOf(id),
    kind: "dm",
    visibility: "private",
    lastMessageAt,
    dmParticipants: [
      { type: "user", id: user.id, name: user.name, image: null },
      { type: "user", id: `${id}-peer`, name: id, image: null },
    ],
  });
  const older = directMessageOf("dm-older", "2026-09-01T09:00:00.000Z");
  const latest = directMessageOf("dm-latest", "2026-09-02T09:00:00.000Z");

  it("opens the latest conversation when the window lands on the DM page", async () => {
    const registry = harness();
    seedChannels(registry, [older, latest]);
    registry.set(channelCatalogCursorAtom, 1);
    const view = await mount(registry);

    expect(registry.get(navigationLocationAtom)).toBe(
      channelNavigationLocation("dms", organization.id, latest.id, teamA.id),
    );
    expect(registry.get(activeChannelIdAtom)).toBe(latest.id);
    // Swapped in, not visited: Back has nowhere to go.
    expect(registry.get(navigationHistoryEntriesAtom)).toHaveLength(1);
    expect(registry.get(canGoBackAtom)).toBe(false);
    await view.cleanup();
  });

  it("waits for the catalog before choosing a conversation", async () => {
    const registry = harness();
    seedChannels(registry, [older, latest]);
    const view = await mount(registry);

    expect(registry.get(navigationLocationAtom)).toBe("dms");
    expect(registry.get(activeChannelIdAtom)).toBeNull();

    await act(async () => {
      registry.set(channelCatalogCursorAtom, 1);
    });
    await flush();
    expect(registry.get(activeChannelIdAtom)).toBe(latest.id);
    await view.cleanup();
  });

  it("leaves the page on nothing while a new conversation is composed", async () => {
    const registry = harness();
    seedChannels(registry, [older, latest]);
    registry.set(channelCatalogCursorAtom, 1);
    registry.set(directMessageComposeAtom, true);
    const view = await mount(registry);

    expect(registry.get(navigationLocationAtom)).toBe("dms");
    expect(registry.get(activeChannelIdAtom)).toBeNull();

    // Opening a conversation ends the compose and shows it.
    await act(async () => {
      actions.navigateToChannel(older.id, "dms");
    });
    await flush();
    expect(registry.get(directMessageComposeAtom)).toBe(false);
    expect(registry.get(activeChannelIdAtom)).toBe(older.id);
    await view.cleanup();
  });

  it("does nothing off the DM page", async () => {
    const registry = harness();
    seedChannels(registry, [older, latest]);
    registry.set(channelCatalogCursorAtom, 1);
    createNavigationActions(registry).resetNavigation("issues");
    const view = await mount(registry);

    expect(registry.get(activePageAtom)).toBe("issues");
    expect(registry.get(activeChannelIdAtom)).toBeNull();
    await view.cleanup();
  });
});
