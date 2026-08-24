import * as EffectArray from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { createSqlQueryCache } from "./sql-query-cache";

const DASHBOARD_CHANGE_PAGE_SIZE = 500;

const DashboardChangeRow = Schema.Struct({
  version: Schema.Int,
  entity_type: Schema.Literals([
    "run",
    "worker",
    "notifications",
    "metadata",
  ]),
  entity_id: Schema.NullOr(Schema.String),
  operation: Schema.Literals(["upsert", "delete", "replace"]),
});
export type DashboardChangeRow = typeof DashboardChangeRow.Type;

export type DashboardChangesPage = {
  currentVersion: number;
  oldestVersion: number | null;
  changes: Array<DashboardChangeRow>;
  hasMore: boolean;
  nextCursor: number;
  expired: boolean;
};

const ProjectRequest = Schema.Struct({
  projectId: Schema.String,
});

const DashboardChangeRequest = Schema.Struct({
  projectId: Schema.String,
  cursor: Schema.Int,
  currentVersion: Schema.Int,
  limit: Schema.Int,
});

const makeDashboardChangeQueries = (sql: SqlClient.SqlClient) => {
  const findDashboardSyncState = SqlSchema.findOneOption({
    Request: ProjectRequest,
    Result: Schema.Struct({ current_version: Schema.Int }),
    execute: ({ projectId }) => sql`
        select current_version from briar_dashboard_sync_state
        where project_id = ${projectId}
      `,
  });

  const findOldestDashboardChange = SqlSchema.findOneOption({
    Request: ProjectRequest,
    Result: Schema.Struct({ oldest_version: Schema.NullOr(Schema.Int) }),
    execute: ({ projectId }) => sql`
        select min(version) as oldest_version
        from briar_dashboard_changes
        where project_id = ${projectId}
      `,
  });

  const findDashboardChanges = SqlSchema.findAll({
    Request: DashboardChangeRequest,
    Result: DashboardChangeRow,
    execute: ({ projectId, cursor, currentVersion, limit }) => sql`
        select version, entity_type, entity_id, operation
        from briar_dashboard_changes
        where project_id = ${projectId}
          and version > ${cursor}
          and version <= ${currentVersion}
        order by version
        limit ${limit}
      `,
  });

  return {
    findDashboardChanges,
    findDashboardSyncState,
    findOldestDashboardChange,
  };
};
const dashboardChangeQueries = createSqlQueryCache(makeDashboardChangeQueries);

const getDashboardSyncCursorEffect = Effect.fn(
  "getDashboardSyncCursorEffect",
)(function*(projectId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = dashboardChangeQueries(sql);
  const state = yield* queries.findDashboardSyncState({ projectId });
  return Option.match(state, {
    onNone: () => 0,
    onSome: (row) => row.current_version,
  });
});

const listDashboardChangesEffect = Effect.fn("listDashboardChangesEffect")(
  function*(projectId: string, cursor: number) {
    const sql = yield* SqlClient.SqlClient;
    const queries = dashboardChangeQueries(sql);
    const state = yield* queries.findDashboardSyncState({ projectId });
    const currentVersion = Option.match(state, {
      onNone: () => 0,
      onSome: (row) => row.current_version,
    });
    const oldest = yield* queries.findOldestDashboardChange({ projectId });
    const oldestVersion = Option.match(oldest, {
      onNone: () => null,
      onSome: (row) => row.oldest_version,
    });
    const expired =
      cursor < 0 ||
      cursor > currentVersion ||
      (cursor < currentVersion &&
        (oldestVersion === null || cursor < oldestVersion - 1));
    if (expired) {
      return {
        currentVersion,
        oldestVersion,
        changes: [],
        hasMore: false,
        nextCursor: currentVersion,
        expired: true,
      };
    }

    const rows = yield* queries.findDashboardChanges({
      projectId,
      cursor,
      currentVersion,
      limit: DASHBOARD_CHANGE_PAGE_SIZE + 1,
    });
    const hasMore = rows.length > DASHBOARD_CHANGE_PAGE_SIZE;
    const changes = EffectArray.take(rows, DASHBOARD_CHANGE_PAGE_SIZE);
    const nextCursor = hasMore
      ? Option.match(EffectArray.last(changes), {
          onNone: () => cursor,
          onSome: (change) => change.version,
        })
      : currentVersion;
    return {
      currentVersion,
      oldestVersion,
      changes,
      hasMore,
      nextCursor,
      expired: false,
    };
  },
);

export const getDashboardSyncCursor = (
  db: D1Database,
  projectId: string,
): Promise<number> => runD1(db, getDashboardSyncCursorEffect(projectId));

export const listDashboardChanges = (
  db: D1Database,
  projectId: string,
  cursor: number,
): Promise<DashboardChangesPage> =>
  runD1(db, listDashboardChangesEffect(projectId, cursor));
