import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

const beforeSearch = "0218_issue_attachment_sources.sql";
const searchMigration = "0219_channel_message_search.sql";

describe("channel message search migration", () => {
  it("creates an empty index and leaves historical messages for approved backfill", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: beforeSearch });
    await executeD1Sql(db, `
      insert into "user" (id,name,email,emailVerified,createdAt,updatedAt)
      values ('search-migration-user','Owner','migration-search@example.com',1,'2026-09-25','2026-09-25');
      insert into briar_organizations (id,name,handle,created_at,updated_at)
      values ('search-migration-org','Search','search-migration','2026-09-25','2026-09-25');
      insert into briar_channels (id,organization_id,slug,name,visibility,created_at,updated_at)
      values ('search-migration-channel','search-migration-org','search','Search','public','2026-09-25','2026-09-25');
      insert into briar_channel_messages (id,channel_id,author_user_id,body,created_at,updated_at)
      values ('search-migration-old','search-migration-channel','search-migration-user','old apple','2026-09-25','2026-09-25');
    `);
    await applyD1Migrations(db, { files: [searchMigration] });
    const oldMatch = await db.prepare(`select rowid from briar_channel_message_search where briar_channel_message_search match '"apple"'`).all();
    expect(oldMatch.results).toHaveLength(0);
    // A historical row was never indexed. Editing or deleting it must not
    // insert an FTS delete tombstone for a row that does not exist yet.
    await db.prepare(`update briar_channel_messages set body = 'edited banana'
      where id = 'search-migration-old'`).run();
    const editedMatch = await db.prepare(`select rowid from briar_channel_message_search
      where briar_channel_message_search match '"banana"'`).all();
    expect(editedMatch.results).toHaveLength(1);
    await db.prepare(`insert into briar_channel_messages (id,channel_id,author_user_id,body,created_at,updated_at)
      values ('search-migration-new','search-migration-channel','search-migration-user','new apple','2026-09-25','2026-09-25')`).run();
    const newMatch = await db.prepare(`select message.id from briar_channel_message_search idx
      join briar_channel_messages message on message.rowid=idx.rowid
      where briar_channel_message_search match '"apple"'`).all<{id:string}>();
    expect(newMatch.results.map(({id})=>id)).toEqual(['search-migration-new']);
  });
});
