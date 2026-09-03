import { describe, expect, it } from "vitest";

import type { Organization } from "../../types";
import { createTestRegistry } from "../registry";
import {
  activeOrganizationAtom,
  activeOrganizationIdAtom,
  organizationsAtom,
} from "./atoms";

const organizationA: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const organizationB: Organization = {
  ...organizationA,
  id: "org-b",
  name: "Org B",
  handle: "org-b",
};

describe("organization atoms", () => {
  it("starts with no organizations and nothing selected", () => {
    const registry = createTestRegistry();

    expect(registry.get(organizationsAtom)).toEqual([]);
    expect(registry.get(activeOrganizationIdAtom)).toBeNull();
    expect(registry.get(activeOrganizationAtom)).toBeNull();
  });

  it("resolves the active organization from the list", () => {
    const registry = createTestRegistry();
    registry.set(organizationsAtom, [organizationA, organizationB]);

    expect(registry.get(activeOrganizationAtom)).toBeNull();

    registry.set(activeOrganizationIdAtom, organizationB.id);
    // The derived value is the list element itself, not a copy, so identity
    // comparisons in views keep working.
    expect(registry.get(activeOrganizationAtom)).toBe(organizationB);
  });

  it("resolves to null when the selected organization is gone", () => {
    const registry = createTestRegistry([
      [organizationsAtom, [organizationA]],
      [activeOrganizationIdAtom, organizationA.id],
    ]);
    expect(registry.get(activeOrganizationAtom)).toBe(organizationA);

    registry.set(organizationsAtom, [organizationB]);
    expect(registry.get(activeOrganizationAtom)).toBeNull();
  });

  it("announces the active organization only when it actually changes", () => {
    const registry = createTestRegistry([
      [organizationsAtom, [organizationA, organizationB]],
      [activeOrganizationIdAtom, organizationA.id],
    ]);
    const seen: (Organization | null)[] = [];
    // `immediate` also builds the dependency on `organizationsAtom`; a derived
    // atom nobody has read yet has no dependencies to invalidate.
    registry.subscribe(
      activeOrganizationAtom,
      (value) => {
        seen.push(value);
      },
      { immediate: true },
    );
    expect(seen).toEqual([organizationA]);
    seen.length = 0;

    // Editing a different organization leaves the selected one untouched.
    registry.set(organizationsAtom, [
      organizationA,
      { ...organizationB, name: "Org B renamed" },
    ]);
    expect(seen).toEqual([]);

    const renamedA = { ...organizationA, name: "Org A renamed" };
    registry.set(organizationsAtom, [renamedA, organizationB]);
    registry.set(activeOrganizationIdAtom, organizationB.id);

    expect(seen).toEqual([renamedA, organizationB]);
  });
});
