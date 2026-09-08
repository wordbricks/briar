import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { HuntEventRow } from "./hunt-event-model";
import { createSqlQueryCache } from "./sql-query-cache";

const HuntRunEventsRequest = Schema.Struct({
  projectId: Schema.String,
  runId: Schema.String,
});

const HuntEventActorNamesRequest = Schema.Struct({
  projectId: Schema.String,
  userIds: Schema.Array(Schema.String),
});

const HuntEventActorNameRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const makeHuntEventHistoryQueries = (sql: SqlClient.SqlClient) => {
  const findHuntRunEvents = SqlSchema.findAll({
    Request: HuntRunEventsRequest,
    Result: HuntEventRow,
    execute: ({ projectId, runId }) => sql`
      select event.id, event.run_id, event.event_key, event.attempt,
             event.revision, event.stage, event.status, event.workflow_stage,
             event.detail, event.actor, event.branch, event.commit_sha,
             event.qa_status, event.tracker_issue_state,
             event.pull_request_urls, event.target_sha,
             event.occurred_at, event.recorded_at
      from briar_hunt_events event
      join briar_hunt_runs run on run.id = event.run_id
      where run.project_id = ${projectId} and event.run_id = ${runId}
      order by event.occurred_at desc, event.id desc
    `,
  });

  const findHuntEventActorNames = SqlSchema.findAll({
    Request: HuntEventActorNamesRequest,
    Result: HuntEventActorNameRow,
    execute: ({ projectId, userIds }) => sql`
      select account.id, account.name
      from "user" account
      join briar_organization_members member on member.user_id = account.id
      join briar_teams team
        on team.organization_id = member.organization_id
      where team.id = ${projectId}
        and ${sql.in("account.id", userIds)}
    `,
  });

  return { findHuntEventActorNames, findHuntRunEvents };
};
const huntEventHistoryQueries = createSqlQueryCache(
  makeHuntEventHistoryQueries,
);

const listHuntRunEventsEffect = Effect.fn("listHuntRunEventsEffect")(
  function*(projectId: string, runId: string) {
    const sql = yield* SqlClient.SqlClient;
    return yield* huntEventHistoryQueries(sql).findHuntRunEvents({
      projectId,
      runId,
    });
  },
);

const resolveHuntEventActorNamesEffect = Effect.fn(
  "resolveHuntEventActorNamesEffect",
)(function*(projectId: string, actors: readonly string[]) {
  const sql = yield* SqlClient.SqlClient;
  const queries = huntEventHistoryQueries(sql);
  const userIds = [...new Set(
    actors
      .filter((actor) => actor.startsWith("briar-app:"))
      .map((actor) => actor.slice("briar-app:".length))
      .filter(Boolean),
  )];
  const names = new Map<string, string>();
  const chunkSize = 50;
  for (let offset = 0; offset < userIds.length; offset += chunkSize) {
    const users = yield* queries.findHuntEventActorNames({
      projectId,
      userIds: userIds.slice(offset, offset + chunkSize),
    });
    for (const user of users) {
      names.set(`briar-app:${user.id}`, user.name);
    }
  }
  return names;
});

export const listHuntRunEvents = (
  db: D1Database,
  projectId: string,
  runId: string,
): Promise<Array<HuntEventRow>> =>
  runD1(db, listHuntRunEventsEffect(projectId, runId));

export type HuntRunEventsPageCursor = {
  readonly occurredAt: string;
  readonly id: string;
};

export async function listHuntRunEventsPage(
  db: D1Database,
  projectId: string,
  runId: string,
  options: {
    readonly limit: number;
    readonly cursor?: HuntRunEventsPageCursor | null;
  },
) {
  const conditions = [
    "run.project_id = ?",
    "event.run_id = ?",
  ];
  const bindings: Array<string | number> = [projectId, runId];
  if (options.cursor) {
    conditions.push(
      "(event.occurred_at < ? or (event.occurred_at = ? and event.id < ?))",
    );
    bindings.push(
      options.cursor.occurredAt,
      options.cursor.occurredAt,
      options.cursor.id,
    );
  }
  const result = await db
    .prepare(
      `select event.id, event.run_id, event.event_key, event.attempt,
              event.revision, event.stage, event.status, event.workflow_stage,
              event.detail, event.actor, event.branch, event.commit_sha,
              event.qa_status, event.tracker_issue_state,
              event.pull_request_urls, event.target_sha,
              event.occurred_at, event.recorded_at
       from briar_hunt_events event
       join briar_hunt_runs run on run.id = event.run_id
       where ${conditions.join(" and ")}
       order by event.occurred_at desc, event.id desc
       limit ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<HuntEventRow>();
  const events = result.results.slice(0, options.limit);
  const last = events.at(-1);
  return {
    events,
    nextCursor: result.results.length > options.limit && last
      ? { occurredAt: last.occurred_at, id: last.id }
      : null,
  };
}

export const resolveHuntEventActorNames = (
  db: D1Database,
  projectId: string,
  actors: readonly string[],
): Promise<Map<string, string>> =>
  runD1(db, resolveHuntEventActorNamesEffect(projectId, actors));
