import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

const now = "2026-09-07T00:00:00.000Z";
const target = "0210_agent_message_reactions.sql";
const previous = "0209_channel_message_body_length.sql";

const seed = async (db: D1Database) => {
  await executeD1Sql(db, `
    insert into "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) values (
      'reaction-owner', 'Reaction Owner', 'reaction@example.com', 1,
      '${now}', '${now}'
    );
    insert into briar_organizations (
      id, name, handle, created_at, updated_at
    ) values (
      'reaction-org', 'Reaction Org', 'reaction-org', '${now}', '${now}'
    );
    insert into briar_organization_members (
      organization_id, user_id, role, created_at, updated_at
    ) values (
      'reaction-org', 'reaction-owner', 'owner', '${now}', '${now}'
    );
    insert into briar_project_agents (
      id, organization_id, name, responsibility, provider,
      created_at, updated_at
    ) values (
      'reaction-agent', 'reaction-org', 'Reaction Agent', 'Acknowledge messages',
      'codex', '${now}', '${now}'
    );
    insert into briar_channels (
      id, organization_id, kind, slug, name, visibility, created_by_user_id,
      created_at, updated_at
    ) values (
      'reaction-channel', 'reaction-org', 'dm', 'reaction-dm', 'Reaction DM',
      'private', 'reaction-owner', '${now}', '${now}'
    );
    insert into briar_channel_messages (
      id, channel_id, author_user_id, body, created_at, updated_at
    ) values (
      'reaction-message', 'reaction-channel', 'reaction-owner', 'Hello',
      '${now}', '${now}'
    );
    insert into briar_channel_message_reactions (
      message_id, user_id, emoji, created_at
    ) values (
      'reaction-message', 'reaction-owner', '👍', '${now}'
    );
  `);
};

describe("Agent message reactions migration", () => {
  it("preserves user reactions and adds one identity per Agent", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    expect(await db.prepare(
      `select message_id, user_id, agent_id, emoji
       from briar_channel_message_reactions`,
    ).all()).toMatchObject({
      results: [{
        message_id: "reaction-message",
        user_id: "reaction-owner",
        agent_id: null,
        emoji: "👍",
      }],
    });

    await db.prepare(
      `insert into briar_channel_message_reactions (
         message_id, agent_id, emoji, created_at
       ) values (?, ?, ?, ?)`,
    ).bind("reaction-message", "reaction-agent", "👀", now).run();

    expect(await db.prepare(
      `select count(*) as count from briar_channel_message_reactions
       where agent_id = 'reaction-agent' and emoji = '👀'`,
    ).first<number>("count")).toBe(1);
    await expect(db.prepare(
      `insert into briar_channel_message_reactions (
         message_id, agent_id, emoji, created_at
       ) values (?, ?, ?, ?)`,
    ).bind("reaction-message", "reaction-agent", "👀", now).run())
      .rejects.toThrow();
  });

  it("rejects ambiguous authors and keeps reaction synchronization triggers", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);
    await applyD1Migrations(db, { files: [target] });

    await expect(db.prepare(
      `insert into briar_channel_message_reactions (
         message_id, user_id, agent_id, emoji, created_at
       ) values (?, ?, ?, ?, ?)`,
    ).bind("reaction-message", "reaction-owner", "reaction-agent", "🔥", now).run())
      .rejects.toThrow();
    await expect(db.prepare(
      `insert into briar_channel_message_reactions (
         message_id, emoji, created_at
       ) values (?, ?, ?)`,
    ).bind("reaction-message", "🔥", now).run()).rejects.toThrow();

    const before = await db.prepare(
      `select count(*) as count from briar_channel_changes
       where entity_id = 'reaction-message'`,
    ).first<number>("count");
    await db.prepare(
      `insert into briar_channel_message_reactions (
         message_id, agent_id, emoji, created_at
       ) values (?, ?, ?, ?)`,
    ).bind("reaction-message", "reaction-agent", "✅", now).run();
    const after = await db.prepare(
      `select count(*) as count from briar_channel_changes
       where entity_id = 'reaction-message'`,
    ).first<number>("count");
    expect(after).toBeGreaterThan(before ?? 0);
    expect(await db.prepare("pragma foreign_key_check").all())
      .toMatchObject({ results: [] });
  });
});
