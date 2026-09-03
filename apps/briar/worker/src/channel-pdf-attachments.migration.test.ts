import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createChannel, createChannelMessage } from "./channels";
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
    await createChannel(db, {
      id: "pdf-channel",
      organizationId: "pdf-org",
      kind: "dm",
      dmKey: "user:pdf-owner",
      slug: "pdf-dm",
      name: "PDF DM",
      topic: null,
      visibility: "private",
      defaultProjectId: null,
      createdByUserId: "pdf-owner",
      createdAt: now,
    });
    await createChannelMessage(db, {
      id: "image-message",
      channelId: "pdf-channel",
      parentMessageId: null,
      authorUserId: "pdf-owner",
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Existing image",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [{
        id: "image-attachment",
        organization_id: "pdf-org",
        object_key: "channel-attachments/pdf-org/pdf-channel/image-message/image-attachment",
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 4,
      }],
      createdAt: now,
    });

    await applyD1Migrations(db, {
      files: ["0176_channel_pdf_attachments.sql"],
    });

    expect(await db.prepare(
      `select filename, content_type from briar_channel_message_attachments
       where id = 'image-attachment'`,
    ).first()).toEqual({ filename: "screen.png", content_type: "image/png" });

    await createChannelMessage(db, {
      id: "pdf-message",
      channelId: "pdf-channel",
      parentMessageId: null,
      authorUserId: "pdf-owner",
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "PDF attachment",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [{
        id: "pdf-attachment",
        organization_id: "pdf-org",
        object_key: "channel-attachments/pdf-org/pdf-channel/pdf-message/pdf-attachment",
        filename: "brief.pdf",
        content_type: "application/pdf",
        byte_size: 8,
      }],
      createdAt: now,
    });
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
