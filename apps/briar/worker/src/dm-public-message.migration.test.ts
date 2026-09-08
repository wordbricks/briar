import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

describe("DM public message migration", () => {
  it("preserves legacy messages and installs extensible publication metadata", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: "0213_channel_text_attachments.sql" });
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('dm-public-owner', 'Owner', 'dm-public@example.com', 1,
              '2026-09-08', '2026-09-08');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('dm-public-org', 'DM Public', 'dm-public',
              '2026-09-08', '2026-09-08');
      insert into briar_channels (
        id, organization_id, kind, slug, name, visibility,
        created_by_user_id, created_at, updated_at
      ) values ('dm-public-channel', 'dm-public-org', 'dm', 'dm-public',
                'DM Public', 'private', 'dm-public-owner',
                '2026-09-08', '2026-09-08');
      insert into briar_channel_messages (
        id, channel_id, author_user_id, body, created_at, updated_at
      ) values ('dm-public-legacy', 'dm-public-channel', 'dm-public-owner',
                'Legacy', '2026-09-08', '2026-09-08');
    `);
    await applyD1Migrations(db, { files: ["0215_dm_public_messages.sql"] });
    expect(await db.prepare(
      `select id, dm_batch_id, dm_part_index, dm_sequence, dm_purpose
       from briar_channel_messages where id = 'dm-public-legacy'`,
    ).first()).toEqual({
      id: "dm-public-legacy",
      dm_batch_id: null,
      dm_part_index: null,
      dm_sequence: null,
      dm_purpose: null,
    });
    expect((await db.prepare(
      `select purpose from briar_dm_message_purposes order by purpose`,
    ).all()).results).toEqual([
      { purpose: "acknowledgement" },
      { purpose: "conversation" },
      { purpose: "discovery" },
      { purpose: "progress" },
      { purpose: "question" },
      { purpose: "result" },
    ]);
    await expect(db.prepare(
      `insert into briar_channel_messages (
         id, channel_id, author_user_id, body, created_at, updated_at,
         dm_part_index
       ) values ('dm-public-invalid', 'dm-public-channel', 'dm-public-owner',
                 'Invalid', '2026-09-08', '2026-09-08', 0)`,
    ).run()).rejects.toThrow("DM public message metadata must be complete");
    expect((await db.prepare("pragma foreign_key_check").all()).results)
      .toEqual([]);
  });
});
