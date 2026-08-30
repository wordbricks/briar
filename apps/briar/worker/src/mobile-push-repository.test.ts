import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acknowledgeMobilePushOutbox,
  deleteMobilePushRegistration,
  listMobilePushOutbox,
  listMobilePushRegistrations,
  upsertMobilePushRegistration,
} from "./mobile-push-repository";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";

describe("mobile push repository", () => {
  let miniflare: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "mobile-push-repository",
    });
    miniflare = database.miniflare;
    db = database.db;
    const now = "2026-08-30T10:00:00.000Z";
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values
        ('owner', 'Owner', 'owner@example.com', 1, '${now}', '${now}'),
        ('member', 'Member', 'member@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('push-org', 'Push', 'push', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values
        ('push-org', 'owner', 'owner', '${now}', '${now}'),
        ('push-org', 'member', 'viewer', '${now}', '${now}');
      insert into briar_organization_inbox_sync_state (
        organization_id, current_version
      ) values ('push-org', 7);
    `);
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("keeps a stable baseline across preference updates and token transfer", async () => {
    const token = "a".repeat(64);
    const registeredAt = "2026-08-30T10:01:00.000Z";
    const initial = await upsertMobilePushRegistration(db, "owner", {
      platform: "apns",
      token,
      environment: "development",
      topic: "app.briar.companion",
      locale: "ko",
      preferences: {
        playSound: true,
        urgent: true,
        actionRequired: true,
        important: true,
        activity: false,
      },
    }, registeredAt);

    await upsertMobilePushRegistration(db, "owner", {
      platform: "apns",
      token,
      environment: "production",
      topic: "app.briar.companion",
      locale: "en",
      preferences: {
        playSound: false,
        urgent: false,
        actionRequired: true,
        important: false,
        activity: true,
      },
    }, "2026-08-30T10:02:00.000Z");

    const updated = await listMobilePushRegistrations(db, "push-org");
    expect(updated).toEqual([
      expect.objectContaining({
        id: initial.id,
        user_id: "owner",
        environment: "production",
        locale: "en",
        play_sound: 0,
        notify_activity: 1,
        registered_at: registeredAt,
        baseline_version: 7,
      }),
    ]);

    const transferred = await upsertMobilePushRegistration(db, "member", {
      platform: "apns",
      token,
      environment: "production",
      topic: "app.briar.companion",
      locale: "ko",
      preferences: {
        playSound: true,
        urgent: true,
        actionRequired: true,
        important: true,
        activity: true,
      },
    }, "2026-08-30T10:03:00.000Z");
    expect(transferred.id).not.toBe(initial.id);
    await expect(listMobilePushRegistrations(db, "push-org")).resolves.toEqual([
      expect.objectContaining({
        id: transferred.id,
        user_id: "member",
        baseline_version: 7,
      }),
    ]);

    await expect(
      deleteMobilePushRegistration(db, "owner", "apns", token),
    ).resolves.toBe(false);
    await expect(
      deleteMobilePushRegistration(db, "member", "apns", token),
    ).resolves.toBe(true);
  });

  it("coalesces sync revisions in the independent push outbox", async () => {
    await executeD1Sql(
      db,
      `update briar_organization_inbox_sync_state
       set current_version = 9 where organization_id = 'push-org';`,
    );
    await expect(listMobilePushOutbox(db)).resolves.toEqual([
      { organization_id: "push-org", version: 9 },
    ]);
    await acknowledgeMobilePushOutbox(db, "push-org", 8);
    await expect(listMobilePushOutbox(db)).resolves.toHaveLength(1);
    await acknowledgeMobilePushOutbox(db, "push-org", 9);
    await expect(listMobilePushOutbox(db)).resolves.toEqual([]);
  });
});
