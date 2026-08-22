import { describe, expect, it, vi } from "vitest";
import type { Organization, SessionUser } from "../types";
import {
  ensureDefaultOrganization,
} from "./default-organization";

const user: SessionUser = {
  id: "9a5bda98-8785-4fd7-a3cb-54be7b0a1aa4",
  name: "Briar User",
  email: "user@example.com",
};

const organization: Organization = {
  id: "45fb7ba7-8a41-4c5c-b5c8-97ce72cdcf6f",
  name: "Briar User",
  handle: "organization-9a5bda98-8785-4fd7-a3cb-54be7b0a1aa4",
  logo: null,
  role: "owner",
  createdAt: "2026-07-29T00:00:00.000Z",
};

function createDependencies() {
  return {
    createOrganization: vi.fn(async () => ({ organization })),
    loadOrganizations: vi.fn(async () => [] as Organization[]),
  };
}

describe("default organization", () => {
  it("keeps an existing organization without creating another one", async () => {
    const dependencies = createDependencies();

    await expect(
      ensureDefaultOrganization(
        "token",
        user,
        [organization],
        dependencies,
      ),
    ).resolves.toEqual([organization]);
    expect(dependencies.createOrganization).not.toHaveBeenCalled();
    expect(dependencies.loadOrganizations).not.toHaveBeenCalled();
  });

  it("creates a default organization before first-project onboarding", async () => {
    const dependencies = createDependencies();

    await expect(
      ensureDefaultOrganization("token", user, [], dependencies),
    ).resolves.toEqual([organization]);
    expect(dependencies.createOrganization).toHaveBeenCalledWith(
      "token",
      {
        name: "Briar User",
        handle: "organization-9a5bda98-8785-4fd7-a3cb-54be7b0a1aa4",
      },
    );
  });

  it("reloads the organization created by another signed-in client", async () => {
    const dependencies = createDependencies();
    dependencies.createOrganization.mockRejectedValue(
      new Error("Organization handle already exists"),
    );
    dependencies.loadOrganizations.mockResolvedValue([organization]);

    await expect(
      ensureDefaultOrganization("token", user, [], dependencies),
    ).resolves.toEqual([organization]);
  });
});
