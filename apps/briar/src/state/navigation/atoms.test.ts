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
import { activeChannelIdAtom } from "../channels/atoms";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  activePageAtom,
  activeRunIdAtom,
  activeTeamForTabsAtom,
  canGoBackAtom,
  canGoForwardAtom,
  desktopActiveChannelIdAtom,
  navigationChannelIdAtom,
  navigationHistoryAtom,
  navigationHistoryEntriesAtom,
  navigationHistoryIndexAtom,
  navigationHistoryRunLabelsAtom,
  navigationHistoryUserIdAtom,
  navigationLocationAtom,
  navigationOrganizationIdAtom,
  navigationSettingsTargetAtom,
  navigationTeamIdAtom,
  navigationUserBoundaryChangedAtom,
} from "./atoms";
import {
  createNavigationHistory,
  reduceNavigationHistory,
  type NavigationAction,
} from "./history";
import type { AppNavigationLocation } from "../../lib/app-navigation";
import type { Project, SessionUser } from "../../types";

/*
  The visit stack as a value in the registry.

  `history.test.ts` covers the reducer itself; what is asserted here is the part
  that used to be a `useReducer` in the shell — that a write to the stack is a
  write to the registry, that each derived question answers from the location
  and nothing else, and that a change moves exactly the subscribers whose answer
  changed.
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

const dispatch = (
  registry: AtomRegistry,
  action: NavigationAction<AppNavigationLocation>,
) => {
  registry.update(navigationHistoryAtom, (history) =>
    reduceNavigationHistory(history, action),
  );
};

const navigate = (registry: AtomRegistry, value: AppNavigationLocation) =>
  dispatch(registry, { type: "navigate", value });

describe("navigation location atoms", () => {
  it("starts on the lobby with nowhere to go", () => {
    const registry = createTestRegistry();

    expect(registry.get(navigationLocationAtom)).toBe("lobby");
    expect(registry.get(activePageAtom)).toBe("lobby");
    expect(registry.get(canGoBackAtom)).toBe(false);
    expect(registry.get(canGoForwardAtom)).toBe(false);
    expect(registry.get(navigationHistoryEntriesAtom)).toEqual(["lobby"]);
    expect(registry.get(navigationHistoryIndexAtom)).toBe(0);
  });

  it("moves the location, the entries and the direction flags together", () => {
    const registry = createTestRegistry();
    navigate(registry, projectNavigationLocation("issues", teamA.id));
    navigate(registry, projectNavigationLocation("agents", teamA.id));

    expect(registry.get(activePageAtom)).toBe("agents");
    expect(registry.get(canGoBackAtom)).toBe(true);
    expect(registry.get(canGoForwardAtom)).toBe(false);
    expect(registry.get(navigationHistoryEntriesAtom)).toHaveLength(3);

    dispatch(registry, { type: "back" });
    expect(registry.get(activePageAtom)).toBe("issues");
    expect(registry.get(canGoForwardAtom)).toBe(true);
    expect(registry.get(navigationHistoryIndexAtom)).toBe(1);

    dispatch(registry, { type: "forward" });
    expect(registry.get(activePageAtom)).toBe("agents");

    dispatch(registry, { type: "reset", value: "lobby" });
    expect(registry.get(navigationHistoryEntriesAtom)).toEqual(["lobby"]);
    expect(registry.get(canGoBackAtom)).toBe(false);
  });

  it("answers every id question from the location alone", () => {
    const registry = createTestRegistry();

    navigate(registry, issueNavigationLocation(teamA.id, "run-1"));
    expect(registry.get(activePageAtom)).toBe("issues");
    expect(registry.get(activeRunIdAtom)).toBe("run-1");
    expect(registry.get(navigationTeamIdAtom)).toBe(teamA.id);
    expect(registry.get(navigationOrganizationIdAtom)).toBeNull();

    navigate(
      registry,
      channelNavigationLocation("dms", "org-a", "dm-1", teamB.id),
    );
    expect(registry.get(activePageAtom)).toBe("dms");
    expect(registry.get(activeRunIdAtom)).toBeNull();
    expect(registry.get(navigationChannelIdAtom)).toBe("dm-1");
    expect(registry.get(navigationOrganizationIdAtom)).toBe("org-a");
    expect(registry.get(navigationTeamIdAtom)).toBe(teamB.id);

    navigate(registry, organizationNavigationLocation("org-a", "inbox"));
    expect(registry.get(activePageAtom)).toBe("inbox");
    expect(registry.get(navigationTeamIdAtom)).toBeNull();

    navigate(
      registry,
      settingsNavigationLocation({
        scope: "organization",
        organizationId: "org-a",
        section: "members",
      }),
    );
    expect(registry.get(activePageAtom)).toBe("settings");
    expect(registry.get(navigationSettingsTargetAtom)).toEqual({
      scope: "organization",
      organizationId: "org-a",
      section: "members",
    });
  });

  it("prefers the location's channel over the selected one, and only there", () => {
    const registry = createTestRegistry([
      [activeOrganizationIdAtom, "org-a"],
    ]);
    registry.set(activeChannelIdAtom, "selected-channel");

    expect(registry.get(desktopActiveChannelIdAtom)).toBe("selected-channel");

    navigate(
      registry,
      channelNavigationLocation("channels", "org-a", "channel-a"),
    );
    expect(registry.get(desktopActiveChannelIdAtom)).toBe("channel-a");

    // A channel page with no channel in it means "none open on this page".
    navigate(registry, channelPageNavigationLocation("channels", "org-a"));
    expect(registry.get(desktopActiveChannelIdAtom)).toBeNull();

    navigate(registry, projectNavigationLocation("issues", teamA.id));
    expect(registry.get(desktopActiveChannelIdAtom)).toBe("selected-channel");
  });

  it("resolves the team whose tabs the page shows", () => {
    const registry = createTestRegistry([
      [teamsAtom, [teamA, teamB]],
      [activeTeamIdAtom, teamA.id],
    ]);

    expect(registry.get(activeTeamForTabsAtom)).toBe(teamA);

    navigate(registry, projectNavigationLocation("issues", teamB.id));
    expect(registry.get(activeTeamForTabsAtom)).toBe(teamB);

    registry.set(teamsAtom, [teamA]);
    expect(registry.get(activeTeamForTabsAtom)).toBeUndefined();
  });

  it("notifies the page once per page change and not per location change", () => {
    const registry = createTestRegistry();
    const pages: string[] = [];
    const locations: string[] = [];
    const unsubscribePage = registry.subscribe(
      activePageAtom,
      (page) => pages.push(page),
      { immediate: true },
    );
    const unsubscribeLocation = registry.subscribe(
      navigationLocationAtom,
      (location) => locations.push(location),
      { immediate: true },
    );

    navigate(registry, projectNavigationLocation("issues", teamA.id));
    // Same page, different team: the location moves, the page does not.
    navigate(registry, projectNavigationLocation("issues", teamB.id));
    navigate(registry, projectNavigationLocation("agents", teamB.id));
    unsubscribePage();
    unsubscribeLocation();

    expect(pages).toEqual(["lobby", "issues", "agents"]);
    expect(locations).toHaveLength(4);
  });

  it("keeps the entry list identity across a move that did not change it", () => {
    const registry = createTestRegistry();
    navigate(registry, projectNavigationLocation("issues", teamA.id));
    const entries = registry.get(navigationHistoryEntriesAtom);

    dispatch(registry, { type: "back" });

    expect(registry.get(navigationHistoryEntriesAtom)).toBe(entries);
  });

  it("marks the boundary only between two different accounts", () => {
    const registry = createTestRegistry([[userAtom, user]]);

    // Nothing has claimed the stack yet, so the first account is not a change.
    expect(registry.get(navigationUserBoundaryChangedAtom)).toBe(false);

    registry.set(navigationHistoryUserIdAtom, user.id);
    expect(registry.get(navigationUserBoundaryChangedAtom)).toBe(false);

    registry.set(userAtom, { ...user, id: "user-2" });
    expect(registry.get(navigationUserBoundaryChangedAtom)).toBe(true);

    registry.set(navigationHistoryUserIdAtom, "user-2");
    expect(registry.get(navigationUserBoundaryChangedAtom)).toBe(false);

    // Signing out is a boundary too: the stack belongs to nobody afterwards.
    registry.set(userAtom, null);
    expect(registry.get(navigationUserBoundaryChangedAtom)).toBe(true);
  });

  it("bounds the stack the same way through the registry", () => {
    const registry = createTestRegistry();
    for (let index = 0; index < 150; index += 1) {
      navigate(registry, issueNavigationLocation(teamA.id, `run-${index}`));
    }

    expect(registry.get(navigationHistoryEntriesAtom)).toHaveLength(100);
    expect(registry.get(activeRunIdAtom)).toBe("run-149");
    expect(registry.get(navigationHistoryAtom)).toEqual(
      reduceNavigationHistory(
        registry.get(navigationHistoryAtom),
        // A repeat of the location on screen is not a visit.
        { type: "navigate", value: issueNavigationLocation(teamA.id, "run-149") },
      ),
    );
  });

  it("starts a fresh stack from a reset", () => {
    const registry = createTestRegistry();
    navigate(registry, projectNavigationLocation("issues", teamA.id));
    dispatch(registry, { type: "reset", value: "lobby" });

    expect(registry.get(navigationHistoryAtom)).toEqual(
      createNavigationHistory("lobby"),
    );
  });
});

describe("navigationHistoryRunLabelsAtom", () => {
  const target = demoDashboard.runs[0]!;

  const loaded = () => {
    const registry = createTestRegistry([
      [teamsAtom, [teamA]],
      [activeTeamIdAtom, teamA.id],
    ]);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamA.id,
      payload: { ...demoDashboard, team: teamA },
    });
    return registry;
  };

  it("labels only the runs the visit stack points at", () => {
    const registry = loaded();
    const other = demoDashboard.runs[1]!;
    navigate(registry, issueNavigationLocation(teamA.id, target.id));

    const labels = registry.get(navigationHistoryRunLabelsAtom);
    expect(labels.get(target.id)).toEqual({
      runNumber: target.runNumber,
      title: target.title,
    });
    expect(labels.has(other.id)).toBe(false);
  });

  it("says nothing when a run it never visited changes", () => {
    const registry = loaded();
    navigate(registry, issueNavigationLocation(teamA.id, target.id));
    const seen: unknown[] = [];
    registry.subscribe(
      navigationHistoryRunLabelsAtom,
      (labels) => seen.push(labels),
      { immediate: true },
    );
    seen.length = 0;

    const other = demoDashboard.runs[1]!;
    applySyncEvent(registry, {
      kind: "run-changed",
      teamId: teamA.id,
      run: { ...other, title: "다른 이슈를 고쳤다" },
    });
    // …and neither does a field this row does not print.
    applySyncEvent(registry, {
      kind: "run-changed",
      teamId: teamA.id,
      run: { ...target, progress: (target.progress + 1) % 100 },
    });

    expect(seen).toEqual([]);
  });

  it("follows a visited run's title", () => {
    const registry = loaded();
    navigate(registry, issueNavigationLocation(teamA.id, target.id));
    const seen: unknown[] = [];
    registry.subscribe(
      navigationHistoryRunLabelsAtom,
      (labels) => seen.push(labels),
      { immediate: true },
    );
    seen.length = 0;

    applySyncEvent(registry, {
      kind: "run-changed",
      teamId: teamA.id,
      run: { ...target, title: "고친 이슈" },
    });

    expect(seen).toHaveLength(1);
    expect(registry.get(navigationHistoryRunLabelsAtom).get(target.id)?.title)
      .toBe("고친 이슈");
  });
});
