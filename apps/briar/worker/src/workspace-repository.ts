import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { createSqlQueryCache } from "./sql-query-cache";

export const WorkspaceRole = Schema.Literals([
  "owner",
  "co-owner",
  "developer",
  "editor",
  "viewer",
]);
export type WorkspaceRole = typeof WorkspaceRole.Type;

export const WorkspaceAssignableRole = Schema.Literals([
  "co-owner",
  "developer",
  "editor",
  "viewer",
]);
export type WorkspaceAssignableRole =
  typeof WorkspaceAssignableRole.Type;

const WorkspaceInvitationRole = WorkspaceAssignableRole;

const WorkspaceRow = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  name: Schema.mutableKey(Schema.String),
  handle: Schema.mutableKey(Schema.String),
  logo: Schema.mutableKey(Schema.NullOr(Schema.String)),
  role: Schema.mutableKey(WorkspaceRole),
  created_at: Schema.mutableKey(Schema.String),
});
export type WorkspaceRow = typeof WorkspaceRow.Type;

const WorkspaceMemberRow = Schema.Struct({
  user_id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: WorkspaceRole,
  created_at: Schema.String,
});
export type WorkspaceMemberRow = typeof WorkspaceMemberRow.Type;

const WorkspaceProjectMembershipRow = Schema.Struct({
  user_id: Schema.String,
  project_id: Schema.String,
});
export type WorkspaceProjectMembershipRow =
  typeof WorkspaceProjectMembershipRow.Type;

