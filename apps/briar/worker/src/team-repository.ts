import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { OrganizationRole } from "./organization-repository";
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
  member_role: Schema.mutableKey(OrganizationRole),
  created_at: Schema.mutableKey(Schema.String),
});
export type TeamRow = typeof TeamRow.Type;

const TeamListRequest = Schema.Struct({ scopeId: Schema.String });

const makeTeamQueries = (sql: SqlClient.SqlClient) => {
  const findTeams = SqlSchema.findAll({
    Request: TeamListRequest,
    Result: TeamRow,
    execute: ({ scopeId: userId }) => sql`
        select project.id, project.name,
               project.issue_key_prefix,
               project.schedule_tab_enabled,
               coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
               project.icon_name, project.icon_color,
               project.organization_id,
               organization.name as organization_name,
               membership.role as member_role, project.created_at
        from briar_teams project
        join briar_organizations organization
          on organization.id = project.organization_id
        join briar_organization_members membership
          on membership.organization_id = project.organization_id
         and membership.user_id = ${userId}
        left join briar_project_members project_membership
          on project_membership.project_id = project.id
         and project_membership.organization_id = project.organization_id
         and project_membership.user_id = membership.user_id
        where membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
        order by organization.created_at, project.created_at
      `,
  });

  const findOrganizationTeams = SqlSchema.findAll({
    Request: TeamListRequest,
    Result: TeamRow,
    execute: ({ scopeId: organizationId }) => sql`
        select project.id, project.name,
               project.issue_key_prefix,
               project.schedule_tab_enabled,
               coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
               project.icon_name, project.icon_color,
               project.organization_id,
               organization.name as organization_name,
               'viewer' as member_role, project.created_at
        from briar_teams project
        join briar_organizations organization
          on organization.id = project.organization_id
        where project.organization_id = ${organizationId}
        order by project.created_at
      `,
  });

  const InboxTeamRow = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    issue_key_prefix: Schema.String,
  });

  const findOrganizationInboxTeams = SqlSchema.findAll({
    Request: Schema.Struct({
      organizationId: Schema.String,
      userId: Schema.String,
    }),
    Result: InboxTeamRow,
    execute: ({ organizationId, userId }) => sql`
        select project.id, project.name, project.issue_key_prefix
        from briar_teams project
        join briar_organization_members membership
          on membership.organization_id = project.organization_id
         and membership.user_id = ${userId}
        left join briar_project_members project_membership
          on project_membership.project_id = project.id
         and project_membership.organization_id = project.organization_id
         and project_membership.user_id = membership.user_id
        where project.organization_id = ${organizationId}
          and (
            membership.role in ('owner', 'co-owner')
            or project_membership.user_id is not null
          )
        order by project.created_at, project.id
      `,
  });

  return {
    findOrganizationInboxTeams,
    findOrganizationTeams,
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

const listOrganizationTeamsEffect = Effect.fn(
  "listOrganizationTeamsEffect",
)(function*(organizationId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = teamQueries(sql);
  return yield* queries.findOrganizationTeams({ scopeId: organizationId });
});

const listOrganizationInboxTeamsEffect = Effect.fn(
  "listOrganizationInboxTeamsEffect",
)(function*(organizationId: string, userId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = teamQueries(sql);
  return yield* queries.findOrganizationInboxTeams({
    organizationId,
    userId,
  });
});

export const listTeams = (
  db: D1Database,
  userId: string,
): Promise<Array<TeamRow>> => runD1(db, listTeamsEffect(userId));

export const listOrganizationTeams = (
  db: D1Database,
  organizationId: string,
): Promise<Array<TeamRow>> =>
  runD1(db, listOrganizationTeamsEffect(organizationId));

export const listOrganizationInboxTeams = (
  db: D1Database,
  organizationId: string,
  userId: string,
): Promise<Array<Pick<TeamRow, "id" | "name" | "issue_key_prefix">>> =>
  runD1(db, listOrganizationInboxTeamsEffect(organizationId, userId));
