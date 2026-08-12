/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  kanbanCollapsedColumnsStorageKey,
  readKanbanCollapsedColumnIds,
  toggleKanbanCollapsedColumnId,
  writeKanbanCollapsedColumnIds,
} from "./kanban-column-collapse";

describe("kanban-column-collapse", () => {
  it("scopes storage keys by user and project", () => {
    expect(
      kanbanCollapsedColumnsStorageKey("user/1", "project:2"),
    ).toBe(
      "briar.settings.kanbanColumnCollapse.v1:user%2F1:project%3A2",
    );
  });

  it("returns empty when user or project is missing", () => {
    window.localStorage.clear();
    expect(readKanbanCollapsedColumnIds(null, "project-1")).toEqual([]);
    expect(readKanbanCollapsedColumnIds("user-1", null)).toEqual([]);
  });

  it("saves and restores collapsed column ids per user and project", () => {
    window.localStorage.clear();
    writeKanbanCollapsedColumnIds("user-a", "project-1", [
      "stage:reviewing",
      "stage:analyzing",
      "stage:analyzing",
      "  ",
    ]);
    writeKanbanCollapsedColumnIds("user-b", "project-1", ["stage:ci_qa"]);

    expect(readKanbanCollapsedColumnIds("user-a", "project-1")).toEqual([
      "stage:analyzing",
      "stage:reviewing",
    ]);
    expect(readKanbanCollapsedColumnIds("user-b", "project-1")).toEqual([
      "stage:ci_qa",
    ]);
    expect(readKanbanCollapsedColumnIds("user-a", "project-2")).toEqual([]);
  });

  it("removes storage when no columns remain collapsed", () => {
    window.localStorage.clear();
    writeKanbanCollapsedColumnIds("user-a", "project-1", ["stage:analyzing"]);
    writeKanbanCollapsedColumnIds("user-a", "project-1", []);
    expect(
      window.localStorage.getItem(
        kanbanCollapsedColumnsStorageKey("user-a", "project-1"),
      ),
    ).toBeNull();
    expect(readKanbanCollapsedColumnIds("user-a", "project-1")).toEqual([]);
  });

  it("ignores corrupt storage values", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      kanbanCollapsedColumnsStorageKey("user-a", "project-1"),
      "{not-json",
    );
    expect(readKanbanCollapsedColumnIds("user-a", "project-1")).toEqual([]);

    window.localStorage.setItem(
      kanbanCollapsedColumnsStorageKey("user-a", "project-1"),
      JSON.stringify(["stage:ok", 12, null, ""]),
    );
    expect(readKanbanCollapsedColumnIds("user-a", "project-1")).toEqual([
      "stage:ok",
    ]);
  });

  it("toggles column membership", () => {
    expect(toggleKanbanCollapsedColumnId([], "stage:analyzing")).toEqual([
      "stage:analyzing",
    ]);
    expect(
      toggleKanbanCollapsedColumnId(
        ["stage:analyzing", "stage:reviewing"],
        "stage:analyzing",
      ),
    ).toEqual(["stage:reviewing"]);
  });
});
