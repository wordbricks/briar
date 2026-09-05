import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import { demoOrganization, demoUser } from "../demo-fixtures";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom, userAtom } from "../session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { createNavigationActions } from "./actions";
import { companionPageAtom, settingsTargetAtom } from "./atoms";
import {
  activeKeptPageAtom,
  activeShellAtom,
  companionKeptPageAtom,
  desktopKeptPageAtom,
  KEPT_PAGE_LIMIT,
  keptPageKey,
  keptPageKeysAtom,
  pageVisibleAtom,
  touchKeptPage,
} from "./keep-alive";

/*
  The keep-alive policy, without rendering anything.

  Everything here is a question about the app rather than about React — which
  page is worth keeping, how many, and what makes the whole set stale — so it is
  asserted against the registry directly. `components/app/KeepAliveSlot.test.tsx`
  covers the other half: what a slot does with the answer.
*/

const team = demoDashboard.team;
const otherTeam = { ...team, id: "team-2", name: "Team two" };
const otherOrganization = { ...demoOrganization, id: "org-2" };

const harness = (): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, demoUser],
    [tokenAtom, "token-1"],
    [teamsAtom, [team, otherTeam]],
    [activeTeamIdAtom, team.id],
    [organizationsAtom, [demoOrganization, otherOrganization]],
    [activeOrganizationIdAtom, demoOrganization.id],
  ]);
  // A derived LRU only sees the visits it is subscribed for, which is the
  // arrangement it lives in: the page slot is always reading it.
  registry.subscribe(keptPageKeysAtom, () => undefined, { immediate: true });
  return registry;
};

describe("touchKeptPage", () => {
  it("keeps the newest key and drops the oldest past the bound", () => {
    let keys: readonly string[] = [];
    for (const key of ["a", "b", "c", "d", "e"]) keys = touchKeptPage(keys, key);
    expect(keys).toEqual(["b", "c", "d", "e"]);
    expect(keys).toHaveLength(KEPT_PAGE_LIMIT + 1);
  });

  it("returns the same array when the key is already the most recent", () => {
    const keys = touchKeptPage(["a", "b"], "b");
    expect(keys).toEqual(["a", "b"]);
    expect(touchKeptPage(keys, "b")).toBe(keys);
  });

  it("moves a revisited key to the recent end without duplicating it", () => {
    expect(touchKeptPage(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
  });
});

describe("desktopKeptPageAtom", () => {
  it("names the board, the inbox, the lists and the channel pages", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);

    navigation.resetNavigation("issues");
    expect(registry.get(desktopKeptPageAtom)).toEqual({
      kind: "board",
      scopeId: team.id,
    });

    navigation.navigateToPage("inbox");
    expect(registry.get(desktopKeptPageAtom)).toEqual({
      kind: "inbox",
      scopeId: demoOrganization.id,
    });

    navigation.navigateToPage("my-issues");
    expect(registry.get(desktopKeptPageAtom)).toEqual({
      kind: "my-issues",
      scopeId: demoOrganization.id,
    });

    navigation.navigateToPage("channels");
    expect(registry.get(desktopKeptPageAtom)).toEqual({
      kind: "channels",
      scopeId: demoOrganization.id,
    });

    navigation.navigateToPage("dms");
    expect(registry.get(desktopKeptPageAtom)).toEqual({
      kind: "dms",
      scopeId: demoOrganization.id,
    });
  });

  it("keeps nothing for the pages that unmount on leave", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);

    for (const page of ["lobby", "agents", "schedule", "projects"] as const) {
      navigation.navigateToPage(page);
      expect(registry.get(desktopKeptPageAtom)).toBeNull();
    }

    navigation.navigateToPage("organization-create");
    expect(registry.get(desktopKeptPageAtom)).toBeNull();

    registry.set(settingsTargetAtom, {
      scope: "application",
      section: "general",
    });
    navigation.navigateToPage("settings");
    expect(registry.get(desktopKeptPageAtom)).toBeNull();
  });

  it("falls back to the board where a page's own guard fails", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);
    navigation.navigateToPage("channels");
    // A signed-out window has no channels page, and the chain draws the board.
    registry.set(tokenAtom, null);
    expect(registry.get(desktopKeptPageAtom)).toEqual({
      kind: "board",
      scopeId: team.id,
    });
  });

  it("gives another team's board its own key", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);
    navigation.resetNavigation("issues");
    registry.set(activeTeamIdAtom, otherTeam.id);
    expect(registry.get(desktopKeptPageAtom)).toEqual({
      kind: "board",
      scopeId: otherTeam.id,
    });
  });
});

