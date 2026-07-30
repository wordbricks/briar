import { describe, expect, it } from "vitest";

import { settingsAccountSelection } from "./settings-account-selection";

describe("settingsAccountSelection", () => {
  it("does not reselect the account when navigating within its settings", () => {
    expect(
      settingsAccountSelection(
        { scope: "organization", organizationId: "organization-1" },
        "organization-1",
        "project-1",
      ),
    ).toBeNull();
    expect(
      settingsAccountSelection(
        { scope: "project", projectId: "project-1" },
        "organization-1",
        "project-1",
      ),
    ).toBeNull();
  });

  it("selects a different organization or project", () => {
    expect(
      settingsAccountSelection(
        { scope: "organization", organizationId: "organization-2" },
        "organization-1",
        "project-1",
      ),
    ).toEqual({
      scope: "organization",
      organizationId: "organization-2",
    });
    expect(
      settingsAccountSelection(
        { scope: "project", projectId: "project-2" },
        "organization-1",
        "project-1",
      ),
    ).toEqual({ scope: "project", projectId: "project-2" });
  });

  it("does not change account selection for application settings", () => {
    expect(
      settingsAccountSelection(
        { scope: "application" },
        "organization-1",
        "project-1",
      ),
    ).toBeNull();
  });
});
