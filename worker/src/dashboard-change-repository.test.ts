import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDashboardChanges } from "./dashboard-change-repository";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

describe("dashboard change repository", () => {
  let miniflare: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "dashboard-change-repository",
    });
    miniflare = database.miniflare;
    db = database.db;
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

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
