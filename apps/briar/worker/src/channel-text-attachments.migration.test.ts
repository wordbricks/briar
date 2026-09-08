import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

describe("channel text attachment migration", () => {
  it("preserves legacy rows, indexes, upload triggers, and foreign keys", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: "0212_sandbox_runtime_updates.sql" });
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('text-owner', 'Owner', 'text@example.com', 1, '2026-09-08', '2026-09-08');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('text-org', 'Text', 'text-org', '2026-09-08', '2026-09-08');
      insert into briar_channels (id, organization_id, slug, name, visibility, created_by_user_id, created_at, updated_at)
      values ('text-channel', 'text-org', 'text', 'Text', 'private', 'text-owner', '2026-09-08', '2026-09-08');
      insert into briar_channel_messages (id, channel_id, author_user_id, body, created_at, updated_at)
      values ('text-message', 'text-channel', 'text-owner', 'Files', '2026-09-08', '2026-09-08');
    `);
    const insert = (id: string, type: string) => db.prepare(`
      insert into briar_channel_message_attachments
      (id, organization_id, channel_id, message_id, object_key, filename, content_type, byte_size, created_at, image_width, image_height)
      values (?, 'text-org', 'text-channel', 'text-message', ?, ?, ?, 12, '2026-09-08', null, null)
    `).bind(id, `attachments/${id}`, id, type).run();
    await insert("old.pdf", "application/pdf");
    await insert("old.png", "image/png");
    const before = await db.prepare("select * from briar_channel_message_attachments order by id").all();
    const triggers = await db.prepare("select name, sql from sqlite_master where type = 'trigger' order by name").all();
    await applyD1Migrations(db, { files: ["0213_channel_text_attachments.sql"] });
    expect((await db.prepare("select * from briar_channel_message_attachments order by id").all()).results).toEqual(before.results);
    expect((await db.prepare("select name, sql from sqlite_master where type = 'trigger' order by name").all()).results).toEqual(triggers.results);
    expect((await db.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'briar_channel_message_attachments'").all()).results).toEqual(expect.arrayContaining([
      { name: "briar_channel_message_attachments_message_idx" }, { name: "briar_channel_message_attachments_channel_idx" },
    ]));
    await insert("new.md", "text/markdown");
    await insert("new.txt", "text/plain");
    await expect(insert("bad.zip", "application/zip")).rejects.toThrow();
    expect((await db.prepare("pragma foreign_key_check").all()).results).toEqual([]);
    await db.prepare("delete from briar_channel_messages where id = 'text-message'").run();
    expect((await db.prepare("select * from briar_channel_message_attachments").all()).results).toEqual([]);
  });
});
