/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  kanbanColumnPreferenceStorageKey,
  readKanbanColumnIds,
  toggleKanbanColumnId,
  writeKanbanColumnIds,
} from "./kanban-column-storage";

function createStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  return storage;
}

function installStorage(storage: Storage) {
  vi.stubGlobal("window", { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kanban column storage", () => {
  it("keeps the existing encoded keys and separates hide from collapse", () => {
    const userId = "user name/한";
    const projectId = "project:id?";

    expect(kanbanColumnPreferenceStorageKey("hide", userId, projectId)).toBe(
      `briar.settings.kanbanColumnHide.v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`,
    );
    expect(
      kanbanColumnPreferenceStorageKey("collapse", userId, projectId),
    ).toBe(
      `briar.settings.kanbanColumnCollapse.v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`,
    );
  });

  it("restores normalized values without mixing users, projects, or preferences", () => {
    const storage = createStorage();
    installStorage(storage);
    storage.setItem(
      kanbanColumnPreferenceStorageKey("hide", "user-1", "project-1"),
      JSON.stringify([" stage:z ", "stage:a", "stage:a", "", 3]),
    );
    storage.setItem(
      kanbanColumnPreferenceStorageKey("collapse", "user-1", "project-1"),
      JSON.stringify(["status:queued"]),
    );

    expect(readKanbanColumnIds("hide", "user-1", "project-1")).toEqual([
      "stage:a",
      "stage:z",
    ]);
    expect(readKanbanColumnIds("collapse", "user-1", "project-1")).toEqual([
      "status:queued",
    ]);
    expect(readKanbanColumnIds("hide", "user-2", "project-1")).toEqual([]);
    expect(readKanbanColumnIds("hide", "user-1", "project-2")).toEqual([]);
  });

  it("writes normalized sorted values and removes an empty preference", () => {
    const storage = createStorage();
    installStorage(storage);
    const key = kanbanColumnPreferenceStorageKey(
      "collapse",
      "user-1",
      "project-1",
    );

    writeKanbanColumnIds("collapse", "user-1", "project-1", [
      " stage:z ",
      "stage:a",
      "stage:a",
      "",
    ]);
    expect(JSON.parse(storage.getItem(key)!)).toEqual(["stage:a", "stage:z"]);

    writeKanbanColumnIds("collapse", "user-1", "project-1", [" "]);
    expect(storage.getItem(key)).toBeNull();
  });

  it("toggles against normalized input and keeps the result sorted", () => {
    const added = toggleKanbanColumnId(
      [" stage:z ", "stage:a", "stage:a", ""],
      "stage:m",
    );
    expect(added).toEqual(["stage:a", "stage:m", "stage:z"]);
    expect(toggleKanbanColumnId(added, "stage:a")).toEqual([
      "stage:m",
      "stage:z",
    ]);
  });

  it("falls back safely for malformed JSON", () => {
    const storage = createStorage();
    installStorage(storage);
    storage.setItem(
      kanbanColumnPreferenceStorageKey("hide", "user-1", "project-1"),
      "not-json",
    );

    expect(readKanbanColumnIds("hide", "user-1", "project-1")).toEqual([]);
  });

  it("does nothing without a browser or a complete identity", () => {
    expect(readKanbanColumnIds("hide", "user-1", "project-1")).toEqual([]);
    expect(() =>
      writeKanbanColumnIds("hide", "user-1", "project-1", ["stage:a"]),
    ).not.toThrow();

    const setItem = vi.fn();
    installStorage({
      ...createStorage(),
      setItem,
    });
    expect(readKanbanColumnIds("hide", "", "project-1")).toEqual([]);
    expect(readKanbanColumnIds("hide", "user-1", null)).toEqual([]);
    writeKanbanColumnIds("hide", undefined, "project-1", ["stage:a"]);
    writeKanbanColumnIds("hide", "user-1", "", ["stage:a"]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("keeps the in-session toggle result when localStorage is unavailable", () => {
    const unavailableWindow = {};
    Object.defineProperty(unavailableWindow, "localStorage", {
      get() {
        throw new Error("storage unavailable");
      },
    });
    vi.stubGlobal("window", unavailableWindow);

    const next = toggleKanbanColumnId([], "stage:analyzing");
    expect(next).toEqual(["stage:analyzing"]);
    expect(readKanbanColumnIds("hide", "user-1", "project-1")).toEqual([]);
    expect(() =>
      writeKanbanColumnIds("hide", "user-1", "project-1", next),
    ).not.toThrow();
    expect(next).toEqual(["stage:analyzing"]);
  });
});
