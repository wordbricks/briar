import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decodeStoredChannelMessageBlocks } from "./channels";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

/**
 * A Slack rich-text block exactly as the imported history stored it, before
 * `0164_canonical_channel_message_blocks.sql` narrowed the column to a bounded
 * JSON array. The migration has to leave a value in this shape readable.
 *
 * Written out here rather than read back from the imported rows: this test used
 * to pick the first message with a `blocks_json` out of the database, which
 * only worked because a one-off 6 MB restore of customer Slack history was
 * replayed as a migration. That file is gone, and a cutover test should carry
 * the value it migrates anyway.
 */
const importedBlocks = JSON.stringify([
  {
    type: "rich_text",
    block_id: "a8bcU",
    elements: [
      { type: "rich_text_section", elements: [{ type: "text", text: "hi" }] },
    ],
  },
]);

describe("channel message block cutover", () => {
  it("preserves readable imported blocks under the strict decoder", async () => {
    const db = env.DB;
    const now = "2026-06-12T03:13:56.682Z";
    await applyD1Migrations(db, {
      through: "0163_remove_issue_proposal_status.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('blocks-owner', 'Blocks Owner', 'blocks@example.com', 1,
              '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('blocks-org', 'Blocks Org', 'blocks-org', '${now}', '${now}');
      insert into briar_channels (
        id, organization_id, slug, name, created_by_user_id,
        created_at, updated_at
      ) values (
        'blocks-channel', 'blocks-org', 'blocks', 'Blocks', 'blocks-owner',
        '${now}', '${now}'
      );
    `);
    await db
      .prepare(
        `insert into briar_channel_messages (
           id, channel_id, author_user_id, body, blocks_json,
           created_at, updated_at
         ) values ('blocks-message', 'blocks-channel', 'blocks-owner', 'hi', ?, ?, ?)`,
      )
      .bind(importedBlocks, now, now)
      .run();

    await applyD1Migrations(db, {
      files: ["0164_canonical_channel_message_blocks.sql"],
    });

    const migrated = await db
      .prepare(
        `select body, blocks_json from briar_channel_messages where id = 'blocks-message'`,
      )
      .first<{ body: string; blocks_json: string | null }>();
    expect(migrated).not.toBeNull();
    expect(migrated!.body).toBe("hi");
    expect(migrated!.blocks_json).not.toBeNull();
    expect(decodeStoredChannelMessageBlocks(migrated!.blocks_json!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: expect.any(String) }),
      ]),
    );

    await expect(db.prepare(
      `update briar_channel_messages set blocks_json = '{}' where id = 'blocks-message'`,
    ).run()).rejects.toThrow(
      /channel message blocks must be a bounded JSON array/iu,
    );
  });
});
