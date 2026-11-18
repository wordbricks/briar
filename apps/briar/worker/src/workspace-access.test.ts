import { describe, expect, it } from "vitest";
import {
  hasWorkspaceCapability,
  type WorkspaceCapability,
} from "./workspace-access";
import type { WorkspaceRole } from "./workspace-repository";

const allCapabilities: WorkspaceCapability[] = [
  "workspace:read",
  "workspace:update",
  "workspace:delete",
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
    (capability) => capability !== "workspace:delete",
  ),
  developer: [
    "workspace:read",
    "development:manage",
    "conversations:write",
    "issues:write",
    "issues:execute",
    "results:review",
  ],
  editor: [
    "workspace:read",
    "conversations:write",
    "issues:write",
    "results:review",
  ],
  viewer: ["workspace:read"],
} satisfies Record<WorkspaceRole, readonly WorkspaceCapability[]>;

describe("workspace capability authorization", () => {
  for (const [role, allowed] of Object.entries(expectedCapabilities) as Array<
    [WorkspaceRole, readonly WorkspaceCapability[]]
  >) {
    it(`allows exactly the declared ${role} capabilities`, () => {
      for (const capability of allCapabilities) {
        expect(hasWorkspaceCapability(role, capability)).toBe(
          allowed.includes(capability),
        );
      }
    });
  }

  it("grants no capability without workspace membership", () => {
    for (const capability of allCapabilities) {
      expect(hasWorkspaceCapability(null, capability)).toBe(false);
    }
  });
});
