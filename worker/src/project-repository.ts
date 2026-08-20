import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { OrganizationRole } from "./organization-repository";

const ProjectRow = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  name: Schema.mutableKey(Schema.String),
  issue_key_prefix: Schema.mutableKey(Schema.String),
  schedule_tab_enabled: Schema.mutableKey(Schema.Int),
  icon: Schema.mutableKey(Schema.NullOr(Schema.String)),
  organization_id: Schema.mutableKey(Schema.String),
  organization_name: Schema.mutableKey(Schema.String),
  member_role: Schema.mutableKey(OrganizationRole),
  created_at: Schema.mutableKey(Schema.String),
});
export type ProjectRow = typeof ProjectRow.Type;

const ProjectListRequest = Schema.Struct({ scopeId: Schema.String });

const findProjects = SqlSchema.findAll({
  Request: ProjectListRequest,
  Result: ProjectRow,
  execute: ({ scopeId: userId }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select project.id, project.name,
               project.issue_key_prefix,
               project.schedule_tab_enabled,
               coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
               project.organization_id,
               organization.name as organization_name,
               membership.role as member_role, project.created_at
        from briar_projects project
        join briar_organizations organization
          on organization.id = project.organization_id
        join briar_organization_members membership
          on membership.organization_id = project.organization_id
         and membership.user_id = ${userId}
        order by organization.created_at, project.created_at
      `,
    ),
});

const findOrganizationProjects = SqlSchema.findAll({
  Request: ProjectListRequest,
  Result: ProjectRow,
  execute: ({ scopeId: organizationId }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select project.id, project.name,
               project.issue_key_prefix,
               project.schedule_tab_enabled,
               coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
               project.organization_id,
               organization.name as organization_name,
               'member' as member_role, project.created_at
        from briar_projects project
        join briar_organizations organization
          on organization.id = project.organization_id
        where project.organization_id = ${organizationId}
        order by project.created_at
      `,
    ),
});

const InboxProjectRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  issue_key_prefix: Schema.String,
});

const findOrganizationInboxProjects = SqlSchema.findAll({
  Request: ProjectListRequest,
  Result: InboxProjectRow,
  execute: ({ scopeId: organizationId }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select id, name, issue_key_prefix
        from briar_projects
        where organization_id = ${organizationId}
        order by created_at, id
      `,
    ),
});

const listProjectsEffect = Effect.fn("listProjectsEffect")(
  function*(userId: string) {
    return yield* findProjects({ scopeId: userId });
  },
);

const listOrganizationProjectsEffect = Effect.fn(
  "listOrganizationProjectsEffect",
)(function*(organizationId: string) {
  return yield* findOrganizationProjects({ scopeId: organizationId });
});

const listOrganizationInboxProjectsEffect = Effect.fn(
  "listOrganizationInboxProjectsEffect",
)(function*(organizationId: string) {
  return yield* findOrganizationInboxProjects({ scopeId: organizationId });
});

export const listProjects = (
  db: D1Database,
  userId: string,
): Promise<Array<ProjectRow>> => runD1(db, listProjectsEffect(userId));

export const listOrganizationProjects = (
  db: D1Database,
  organizationId: string,
): Promise<Array<ProjectRow>> =>
  runD1(db, listOrganizationProjectsEffect(organizationId));

export const listOrganizationInboxProjects = (
  db: D1Database,
  organizationId: string,
): Promise<Array<Pick<ProjectRow, "id" | "name" | "issue_key_prefix">>> =>
  runD1(db, listOrganizationInboxProjectsEffect(organizationId));
