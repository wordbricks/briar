import { describe, expect, it } from "vitest";
import {
  isProjectConnectedLocally,
  withConnectedProject,
  withoutConnectedProject,
} from "./local-project-connection";

describe("local project connection", () => {
  it("treats an unknown local state as connected so the project list stays visible", () => {
    expect(isProjectConnectedLocally(null, "project-1")).toBe(true);
  });

  it("marks a project connected only when this device has it", () => {
    expect(isProjectConnectedLocally(["project-1"], "project-1")).toBe(true);
    expect(isProjectConnectedLocally(["project-1"], "project-2")).toBe(false);
  });

  it("reports every project as unconnected on a fresh device", () => {
    expect(isProjectConnectedLocally([], "project-1")).toBe(false);
  });

  it("ignores a missing active project", () => {
    expect(isProjectConnectedLocally([], null)).toBe(true);
  });

  it("adds and removes connections without duplicating entries", () => {
    expect(withConnectedProject([], "project-1")).toEqual(["project-1"]);
    expect(withConnectedProject(["project-1"], "project-1")).toEqual([
      "project-1",
    ]);
    expect(withoutConnectedProject(["project-1", "project-2"], "project-1"))
      .toEqual(["project-2"]);
  });

  it("keeps the unknown state unknown", () => {
    expect(withConnectedProject(null, "project-1")).toBeNull();
    expect(withoutConnectedProject(null, "project-1")).toBeNull();
  });
});