const WorkspaceInvitationRow = Schema.Struct({
  id: Schema.String,
  organization_id: Schema.String,
  organization_name: Schema.String,
  initial_project_id: Schema.String,
  initial_project_name: Schema.String,
  email_normalized: Schema.String,
  role: WorkspaceInvitationRole,
  invited_by_user_id: Schema.NullOr(Schema.String),
  expires_at: Schema.String,
  accepted_at: Schema.NullOr(Schema.String),
  accepted_by_user_id: Schema.NullOr(Schema.String),
  revoked_at: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type WorkspaceInvitationRow =
  typeof WorkspaceInvitationRow.Type;

const ListWorkspacesRequest = Schema.Struct({ userId: Schema.String });
const WorkspaceRequest = Schema.Struct({ workspaceId: Schema.String });
const ProjectRequest = Schema.Struct({ projectId: Schema.String });
const WorkspaceMemberRequest = Schema.Struct({
  workspaceId: Schema.String,
  userId: Schema.String,
});
const InvitationRequest = Schema.Struct({ invitationId: Schema.String });
const InvitationTokenRequest = Schema.Struct({ tokenHash: Schema.String });

const makeWorkspaceQueries = (sql: SqlClient.SqlClient) => {
  const organizationInvitationSelect = sql`
    select invitation.id, invitation.organization_id,
           workspace.name as organization_name,
           invitation.initial_project_id,
           team.name as initial_project_name,
           invitation.email_normalized, invitation.role,
           invitation.invited_by_user_id, invitation.expires_at,
           invitation.accepted_at, invitation.accepted_by_user_id,
           invitation.revoked_at, invitation.created_at, invitation.updated_at
    from briar_organization_invitations invitation
    join briar_organizations workspace
      on workspace.id = invitation.organization_id
    join briar_teams team
      on team.id = invitation.initial_project_id
     and team.organization_id = invitation.organization_id
  `;

  const findWorkspaces = SqlSchema.findAll({
    Request: ListWorkspacesRequest,
    Result: WorkspaceRow,
    execute: ({ userId }) => sql`
        select workspace.id, workspace.name, workspace.handle,
               coalesce(workspace.logo_data_url, workspace.logo) as logo,
               membership.role,
               workspace.created_at
        from briar_organizations workspace
        join briar_organization_members membership
          on membership.organization_id = workspace.id
        where membership.user_id = ${userId}
        order by workspace.created_at, workspace.id
      `,
  });

  const findWorkspaceRole = SqlSchema.findOneOption({
    Request: WorkspaceMemberRequest,
    Result: Schema.Struct({ role: WorkspaceRole }),
    execute: ({ workspaceId, userId }) => sql`
      select role
      from briar_organization_members
      where organization_id = ${workspaceId} and user_id = ${userId}
    `,
  });

  const findWorkspaceMembers = SqlSchema.findAll({
    Request: WorkspaceRequest,
    Result: WorkspaceMemberRow,
    execute: ({ workspaceId }) => sql`
      select member.user_id, user.name, user.email, user.image,
             member.role, member.created_at
      from briar_organization_members member
      join "user" on user.id = member.user_id
      where member.organization_id = ${workspaceId}
      order by case member.role
                 when 'owner' then 0
                 when 'co-owner' then 1
                 when 'developer' then 2
                 when 'editor' then 3
                 else 4
               end,
               lower(user.name), lower(user.email)
    `,
  });

  const findWorkspaceProjectMemberships = SqlSchema.findAll({
    Request: WorkspaceRequest,
    Result: WorkspaceProjectMembershipRow,
    execute: ({ workspaceId }) => sql`
      select user_id, project_id
      from briar_project_members
      where organization_id = ${workspaceId}
      order by user_id, project_id
    `,
  });

  const findProjectMembers = SqlSchema.findAll({
    Request: ProjectRequest,
    Result: WorkspaceMemberRow,
    execute: ({ projectId }) => sql`
      select member.user_id, user.name, user.email, user.image,
             member.role, member.created_at
      from briar_teams team
      join briar_organization_members member
        on member.organization_id = team.organization_id
      join "user" on user.id = member.user_id
      left join briar_project_members project_membership
        on project_membership.project_id = team.id
       and project_membership.organization_id = team.organization_id
       and project_membership.user_id = member.user_id
      where team.id = ${projectId}
        and (
          member.role in ('owner', 'co-owner')
          or project_membership.user_id is not null
        )
      order by case member.role
                 when 'owner' then 0
                 when 'co-owner' then 1
                 when 'developer' then 2
                 when 'editor' then 3
                 else 4
               end,
               lower(user.name), lower(user.email)
    `,
  });

  const findWorkspaceInvitations = SqlSchema.findAll({
    Request: WorkspaceRequest,
    Result: WorkspaceInvitationRow,
    execute: ({ workspaceId }) => sql`
      ${organizationInvitationSelect}
      where invitation.organization_id = ${workspaceId}
        and invitation.accepted_at is null
        and invitation.revoked_at is null
      order by invitation.created_at desc, invitation.id
    `,
  });

  const findWorkspaceInvitationById = SqlSchema.findOneOption({
    Request: InvitationRequest,
    Result: WorkspaceInvitationRow,
    execute: ({ invitationId }) => sql`
      ${organizationInvitationSelect}
      where invitation.id = ${invitationId}
    `,
  });

  const findWorkspaceInvitationByTokenHash = SqlSchema.findOneOption({
    Request: InvitationTokenRequest,
    Result: WorkspaceInvitationRow,
    execute: ({ tokenHash }) => sql`
      ${organizationInvitationSelect}
      where invitation.token_hash = ${tokenHash}
    `,
  });

  return {
    findWorkspaceInvitationById,
    findWorkspaceInvitationByTokenHash,
    findWorkspaceInvitations,
    findWorkspaceMembers,
    findWorkspaceProjectMemberships,
    findWorkspaceRole,
    findWorkspaces,
    findProjectMembers,
  };
};
const organizationQueries = createSqlQueryCache(makeWorkspaceQueries);

const listWorkspacesEffect = Effect.fn("listWorkspacesEffect")(
  function*(userId: string) {
    const sql = yield* SqlClient.SqlClient;
    const queries = organizationQueries(sql);
    return yield* queries.findWorkspaces({ userId });
  },
);

const getWorkspaceRoleEffect = Effect.fn("getWorkspaceRoleEffect")(
  function*(workspaceId: string, userId: string) {
    const sql = yield* SqlClient.SqlClient;
    const queries = organizationQueries(sql);
    const row = yield* queries.findWorkspaceRole({ workspaceId, userId });
    return Option.match(row, {
      onNone: () => null,
      onSome: ({ role }) => role,
    });
  },
);

const listWorkspaceProjectMembershipsEffect = Effect.fn(
  "listWorkspaceProjectMembershipsEffect",
)(function*(workspaceId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return yield* queries.findWorkspaceProjectMemberships({ workspaceId });
});

const listProjectMembersEffect = Effect.fn("listProjectMembersEffect")(
  function*(projectId: string) {
    const sql = yield* SqlClient.SqlClient;
    const queries = organizationQueries(sql);
    return yield* queries.findProjectMembers({ projectId });
  },
);

const listWorkspaceMembersEffect = Effect.fn(
  "listWorkspaceMembersEffect",
)(function*(workspaceId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return yield* queries.findWorkspaceMembers({ workspaceId });
});

const listWorkspaceInvitationsEffect = Effect.fn(
  "listWorkspaceInvitationsEffect",
)(function*(workspaceId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return yield* queries.findWorkspaceInvitations({ workspaceId });
});

const getWorkspaceInvitationByIdEffect = Effect.fn(
  "getWorkspaceInvitationByIdEffect",
)(function*(invitationId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return Option.getOrNull(
    yield* queries.findWorkspaceInvitationById({ invitationId }),
  );
});

const getWorkspaceInvitationByTokenHashEffect = Effect.fn(
  "getWorkspaceInvitationByTokenHashEffect",
)(function*(tokenHash: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return Option.getOrNull(
    yield* queries.findWorkspaceInvitationByTokenHash({ tokenHash }),
  );
});

export const listWorkspaces = (
  db: D1Database,
  userId: string,
): Promise<Array<WorkspaceRow>> =>
  runD1(db, listWorkspacesEffect(userId));

export const getWorkspaceRole = (
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> =>
  runD1(db, getWorkspaceRoleEffect(workspaceId, userId));

export const listWorkspaceMembers = (
  db: D1Database,
  workspaceId: string,
): Promise<Array<WorkspaceMemberRow>> =>
  runD1(db, listWorkspaceMembersEffect(workspaceId));

export const listWorkspaceProjectMemberships = (
  db: D1Database,
  workspaceId: string,
): Promise<Array<WorkspaceProjectMembershipRow>> =>
  runD1(db, listWorkspaceProjectMembershipsEffect(workspaceId));

export const listProjectMembers = (
  db: D1Database,
  projectId: string,
): Promise<Array<WorkspaceMemberRow>> =>
  runD1(db, listProjectMembersEffect(projectId));

export const listWorkspaceInvitations = (
  db: D1Database,
  workspaceId: string,
): Promise<Array<WorkspaceInvitationRow>> =>
  runD1(db, listWorkspaceInvitationsEffect(workspaceId));

export const getWorkspaceInvitationById = (
  db: D1Database,
  invitationId: string,
): Promise<WorkspaceInvitationRow | null> =>
  runD1(db, getWorkspaceInvitationByIdEffect(invitationId));

export const getWorkspaceInvitationByTokenHash = (
  db: D1Database,
  tokenHash: string,
): Promise<WorkspaceInvitationRow | null> =>
  runD1(db, getWorkspaceInvitationByTokenHashEffect(tokenHash));
