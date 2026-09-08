import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

const now = "2026-09-07T00:00:00.000Z";
const target = "0209_channel_message_body_length.sql";
const previous = "0208_agent_provider_lookup_part5.sql";

/*
  Widening `briar_channel_messages.body` means rebuilding the table, and D1
  leaves no way to do that without disturbing the eighteen tables downstream of
  it: `pragma foreign_keys = off` is ignored, dropping the parent cascades, and
  renaming it aside rewrites the references that name it. So the migration
  parks every descendant's rows and puts them back, which is what these tests
  are for — the rows, the indexes and triggers the drop took with it, the new
  bound, and the silence the restore has to keep.

  The fixture is written with plain inserts rather than through the repository
  functions, because the schema here is the one this migration is about to
  change.
*/
const seed = async (db: D1Database) => {
  await executeD1Sql(db, `
    insert into "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) values (
      'body-owner', 'Body Owner', 'body@example.com', 1, '${now}', '${now}'
    );
    insert into briar_organizations (
      id, name, handle, created_at, updated_at
    ) values (
      'body-org', 'Body Org', 'body-org', '${now}', '${now}'
    );
    insert into briar_organization_members (
      organization_id, user_id, role, created_at, updated_at
    ) values (
      'body-org', 'body-owner', 'owner', '${now}', '${now}'
    );
    insert into briar_project_agents (
      id, project_id, organization_id, name, responsibility, provider,
      created_at, updated_at
    ) values (
      'body-agent', null, 'body-org', 'Agent', 'Answers', 'codex',
      '${now}', '${now}'
    );
    insert into briar_channels (
      id, organization_id, slug, name, visibility, created_by_user_id,
      created_at, updated_at
    ) values (
      'body-channel', 'body-org', 'general', 'general', 'public', 'body-owner',
      '${now}', '${now}'
    );
    insert into briar_channel_members (
      channel_id, user_id, role, created_at
    ) values (
      'body-channel', 'body-owner', 'owner', '${now}'
    );
    insert into briar_channel_messages (
      id, channel_id, author_user_id, body, created_at, updated_at
    ) values
      ('body-root', 'body-channel', 'body-owner', 'Root', '${now}', '${now}'),
      ('body-reply', 'body-channel', 'body-owner', 'Reply', '${now}', '${now}');
    update briar_channel_messages
      set parent_message_id = 'body-root' where id = 'body-reply';
    insert into briar_channel_message_reactions (
      message_id, user_id, emoji, created_at
    ) values ('body-root', 'body-owner', '👍', '${now}');
    insert into briar_channel_agent_reply_jobs (
      id, organization_id, channel_id, project_id, agent_id,
      trigger_message_id, parent_message_id, reply_message_id, status,
      agent_provider, created_at, updated_at
    ) values (
      'body-job', 'body-org', 'body-channel', null, 'body-agent',
      'body-root', 'body-root', 'body-reply', 'completed', 'codex',
      '${now}', '${now}'
    );
  `);
};

const insertMessage = (db: D1Database, id: string, body: string) =>
  db
    .prepare(
      `insert into briar_channel_messages (
         id, channel_id, author_user_id, body, created_at, updated_at
       ) values (?, 'body-channel', 'body-owner', ?, ?, ?)`,
    )
    .bind(id, body, now, now)
    .run();

describe("channel message body length migration", () => {
  it("widens the body bound without touching the descendant tables", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    // The rows the rebuild moved, and the descendant rows it must not have
    // cascaded away when the old table went.
    expect(
      await db
        .prepare(
          `select id, parent_message_id, body from briar_channel_messages
           order by id`,
        )
        .all(),
    ).toMatchObject({
      results: [
        { id: "body-reply", parent_message_id: "body-root", body: "Reply" },
        { id: "body-root", parent_message_id: null, body: "Root" },
      ],
    });
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_channel_message_reactions`,
        )
        .first<number>("count"),
    ).toBe(1);
    expect(
      await db
        .prepare(
          `select trigger_message_id, reply_message_id
           from briar_channel_agent_reply_jobs where id = 'body-job'`,
        )
        .first(),
    ).toEqual({
      trigger_message_id: "body-root",
      reply_message_id: "body-reply",
    });
  });

  it("leaves the schema whole and every foreign key satisfied", async () => {
    const db = env.DB;
    await applyD1Migrations(db);

    // Every descendant still names the table it named before, and none of the
    // staging tables the rebuild parked its rows in is left behind.
    expect(
      await db
        .prepare(
          `select count(*) as count from sqlite_schema
           where type = 'table' and name like 'briar_body_backup_%'`,
        )
        .first<number>("count"),
    ).toBe(0);
    expect(
      await db
        .prepare(
          `select count(*) as count from sqlite_schema
           where type = 'table'
             and sql like '%references briar_channel_messages (id)%'`,
        )
        .first<number>("count"),
    ).toBeGreaterThan(0);
    expect(
      await db.prepare("pragma foreign_key_check").all(),
    ).toMatchObject({ results: [] });
  });

  it("keeps the indexes and triggers the rebuilt table dropped with it", async () => {
    const db = env.DB;
    await applyD1Migrations(db);

    const objects = async (type: "index" | "trigger") =>
      (await db
        .prepare(
          `select name from sqlite_schema
           where type = ? and tbl_name = 'briar_channel_messages'
             and sql is not null
           order by name`,
        )
        .bind(type)
        .all<{ name: string }>()).results.map((row) => row.name);

    expect(await objects("index")).toEqual([
      "briar_channel_messages_channel_idx",
      "briar_channel_messages_deleted_idx",
      "briar_channel_messages_dm_batch_part_idx",
      "briar_channel_messages_dm_sequence_idx",
      "briar_channel_messages_root_idx",
      "briar_channel_messages_thread_idx",
      "briar_channel_messages_webhook_event_idx",
    ]);
    expect((await objects("trigger")).length).toBe(16);
  });

  it("stores a message the old bound rejected and still rejects a longer one", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);
    await expect(insertMessage(db, "body-long", "a".repeat(10_001)))
      .rejects.toThrow();

    await applyD1Migrations(db, { files: [target] });

    await insertMessage(db, "body-long", "a".repeat(50_000));
    expect(
      await db
        .prepare(
          `select length(body) as length from briar_channel_messages
           where id = 'body-long'`,
        )
        .first<number>("length"),
    ).toBe(50_000);
    await expect(insertMessage(db, "body-longer", "a".repeat(50_001)))
      .rejects.toThrow();
  });

  it("still records the change row its recreated trigger writes", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    const changeRows = () =>
      db
        .prepare(
          `select count(*) as count from briar_channel_changes
           where entity_type = 'message'`,
        )
        .first<number>("count");
    const beforeRebuild = await changeRows();

    await applyD1Migrations(db, { files: [target] });

    // The restore replays rows that already existed, so it runs with the
    // triggers dropped: re-announcing the whole history to the sync feed would
    // make every client refetch it, and the DM-memory triggers would queue the
    // learning work for it a second time.
    expect(await changeRows()).toBe(beforeRebuild);

    await insertMessage(db, "body-after", "Written after the rebuild");
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_channel_changes
           where entity_type = 'message' and entity_id = 'body-after'`,
        )
        .first<number>("count"),
    ).toBeGreaterThan(0);
  });
});
