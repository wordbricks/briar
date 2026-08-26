import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteInboxReadState,
  listInboxReadStates,
  upsertInboxReadStates,
} from "./inbox-read-state-repository";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";

describe("inbox read state repository", () => {
  let miniflare: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "inbox-read-state-repository",
    });
    miniflare = database.miniflare;
    db = database.db;
    const now = "2026-08-02T00:00:00.000Z";
    await executeD1Sql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${now}', '${now}');
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('member', 'Member', 'member@example.com', 1, '${now}', '${now}');
      `,
    );
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("atomically upserts account-scoped read versions", async () => {
    await expect(
      upsertInboxReadStates(
        db,
        "owner",
        [{
          messageId: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: "1:1:completed:merged:2026-08-02T01:00:00.000Z:3",
        }],
        "2026-08-02T00:40:00.000Z",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        message_id: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: "1:1:completed:merged:2026-08-02T01:00:00.000Z:3",
      }),
    ]);

    const updated = await upsertInboxReadStates(
      db,
      "owner",
      [
        {
          messageId: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: "2:1:blocked:reviewing:2026-08-02T02:00:00.000Z:5",
        },
        {
          messageId: "conversation:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      ],
      "2026-08-02T00:41:00.000Z",
    );

    expect(updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message_id: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: "2:1:blocked:reviewing:2026-08-02T02:00:00.000Z:5",
        }),
        expect.objectContaining({
          message_id: "conversation:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ]),
    );
    await expect(listInboxReadStates(db, "owner")).resolves.toHaveLength(2);
    await expect(listInboxReadStates(db, "member")).resolves.toEqual([]);
  });

  it("removes only the selected account-scoped read state", async () => {
    const remaining = await deleteInboxReadState(
      db,
      "owner",
      "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(remaining).toEqual([
      expect.objectContaining({
        message_id: "conversation:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ]);
    await expect(listInboxReadStates(db, "member")).resolves.toEqual([]);
  });

  it("fails when a D1 row violates the repository schema", async () => {
    await db
      .prepare(
        `insert into briar_inbox_read_states (
           user_id, message_id, version, updated_at
         ) values (?, ?, ?, ?)`,
      )
      .bind(
        "member",
        "issue:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        new Uint8Array([1, 2, 3]).buffer,
        "2026-08-02T00:42:00.000Z",
      )
      .run();

    await expect(listInboxReadStates(db, "member")).rejects.toMatchObject({
      _tag: "SchemaError",
    });
  });
});
