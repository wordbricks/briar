/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  kanbanHiddenColumnsStorageKey,
  readKanbanHiddenColumnIds,
  toggleKanbanHiddenColumnId,
  writeKanbanHiddenColumnIds,
} from "./kanban-column-hide";

describe("kanban-column-hide", () => {
  it("scopes storage keys by user and project", () => {
    expect(
      kanbanHiddenColumnsStorageKey("user/1", "project:2"),
    ).toBe(
      "briar.settings.kanbanColumnHide.v1:user%2F1:project%3A2",
    );
  });

  it("returns empty when user or project is missing", () => {
    window.localStorage.clear();
    expect(readKanbanHiddenColumnIds(null, "project-1")).toEqual([]);
    expect(readKanbanHiddenColumnIds("user-1", null)).toEqual([]);
  });

  it("saves and restores hidden column ids per user and project", () => {
    window.localStorage.clear();
    writeKanbanHiddenColumnIds("user-a", "project-1", [
      "stage:reviewing",
      "stage:analyzing",
      "stage:analyzing",
      "  ",
    ]);
    writeKanbanHiddenColumnIds("user-b", "project-1", ["stage:ci_qa"]);

    expect(readKanbanHiddenColumnIds("user-a", "project-1")).toEqual([
      "stage:analyzing",
      "stage:reviewing",
    ]);
    expect(readKanbanHiddenColumnIds("user-b", "project-1")).toEqual([
      "stage:ci_qa",
    ]);
    expect(readKanbanHiddenColumnIds("user-a", "project-2")).toEqual([]);
  });

  it("removes storage when no columns remain hidden", () => {
    window.localStorage.clear();
    writeKanbanHiddenColumnIds("user-a", "project-1", ["stage:analyzing"]);
    writeKanbanHiddenColumnIds("user-a", "project-1", []);
    expect(
      window.localStorage.getItem(
        kanbanHiddenColumnsStorageKey("user-a", "project-1"),
      ),
    ).toBeNull();
    expect(readKanbanHiddenColumnIds("user-a", "project-1")).toEqual([]);
  });

  it("ignores corrupt storage values", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      kanbanHiddenColumnsStorageKey("user-a", "project-1"),
      "{not-json",
    );
    expect(readKanbanHiddenColumnIds("user-a", "project-1")).toEqual([]);

    window.localStorage.setItem(
      kanbanHiddenColumnsStorageKey("user-a", "project-1"),
      JSON.stringify(["stage:ok", 12, null, ""]),
    );
    expect(readKanbanHiddenColumnIds("user-a", "project-1")).toEqual([
      "stage:ok",
    ]);
  });

  it("toggles column membership", () => {
    expect(toggleKanbanHiddenColumnId([], "stage:analyzing")).toEqual([
      "stage:analyzing",
    ]);
    expect(
      toggleKanbanHiddenColumnId(
        ["stage:analyzing", "stage:reviewing"],
        "stage:analyzing",
      ),
    ).toEqual(["stage:reviewing"]);
  });
});
