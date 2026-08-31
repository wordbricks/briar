import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { listDashboardChanges } from "./dashboard-change-repository";

describe("dashboard change repository", () => {
  const db = env.DB;

  it("expires a cursor outside the available version window", async () => {
    await expect(
      listDashboardChanges(db, "unknown-project", -1),
    ).resolves.toEqual({
      currentVersion: 0,
      oldestVersion: null,
      changes: [],
      hasMore: false,
      nextCursor: 0,
      expired: true,
    });
  });
});
