/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  commandPaletteRecentsStorageKey,
  groupCommandPaletteItems,
  loadCommandPaletteRecents,
  normalizeCommandPaletteText,
  parseCommandPaletteQuery,
  rememberCommandPaletteItem,
  type CommandPaletteSearchItem,
} from "./command-palette";

const items: CommandPaletteSearchItem[] = [
  {
    id: "action:create-issue",
    keywords: ["new task", "새 이슈"],
    label: "Create issue",
    priority: 20,
    scope: "actions",
    section: "actions",
    sectionLabel: "Actions",
  },
  {
    description: "Project",
    id: "issue:123",
    keywords: ["BRI-123"],
    label: "Mélanie onboarding",
    scope: "issues",
    section: "issues",
    sectionLabel: "Issues",
  },
  {
    id: "project:briar",
    label: "Briar",
    scope: "projects",
    section: "projects",
    sectionLabel: "Projects",
  },
];

describe("command palette search", () => {
  beforeEach(() => window.localStorage.clear());

  it("normalizes case and diacritics", () => {
    expect(normalizeCommandPaletteText("  MÉLANIE  ")).toBe("melanie");
    expect(groupCommandPaletteItems(items, "melanie")[0]?.items[0]?.id).toBe(
      "issue:123",
    );
  });

  it("matches reordered words, keywords, and subsequences", () => {
    expect(
      groupCommandPaletteItems(items, "issue create")[0]?.items[0]?.id,
    ).toBe("action:create-issue");
    expect(groupCommandPaletteItems(items, "새 이슈")[0]?.items[0]?.id).toBe(
      "action:create-issue",
    );
    expect(groupCommandPaletteItems(items, "mln onb")[0]?.items[0]?.id).toBe(
      "issue:123",
    );
  });

  it("ranks exact labels before weaker matches and retains section order when empty", () => {
    const exactProject: CommandPaletteSearchItem = {
      id: "project:create-issue",
      label: "Create issue",
      scope: "projects",
      section: "projects",
      sectionLabel: "Projects",
    };
    const exactGroups = groupCommandPaletteItems([...items, exactProject], "create issue");
    expect(exactGroups[0]?.items[0]?.id).toBe("action:create-issue");
    expect(groupCommandPaletteItems(items, "").map(({ section }) => section)).toEqual([
      "actions",
      "issues",
      "projects",
    ]);
  });

  it("supports entity scope prefixes", () => {
    expect(parseCommandPaletteQuery("i: bri")).toEqual({
      query: "bri",
      scope: "issues",
    });
    expect(parseCommandPaletteQuery("p ")).toEqual({
      query: "",
      scope: "projects",
    });
    expect(groupCommandPaletteItems(items, "p bri")).toHaveLength(1);
    expect(groupCommandPaletteItems(items, "p bri")[0]?.items[0]?.id).toBe(
      "project:briar",
    );
  });

  it("persists unique recent selections in newest-first order", () => {
    rememberCommandPaletteItem("project:briar");
    rememberCommandPaletteItem("issue:123");
    rememberCommandPaletteItem("project:briar");
    expect(loadCommandPaletteRecents()).toEqual([
      "project:briar",
      "issue:123",
    ]);

    window.localStorage.setItem(commandPaletteRecentsStorageKey, "not-json");
    expect(loadCommandPaletteRecents()).toEqual([]);
  });
});
