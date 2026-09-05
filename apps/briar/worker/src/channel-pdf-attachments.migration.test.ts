import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

describe("channel PDF attachment migration", () => {
  it("preserves existing images and admits only the new PDF type", async () => {
    const db = env.DB;
    const now = "2026-09-03T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0175_canonical_agent_session_summary_issues.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'pdf-owner', 'PDF Owner', 'pdf@example.com', 1, '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'pdf-org', 'PDF Org', 'pdf-org', '${now}', '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        'pdf-org', 'pdf-owner', 'owner', '${now}', '${now}'
      );
    `);
    /*
      The schema stops at 0175 here, so the channel is seeded with the rows
      the production `createChannel` writes rather than through it: that
      function reads the channel back with the current catalog query, which
      joins tables later migrations create.
    */
    await executeD1Sql(db, `
      insert into briar_channels (
        id, organization_id, kind, dm_key, slug, name, topic, visibility,
        default_project_id, created_by_user_id, created_at, updated_at
      ) values (
        'pdf-channel', 'pdf-org', 'dm', 'user:pdf-owner', 'pdf-dm', 'PDF DM',
        null, 'private', null, 'pdf-owner', '${now}', '${now}'
      );
      insert into briar_channel_members (
        channel_id, user_id, role, created_at
      ) values (
        'pdf-channel', 'pdf-owner', 'owner', '${now}'
      );
    `);
    await executeD1Sql(db, `
      insert into briar_channel_messages (
        id, channel_id, parent_message_id, author_user_id, body,
        created_at, updated_at
      ) values (
        'image-message', 'pdf-channel', null, 'pdf-owner', 'Existing image',
        '${now}', '${now}'
      );
      insert into briar_channel_message_attachments (
        id, organization_id, channel_id, message_id, object_key,
        filename, content_type, byte_size, created_at
      ) values (
        'image-attachment', 'pdf-org', 'pdf-channel', 'image-message',
        'channel-attachments/pdf-org/pdf-channel/image-message/image-attachment',
        'screen.png', 'image/png', 4, '${now}'
      );
    `);

    await applyD1Migrations(db, {
      files: ["0176_channel_pdf_attachments.sql"],
    });

    expect(await db.prepare(
      `select filename, content_type from briar_channel_message_attachments
       where id = 'image-attachment'`,
    ).first()).toEqual({ filename: "screen.png", content_type: "image/png" });

    await executeD1Sql(db, `
      insert into briar_channel_messages (
        id, channel_id, parent_message_id, author_user_id, body,
        created_at, updated_at
      ) values (
        'pdf-message', 'pdf-channel', null, 'pdf-owner', 'PDF attachment',
        '${now}', '${now}'
      );
      insert into briar_channel_message_attachments (
        id, organization_id, channel_id, message_id, object_key,
        filename, content_type, byte_size, created_at
      ) values (
        'pdf-attachment', 'pdf-org', 'pdf-channel', 'pdf-message',
        'channel-attachments/pdf-org/pdf-channel/pdf-message/pdf-attachment',
        'brief.pdf', 'application/pdf', 8, '${now}'
      );
    `);
    expect(await db.prepare(
      `select filename, content_type from briar_channel_message_attachments
       where id = 'pdf-attachment'`,
    ).first()).toEqual({ filename: "brief.pdf", content_type: "application/pdf" });
    await expect(db.prepare(
      `insert into briar_channel_message_attachments (
         id, organization_id, channel_id, message_id, object_key,
         filename, content_type, byte_size, created_at
       ) values (
         'text-attachment', 'pdf-org', 'pdf-channel', 'pdf-message',
         'channel-attachments/pdf-org/pdf-channel/pdf-message/text-attachment',
         'notes.txt', 'text/plain', 4, '${now}'
       )`,
    ).run()).rejects.toThrow();
    expect((await db.prepare("pragma foreign_key_check").all()).results)
      .toEqual([]);
  });
});
