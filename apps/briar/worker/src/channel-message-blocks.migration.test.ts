import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";

describe("channel message block cutover", () => {
  it("keeps imported message bodies and removes the legacy block shape", async () => {
    const db = env.DB;
    await applyD1Migrations(db, {
      through: "0158_remove_issue_proposal_status.sql",
    });

    const historical = await db.prepare(
      `select id, body from briar_channel_messages
       where blocks_json is not null order by id limit 1`,
    ).first<{ id: string; body: string }>();
    expect(historical).not.toBeNull();

    await applyD1Migrations(db, {
      files: ["0159_canonical_channel_message_blocks.sql"],
    });

    expect(await db.prepare(
      `select count(*) as count from briar_channel_messages
       where blocks_json is not null`,
    ).first<number>("count")).toBe(0);
    expect(await db.prepare(
      `select body from briar_channel_messages where id = ?`,
    ).bind(historical!.id).first<string>("body")).toBe(historical!.body);

    await expect(db.prepare(
      `update briar_channel_messages set blocks_json = '{}' where id = ?`,
    ).bind(historical!.id).run()).rejects.toThrow(
      /channel message blocks must be a JSON array/iu,
    );
  });
});
