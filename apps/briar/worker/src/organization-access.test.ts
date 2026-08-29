import { describe, expect, it } from "vitest";
import {
  hasOrganizationCapability,
  type OrganizationCapability,
} from "./organization-access";
import type { OrganizationRole } from "./organization-repository";

const allCapabilities: OrganizationCapability[] = [
  "organization:read",
  "organization:update",
  "organization:delete",
  "members:manage",
  "invitations:manage",
  "projects:manage",
  "development:manage",
  "conversations:write",
  "issues:write",
  "issues:execute",
  "results:review",
];

const expectedCapabilities = {
  owner: allCapabilities,
  "co-owner": allCapabilities.filter(
    (capability) => capability !== "organization:delete",
  ),
  developer: [
    "organization:read",
    "development:manage",
    "conversations:write",
    "issues:write",
    "issues:execute",
    "results:review",
  ],
  editor: [
    "organization:read",
    "conversations:write",
    "issues:write",
    "results:review",
  ],
  viewer: ["organization:read"],
} satisfies Record<OrganizationRole, readonly OrganizationCapability[]>;

describe("organization capability authorization", () => {
  for (const [role, allowed] of Object.entries(expectedCapabilities) as Array<
    [OrganizationRole, readonly OrganizationCapability[]]
  >) {
    it(`allows exactly the declared ${role} capabilities`, () => {
      for (const capability of allCapabilities) {
        expect(hasOrganizationCapability(role, capability)).toBe(
          allowed.includes(capability),
        );
      }
    });
  }

  it("grants no capability without organization membership", () => {
    for (const capability of allCapabilities) {
      expect(hasOrganizationCapability(null, capability)).toBe(false);
    }
  });
});
