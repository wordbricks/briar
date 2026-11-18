import { describe, expect, it } from "vitest";

import type { Workspace } from "../../types";
import { createTestRegistry } from "../registry";
import {
  activeWorkspaceAtom,
  activeWorkspaceIdAtom,
  workspacesAtom,
} from "./atoms";

const organizationA: Workspace = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const organizationB: Workspace = {
  ...organizationA,
  id: "org-b",
  name: "Org B",
  handle: "org-b",
};

describe("workspace atoms", () => {
  it("starts with no workspaces and nothing selected", () => {
    const registry = createTestRegistry();

    expect(registry.get(workspacesAtom)).toEqual([]);
    expect(registry.get(activeWorkspaceIdAtom)).toBeNull();
    expect(registry.get(activeWorkspaceAtom)).toBeNull();
  });

  it("resolves the active workspace from the list", () => {
    const registry = createTestRegistry();
    registry.set(workspacesAtom, [organizationA, organizationB]);

    expect(registry.get(activeWorkspaceAtom)).toBeNull();

    registry.set(activeWorkspaceIdAtom, organizationB.id);
    // The derived value is the list element itself, not a copy, so identity
    // comparisons in views keep working.
    expect(registry.get(activeWorkspaceAtom)).toBe(organizationB);
  });

  it("resolves to null when the selected workspace is gone", () => {
    const registry = createTestRegistry([
      [workspacesAtom, [organizationA]],
      [activeWorkspaceIdAtom, organizationA.id],
    ]);
    expect(registry.get(activeWorkspaceAtom)).toBe(organizationA);

    registry.set(workspacesAtom, [organizationB]);
    expect(registry.get(activeWorkspaceAtom)).toBeNull();
  });

  it("announces the active workspace only when it actually changes", () => {
    const registry = createTestRegistry([
      [workspacesAtom, [organizationA, organizationB]],
      [activeWorkspaceIdAtom, organizationA.id],
    ]);
    const seen: (Workspace | null)[] = [];
    // `immediate` also builds the dependency on `workspacesAtom`; a derived
    // atom nobody has read yet has no dependencies to invalidate.
    registry.subscribe(
      activeWorkspaceAtom,
      (value) => {
        seen.push(value);
      },
      { immediate: true },
    );
    expect(seen).toEqual([organizationA]);
    seen.length = 0;

    // Editing a different workspace leaves the selected one untouched.
    registry.set(workspacesAtom, [
      organizationA,
      { ...organizationB, name: "Org B renamed" },
    ]);
    expect(seen).toEqual([]);

    const renamedA = { ...organizationA, name: "Org A renamed" };
    registry.set(workspacesAtom, [renamedA, organizationB]);
    registry.set(activeWorkspaceIdAtom, organizationB.id);

    expect(seen).toEqual([renamedA, organizationB]);
  });
});
