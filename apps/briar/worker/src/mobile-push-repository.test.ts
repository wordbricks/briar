import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  acknowledgeMobilePushOutbox,
  listMobilePushOutbox,
} from "./mobile-push-repository";
import { executeD1Sql } from "./test-helpers/d1-sql";

describe("mobile push repository", () => {
  const db = env.DB;

  beforeAll(async () => {
    const now = "2026-08-30T10:00:00.000Z";
    await executeD1Sql(db, `
      delete from briar_mobile_push_outbox;
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

  // Migration 0184 folded the push-outbox mirror into every trigger that bumps
  // briar_organization_inbox_sync_state, so the outbox row is written by the
  // inbox writer itself rather than by a trigger on the sync-state table. This
  // drives one of those writers (briar_inbox_projects_insert_sync) and then
  // coalesces on top of the row it produced.
  it("coalesces sync revisions in the independent push outbox", async () => {
    const now = "2026-08-30T10:00:00.000Z";
    await executeD1Sql(
      db,
      `insert into briar_projects (
         id, owner_user_id, name, agent_token_hash, organization_id,
         created_at, updated_at
       ) values (
         'push-project', 'owner', 'Push', '${"a".repeat(64)}', 'push-org',
         '${now}', '${now}'
       );`,
    );
    await expect(listMobilePushOutbox(db)).resolves.toEqual([
      { organization_id: "push-org", version: 8 },
    ]);
    await executeD1Sql(
      db,
      `insert into briar_organization_inbox_sync_state (
         organization_id, current_version
       ) values ('push-org', 9)
       on conflict (organization_id) do update set current_version = 9;
       insert into briar_mobile_push_outbox (organization_id, version, updated_at)
       values ('push-org', 9, '${now}')
       on conflict (organization_id) do update set
         version = max(briar_mobile_push_outbox.version, excluded.version),
         updated_at = excluded.updated_at;`,
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
