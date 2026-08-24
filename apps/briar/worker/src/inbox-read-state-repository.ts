import * as D1Client from "@effect/sql-d1/D1Client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { createSqlQueryCache } from "./sql-query-cache";

const InboxReadStateRow = Schema.Struct({
  message_id: Schema.String,
  version: Schema.String,
  updated_at: Schema.String,
});
export type InboxReadStateRow = typeof InboxReadStateRow.Type;

const ListInboxReadStatesRequest = Schema.Struct({
  userId: Schema.String,
});

const makeInboxReadStateQueries = (sql: SqlClient.SqlClient) => {
  const findInboxReadStates = SqlSchema.findAll({
    Request: ListInboxReadStatesRequest,
    Result: InboxReadStateRow,
    execute: ({ userId }) => sql`
        select message_id, version, updated_at
        from briar_inbox_read_states
        where user_id = ${userId}
        order by updated_at desc, message_id
      `,
  });

  return { findInboxReadStates };
};
const inboxReadStateQueries = createSqlQueryCache(makeInboxReadStateQueries);

const listInboxReadStatesEffect = Effect.fn("listInboxReadStatesEffect")(
  function*(userId: string) {
    const sql = yield* D1Client.D1Client;
    const queries = inboxReadStateQueries(sql);
    return yield* queries.findInboxReadStates({ userId });
  },
);

const upsertInboxReadStatesEffect = Effect.fn("upsertInboxReadStatesEffect")(
  function*(
    userId: string,
    entries: ReadonlyArray<{ messageId: string; version: string }>,
    updatedAt: string,
  ) {
    if (entries.length > 0) {
      const sql = yield* D1Client.D1Client;
      yield* sql.batch(
        entries.map(
          (entry) => sql`
            insert into briar_inbox_read_states (
              user_id, message_id, version, updated_at
            ) values (${userId}, ${entry.messageId}, ${entry.version}, ${updatedAt})
            on conflict(user_id, message_id) do update set
              version = excluded.version,
              updated_at = excluded.updated_at
          `,
        ),
      );
    }
    const sql = yield* D1Client.D1Client;
    const queries = inboxReadStateQueries(sql);
    return yield* queries.findInboxReadStates({ userId });
  },
);

export const listInboxReadStates = (
  db: D1Database,
  userId: string,
): Promise<Array<InboxReadStateRow>> =>
  runD1(db, listInboxReadStatesEffect(userId));

export const upsertInboxReadStates = (
  db: D1Database,
  userId: string,
  entries: ReadonlyArray<{ messageId: string; version: string }>,
  updatedAt: string,
): Promise<Array<InboxReadStateRow>> =>
  runD1(db, upsertInboxReadStatesEffect(userId, entries, updatedAt));
