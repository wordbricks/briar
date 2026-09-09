import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import type { TeamId, WorkspaceId } from "../../src/lib/entity-ids";
import { runD1 } from "./d1-runtime";
import { WorkspaceRole } from "./workspace-repository";
import { createSqlQueryCache } from "./sql-query-cache";

const TeamRow = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  name: Schema.mutableKey(Schema.String),
  issue_key_prefix: Schema.mutableKey(Schema.String),
  schedule_tab_enabled: Schema.mutableKey(Schema.Int),
  icon: Schema.mutableKey(Schema.NullOr(Schema.String)),
  icon_name: Schema.mutableKey(Schema.NullOr(Schema.String)),
  icon_color: Schema.mutableKey(Schema.NullOr(Schema.String)),
  organization_id: Schema.mutableKey(Schema.String),
  organization_name: Schema.mutableKey(Schema.String),
  member_role: Schema.mutableKey(WorkspaceRole),
  created_at: Schema.mutableKey(Schema.String),
});
/**
 * `briar_teams.id` is the execution-boundary Team id — the value still stored
 * in columns literally named `project_id`. The row schema decodes it as a
 * plain string, so the exported row type re-attaches the brand here (a single
 * D1-edge assertion) rather than at every call site.
 */
export type TeamRow =
  & Omit<typeof TeamRow.Type, "id" | "organization_id">
  & { id: TeamId; organization_id: WorkspaceId };

const TeamListRequest = Schema.Struct({ scopeId: Schema.String });

const makeTeamQueries = (sql: SqlClient.SqlClient) => {
  const findTeams = SqlSchema.findAll({
    Request: TeamListRequest,
    Result: TeamRow,
    execute: ({ scopeId: userId }) => sql`
        select team.id, team.name,
               team.issue_key_prefix,
               team.schedule_tab_enabled,
               coalesce(team.icon_data_url_browser, team.icon_data_url) as icon,
               team.icon_name, team.icon_color,
               team.organization_id,
               workspace.name as organization_name,
               membership.role as member_role, team.created_at
        from briar_teams team
        join briar_organizations workspace
          on workspace.id = team.organization_id
        join briar_organization_members membership
          on membership.organization_id = team.organization_id
         and membership.user_id = ${userId}
        left join briar_project_members project_membership
          on project_membership.project_id = team.id
         and project_membership.organization_id = team.organization_id
         and project_membership.user_id = membership.user_id
        where membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
        order by workspace.created_at, team.created_at
      `,
  });

  const findWorkspaceTeams = SqlSchema.findAll({
    Request: TeamListRequest,
    Result: TeamRow,
    execute: ({ scopeId: workspaceId }) => sql`
        select team.id, team.name,
               team.issue_key_prefix,
               team.schedule_tab_enabled,
               coalesce(team.icon_data_url_browser, team.icon_data_url) as icon,
               team.icon_name, team.icon_color,
               team.organization_id,
               workspace.name as organization_name,
               'viewer' as member_role, team.created_at
        from briar_teams team
        join briar_organizations workspace
          on workspace.id = team.organization_id
        where team.organization_id = ${workspaceId}
        order by team.created_at
      `,
  });

  const InboxTeamRow = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    issue_key_prefix: Schema.String,
  });

  const findWorkspaceInboxTeams = SqlSchema.findAll({
    Request: Schema.Struct({
      workspaceId: Schema.String,
      userId: Schema.String,
    }),
    Result: InboxTeamRow,
    execute: ({ workspaceId, userId }) => sql`
        select team.id, team.name, team.issue_key_prefix
        from briar_teams team
        join briar_organization_members membership
          on membership.organization_id = team.organization_id
         and membership.user_id = ${userId}
        left join briar_project_members project_membership
          on project_membership.project_id = team.id
         and project_membership.organization_id = team.organization_id
         and project_membership.user_id = membership.user_id
        where team.organization_id = ${workspaceId}
          and (
            membership.role in ('owner', 'co-owner')
            or project_membership.user_id is not null
          )
        order by team.created_at, team.id
      `,
  });

  return {
    findWorkspaceInboxTeams,
    findWorkspaceTeams,
    findTeams,
  };
};
const teamQueries = createSqlQueryCache(makeTeamQueries);

const listTeamsEffect = Effect.fn("listTeamsEffect")(
  function*(userId: string) {
    const sql = yield* SqlClient.SqlClient;
    const queries = teamQueries(sql);
    return yield* queries.findTeams({ scopeId: userId });
  },
);

const listWorkspaceTeamsEffect = Effect.fn(
  "listWorkspaceTeamsEffect",
)(function*(workspaceId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = teamQueries(sql);
  return yield* queries.findWorkspaceTeams({ scopeId: workspaceId });
});

const listWorkspaceInboxTeamsEffect = Effect.fn(
  "listWorkspaceInboxTeamsEffect",
)(function*(workspaceId: string, userId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = teamQueries(sql);
  return yield* queries.findWorkspaceInboxTeams({
    workspaceId,
    userId,
  });
});

/**
 * D1 edge: the row schemas above decode ids as plain strings, and every row
 * these three queries return is a `briar_teams` row, so the Team brand is
 * re-attached once here instead of at each call site.
 */
export const listTeams = (
  db: D1Database,
  userId: string,
): Promise<Array<TeamRow>> =>
  runD1(db, listTeamsEffect(userId)) as Promise<Array<TeamRow>>;

export const listWorkspaceTeams = (
  db: D1Database,
  workspaceId: string,
): Promise<Array<TeamRow>> =>
  runD1(db, listWorkspaceTeamsEffect(workspaceId)) as Promise<
    Array<TeamRow>
  >;

export const listWorkspaceInboxTeams = (
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<Array<Pick<TeamRow, "id" | "name" | "issue_key_prefix">>> =>
  runD1(db, listWorkspaceInboxTeamsEffect(workspaceId, userId)) as Promise<
    Array<Pick<TeamRow, "id" | "name" | "issue_key_prefix">>
  >;
