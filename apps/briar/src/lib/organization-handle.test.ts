import { describe, expect, it } from "vitest";
import {
  isValidOrganizationHandle,
  organizationHandleFromName,
} from "./organization-handle";

describe("organization handles", () => {
  it("generates a lowercase, dash-separated handle from a name", () => {
    expect(organizationHandleFromName("My Organization 2026")).toBe(
      "my-organization-2026",
    );
    expect(organizationHandleFromName("Café Studio")).toBe("cafe-studio");
  });

  it("removes characters that are not lowercase English, digits, or dashes", () => {
    expect(organizationHandleFromName("브라이어 Team!")).toBe("team");
    expect(isValidOrganizationHandle("briar-team-2")).toBe(true);
    expect(isValidOrganizationHandle("Briar_Team")).toBe(false);
    expect(isValidOrganizationHandle("브라이어")).toBe(false);
  });
});
