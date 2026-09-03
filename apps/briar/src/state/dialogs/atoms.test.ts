import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import { createTestRegistry } from "../registry";
import {
  activePlanningProjectIdAtom,
  commandPaletteInitialQueryAtom,
  completedDispatchRunIdAtom,
  createIssueTeamIdAtom,
  dispatchRunAtom,
  isCommandPaletteOpenAtom,
  isIssueDialogOpenAtom,
  isKeyboardShortcutsOpenAtom,
  isNavigationHistoryOpenAtom,
  isSidebarOpenAtom,
  planningProjectEditIdAtom,
  planningProjectTeamIdAtom,
  quickProcessErrorAtom,
  quickStartingRunIdAtom,
  repositorySetupTeamIdAtom,
} from "./atoms";

/*
  These are plain overlay flags, so what is worth pinning is the two things a
  reader depends on: what they start as, and that they are genuinely separate —
  which is the whole point of splitting them out of one shell `useState` block.
*/

describe("dialog atoms", () => {
  it("starts closed, with the sidebar the exception", () => {
    const registry = createTestRegistry();
    expect(registry.get(isSidebarOpenAtom)).toBe(true);
    expect(registry.get(isCommandPaletteOpenAtom)).toBe(false);
    expect(registry.get(isNavigationHistoryOpenAtom)).toBe(false);
    expect(registry.get(isKeyboardShortcutsOpenAtom)).toBe(false);
    expect(registry.get(isIssueDialogOpenAtom)).toBe(false);
    expect(registry.get(commandPaletteInitialQueryAtom)).toBe("");
    expect(registry.get(createIssueTeamIdAtom)).toBeNull();
    expect(registry.get(planningProjectTeamIdAtom)).toBeNull();
    expect(registry.get(planningProjectEditIdAtom)).toBeNull();
    expect(registry.get(activePlanningProjectIdAtom)).toBeNull();
    expect(registry.get(repositorySetupTeamIdAtom)).toBeNull();
    expect(registry.get(dispatchRunAtom)).toBeNull();
    expect(registry.get(quickStartingRunIdAtom)).toBeNull();
    expect(registry.get(completedDispatchRunIdAtom)).toBeNull();
    expect(registry.get(quickProcessErrorAtom)).toBeNull();
  });

  it("notifies only the subscribers of the flag that moved", () => {
    const registry = createTestRegistry();
    const sidebar: boolean[] = [];
    const palette: boolean[] = [];
    const unsubscribeSidebar = registry.subscribe(isSidebarOpenAtom, (value) =>
      sidebar.push(value),
    );
    const unsubscribePalette = registry.subscribe(
      isCommandPaletteOpenAtom,
      (value) => palette.push(value),
    );

    registry.set(isCommandPaletteOpenAtom, true);
    unsubscribeSidebar();
    unsubscribePalette();

    expect(sidebar).toEqual([]);
    expect(palette).toEqual([true]);
  });

  it("carries the dispatch flow's four values independently", () => {
    const registry = createTestRegistry();
    const run = demoDashboard.runs[0]!;

    registry.set(dispatchRunAtom, run);
    registry.set(quickStartingRunIdAtom, run.id);
    expect(registry.get(completedDispatchRunIdAtom)).toBeNull();

    // Success outlives the request: the dialog shows the confirmation while
    // nothing is in flight any more.
    registry.set(quickStartingRunIdAtom, null);
    registry.set(completedDispatchRunIdAtom, run.id);
    expect(registry.get(dispatchRunAtom)).toBe(run);
    expect(registry.get(quickProcessErrorAtom)).toBeNull();
  });
});
