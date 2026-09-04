import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decodeStoredChannelMessageBlocks } from "./channels";
import { applyD1Migrations } from "./test-helpers/d1";

describe("channel message block cutover", () => {
  it("preserves readable imported blocks under the strict decoder", async () => {
    const db = env.DB;
    await applyD1Migrations(db, {
      through: "0163_remove_issue_proposal_status.sql",
    });

    const historical = await db.prepare(
      `select id, channel_id, body from briar_channel_messages
       where blocks_json is not null order by id limit 1`,
    ).first<{ id: string; channel_id: string; body: string }>();
    expect(historical).not.toBeNull();

    await applyD1Migrations(db, {
      files: ["0164_canonical_channel_message_blocks.sql"],
    });

    const migrated = await db.prepare(
      `select body, blocks_json from briar_channel_messages
       where id = ?`,
    ).bind(historical!.id).first<{
      body: string;
      blocks_json: string | null;
    }>();
    expect(migrated).not.toBeNull();
    expect(migrated!.body).toBe(historical!.body);
    expect(migrated!.blocks_json).not.toBeNull();
    expect(decodeStoredChannelMessageBlocks(migrated!.blocks_json!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: expect.any(String) }),
      ]),
    );

    await expect(db.prepare(
      `update briar_channel_messages set blocks_json = '{}' where id = ?`,
    ).bind(historical!.id).run()).rejects.toThrow(
      /channel message blocks must be a bounded JSON array/iu,
    );
  });
});