describe("companionKeptPageAtom", () => {
  it("names the phone's own four pages and keeps nothing under a session", () => {
    const registry = harness();
    registry.set(activeShellAtom, "companion");

    expect(registry.get(companionKeptPageAtom)).toEqual({
      kind: "board",
      scopeId: team.id,
    });
    expect(registry.get(activeKeptPageAtom)).toEqual({
      kind: "board",
      scopeId: team.id,
    });

    registry.set(companionPageAtom, "home");
    expect(registry.get(companionKeptPageAtom)).toEqual({
      kind: "channels",
      scopeId: demoOrganization.id,
    });

    registry.set(companionPageAtom, "inbox");
    expect(registry.get(companionKeptPageAtom)).toEqual({
      kind: "inbox",
      scopeId: demoOrganization.id,
    });

    registry.set(companionPageAtom, "settings");
    expect(registry.get(companionKeptPageAtom)).toBeNull();
  });
});

describe("keptPageKeysAtom", () => {
  it("holds the page on screen and the last three before it", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);

    navigation.resetNavigation("issues");
    navigation.navigateToPage("inbox");
    navigation.navigateToPage("channels");
    navigation.navigateToPage("dms");
    expect(registry.get(keptPageKeysAtom)).toEqual([
      `board:${team.id}`,
      `inbox:${demoOrganization.id}`,
      `channels:${demoOrganization.id}`,
      `dms:${demoOrganization.id}`,
    ]);

    // The fifth heavy page pushes the oldest one out.
    navigation.navigateToPage("my-issues");
    expect(registry.get(keptPageKeysAtom)).toEqual([
      `inbox:${demoOrganization.id}`,
      `channels:${demoOrganization.id}`,
      `dms:${demoOrganization.id}`,
      `my-issues:${demoOrganization.id}`,
    ]);
  });

  it("leaves the set alone while a page that is not kept is on screen", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);

    navigation.resetNavigation("issues");
    navigation.navigateToPage("inbox");
    const kept = registry.get(keptPageKeysAtom);

    navigation.navigateToPage("agents");
    expect(registry.get(desktopKeptPageAtom)).toBeNull();
    expect(registry.get(keptPageKeysAtom)).toEqual(kept);
  });

  it("drops every kept page when the organization changes", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);

    navigation.resetNavigation("issues");
    navigation.navigateToPage("inbox");
    // The DM page the window opened on, the board and the inbox.
    expect(registry.get(keptPageKeysAtom)).toHaveLength(3);

    registry.set(activeOrganizationIdAtom, otherOrganization.id);
    expect(registry.get(keptPageKeysAtom)).toEqual([
      `inbox:${otherOrganization.id}`,
    ]);
  });

  it("drops every kept page when the account signs out", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);

    navigation.resetNavigation("issues");
    navigation.navigateToPage("channels");
    // The DM page the window opened on, the board and the channels.
    expect(registry.get(keptPageKeysAtom)).toHaveLength(3);

    registry.set(userAtom, null);
    registry.set(tokenAtom, null);
    registry.set(activeOrganizationIdAtom, null);
    // Nothing an unauthenticated window drew belongs to the next account.
    expect(registry.get(keptPageKeysAtom)).toEqual([`board:${team.id}`]);
  });
});

describe("pageVisibleAtom", () => {
  it("is true for the page on screen and false for the ones behind it", () => {
    const registry = harness();
    const navigation = createNavigationActions(registry);

    navigation.resetNavigation("issues");
    const boardKey = keptPageKey({ kind: "board", scopeId: team.id });
    const inboxKey = keptPageKey({
      kind: "inbox",
      scopeId: demoOrganization.id,
    });
    expect(registry.get(pageVisibleAtom(boardKey))).toBe(true);
    expect(registry.get(pageVisibleAtom(inboxKey))).toBe(false);

    navigation.navigateToPage("inbox");
    expect(registry.get(pageVisibleAtom(boardKey))).toBe(false);
    expect(registry.get(pageVisibleAtom(inboxKey))).toBe(true);

    // A page that unmounts on leave leaves every kept page hidden.
    navigation.navigateToPage("agents");
    expect(registry.get(pageVisibleAtom(boardKey))).toBe(false);
    expect(registry.get(pageVisibleAtom(inboxKey))).toBe(false);
  });
});
