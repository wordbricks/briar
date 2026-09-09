import { describe, expect, it } from "vitest";
import {
  isValidWorkspaceHandle,
  organizationHandleFromName,
} from "./workspace-handle";

describe("workspace handles", () => {
  it("generates a lowercase, dash-separated handle from a name", () => {
    expect(organizationHandleFromName("My Workspace 2026")).toBe(
      "my-workspace-2026",
    );
    expect(organizationHandleFromName("Café Studio")).toBe("cafe-studio");
  });

  it("removes characters that are not lowercase English, digits, or dashes", () => {
    expect(organizationHandleFromName("브라이어 Team!")).toBe("team");
    expect(isValidWorkspaceHandle("briar-team-2")).toBe(true);
    expect(isValidWorkspaceHandle("Briar_Team")).toBe(false);
    expect(isValidWorkspaceHandle("브라이어")).toBe(false);
  });
});
