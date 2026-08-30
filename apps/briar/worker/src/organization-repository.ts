import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { createSqlQueryCache } from "./sql-query-cache";

export const OrganizationRole = Schema.Literals([
  "owner",
  "co-owner",
  "developer",
  "editor",
  "viewer",
]);
export type OrganizationRole = typeof OrganizationRole.Type;

export const OrganizationAssignableRole = Schema.Literals([
  "co-owner",
  "developer",
  "editor",
  "viewer",
]);
export type OrganizationAssignableRole =
  typeof OrganizationAssignableRole.Type;

const OrganizationInvitationRole = OrganizationAssignableRole;

const OrganizationRow = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  name: Schema.mutableKey(Schema.String),
  handle: Schema.mutableKey(Schema.String),
  logo: Schema.mutableKey(Schema.NullOr(Schema.String)),
  role: Schema.mutableKey(OrganizationRole),
  created_at: Schema.mutableKey(Schema.String),
});
export type OrganizationRow = typeof OrganizationRow.Type;

const OrganizationMemberRow = Schema.Struct({
  user_id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: OrganizationRole,
  created_at: Schema.String,
});
export type OrganizationMemberRow = typeof OrganizationMemberRow.Type;

const OrganizationProjectMembershipRow = Schema.Struct({
  user_id: Schema.String,
  project_id: Schema.String,
});
export type OrganizationProjectMembershipRow =
  typeof OrganizationProjectMembershipRow.Type;

const OrganizationInvitationRow = Schema.Struct({
  id: Schema.String,
  organization_id: Schema.String,
  organization_name: Schema.String,
  initial_project_id: Schema.String,
  initial_project_name: Schema.String,
  email_normalized: Schema.String,
  role: OrganizationInvitationRole,
  invited_by_user_id: Schema.NullOr(Schema.String),
  expires_at: Schema.String,
  accepted_at: Schema.NullOr(Schema.String),
  accepted_by_user_id: Schema.NullOr(Schema.String),
  revoked_at: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type OrganizationInvitationRow =
  typeof OrganizationInvitationRow.Type;

const ListOrganizationsRequest = Schema.Struct({ userId: Schema.String });
const OrganizationRequest = Schema.Struct({ organizationId: Schema.String });
const ProjectRequest = Schema.Struct({ projectId: Schema.String });
const OrganizationMemberRequest = Schema.Struct({
  organizationId: Schema.String,
  userId: Schema.String,
});
const InvitationRequest = Schema.Struct({ invitationId: Schema.String });
const InvitationTokenRequest = Schema.Struct({ tokenHash: Schema.String });

const makeOrganizationQueries = (sql: SqlClient.SqlClient) => {
  const organizationInvitationSelect = sql`
    select invitation.id, invitation.organization_id,
           organization.name as organization_name,
           invitation.initial_project_id,
           project.name as initial_project_name,
           invitation.email_normalized, invitation.role,
           invitation.invited_by_user_id, invitation.expires_at,
           invitation.accepted_at, invitation.accepted_by_user_id,
           invitation.revoked_at, invitation.created_at, invitation.updated_at
    from briar_organization_invitations invitation
    join briar_organizations organization
      on organization.id = invitation.organization_id
    join briar_projects project
      on project.id = invitation.initial_project_id
     and project.organization_id = invitation.organization_id
  `;

  const findOrganizations = SqlSchema.findAll({
    Request: ListOrganizationsRequest,
    Result: OrganizationRow,
    execute: ({ userId }) => sql`
        select organization.id, organization.name, organization.handle,
               coalesce(organization.logo_data_url, organization.logo) as logo,
               membership.role,
               organization.created_at
        from briar_organizations organization
        join briar_organization_members membership
          on membership.organization_id = organization.id
        where membership.user_id = ${userId}
        order by organization.created_at, organization.id
      `,
  });

  const findOrganizationRole = SqlSchema.findOneOption({
    Request: OrganizationMemberRequest,
    Result: Schema.Struct({ role: OrganizationRole }),
    execute: ({ organizationId, userId }) => sql`
      select role
      from briar_organization_members
      where organization_id = ${organizationId} and user_id = ${userId}
    `,
  });

  const findOrganizationMembers = SqlSchema.findAll({
    Request: OrganizationRequest,
    Result: OrganizationMemberRow,
    execute: ({ organizationId }) => sql`
      select member.user_id, user.name, user.email, user.image,
             member.role, member.created_at
      from briar_organization_members member
      join "user" on user.id = member.user_id
      where member.organization_id = ${organizationId}
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

  const findOrganizationProjectMemberships = SqlSchema.findAll({
    Request: OrganizationRequest,
    Result: OrganizationProjectMembershipRow,
    execute: ({ organizationId }) => sql`
      select user_id, project_id
      from briar_project_members
      where organization_id = ${organizationId}
      order by user_id, project_id
    `,
  });

  const findProjectMembers = SqlSchema.findAll({
    Request: ProjectRequest,
    Result: OrganizationMemberRow,
    execute: ({ projectId }) => sql`
      select member.user_id, user.name, user.email, user.image,
             member.role, member.created_at
      from briar_projects project
      join briar_organization_members member
        on member.organization_id = project.organization_id
      join "user" on user.id = member.user_id
      left join briar_project_members project_membership
        on project_membership.project_id = project.id
       and project_membership.organization_id = project.organization_id
       and project_membership.user_id = member.user_id
      where project.id = ${projectId}
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

  const findOrganizationInvitations = SqlSchema.findAll({
    Request: OrganizationRequest,
    Result: OrganizationInvitationRow,
    execute: ({ organizationId }) => sql`
      ${organizationInvitationSelect}
      where invitation.organization_id = ${organizationId}
        and invitation.accepted_at is null
        and invitation.revoked_at is null
      order by invitation.created_at desc, invitation.id
    `,
  });

  const findOrganizationInvitationById = SqlSchema.findOneOption({
    Request: InvitationRequest,
    Result: OrganizationInvitationRow,
    execute: ({ invitationId }) => sql`
      ${organizationInvitationSelect}
      where invitation.id = ${invitationId}
    `,
  });

  const findOrganizationInvitationByTokenHash = SqlSchema.findOneOption({
    Request: InvitationTokenRequest,
    Result: OrganizationInvitationRow,
    execute: ({ tokenHash }) => sql`
      ${organizationInvitationSelect}
      where invitation.token_hash = ${tokenHash}
    `,
  });

  return {
    findOrganizationInvitationById,
    findOrganizationInvitationByTokenHash,
    findOrganizationInvitations,
    findOrganizationMembers,
    findOrganizationProjectMemberships,
    findOrganizationRole,
    findOrganizations,
    findProjectMembers,
  };
};
const organizationQueries = createSqlQueryCache(makeOrganizationQueries);

const listOrganizationsEffect = Effect.fn("listOrganizationsEffect")(
  function*(userId: string) {
    const sql = yield* SqlClient.SqlClient;
    const queries = organizationQueries(sql);
    return yield* queries.findOrganizations({ userId });
  },
);

const getOrganizationRoleEffect = Effect.fn("getOrganizationRoleEffect")(
  function*(organizationId: string, userId: string) {
    const sql = yield* SqlClient.SqlClient;
    const queries = organizationQueries(sql);
    const row = yield* queries.findOrganizationRole({ organizationId, userId });
    return Option.match(row, {
      onNone: () => null,
      onSome: ({ role }) => role,
    });
  },
);

const listOrganizationProjectMembershipsEffect = Effect.fn(
  "listOrganizationProjectMembershipsEffect",
)(function*(organizationId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return yield* queries.findOrganizationProjectMemberships({ organizationId });
});

const listProjectMembersEffect = Effect.fn("listProjectMembersEffect")(
  function*(projectId: string) {
    const sql = yield* SqlClient.SqlClient;
    const queries = organizationQueries(sql);
    return yield* queries.findProjectMembers({ projectId });
  },
);

const listOrganizationMembersEffect = Effect.fn(
  "listOrganizationMembersEffect",
)(function*(organizationId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return yield* queries.findOrganizationMembers({ organizationId });
});

const listOrganizationInvitationsEffect = Effect.fn(
  "listOrganizationInvitationsEffect",
)(function*(organizationId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return yield* queries.findOrganizationInvitations({ organizationId });
});

const getOrganizationInvitationByIdEffect = Effect.fn(
  "getOrganizationInvitationByIdEffect",
)(function*(invitationId: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return Option.getOrNull(
    yield* queries.findOrganizationInvitationById({ invitationId }),
  );
});

const getOrganizationInvitationByTokenHashEffect = Effect.fn(
  "getOrganizationInvitationByTokenHashEffect",
)(function*(tokenHash: string) {
  const sql = yield* SqlClient.SqlClient;
  const queries = organizationQueries(sql);
  return Option.getOrNull(
    yield* queries.findOrganizationInvitationByTokenHash({ tokenHash }),
  );
});

export const listOrganizations = (
  db: D1Database,
  userId: string,
): Promise<Array<OrganizationRow>> =>
  runD1(db, listOrganizationsEffect(userId));

export const getOrganizationRole = (
  db: D1Database,
  organizationId: string,
  userId: string,
): Promise<OrganizationRole | null> =>
  runD1(db, getOrganizationRoleEffect(organizationId, userId));

export const listOrganizationMembers = (
  db: D1Database,
  organizationId: string,
): Promise<Array<OrganizationMemberRow>> =>
  runD1(db, listOrganizationMembersEffect(organizationId));

export const listOrganizationProjectMemberships = (
  db: D1Database,
  organizationId: string,
): Promise<Array<OrganizationProjectMembershipRow>> =>
  runD1(db, listOrganizationProjectMembershipsEffect(organizationId));

export const listProjectMembers = (
  db: D1Database,
  projectId: string,
): Promise<Array<OrganizationMemberRow>> =>
  runD1(db, listProjectMembersEffect(projectId));

export const listOrganizationInvitations = (
  db: D1Database,
  organizationId: string,
): Promise<Array<OrganizationInvitationRow>> =>
  runD1(db, listOrganizationInvitationsEffect(organizationId));

export const getOrganizationInvitationById = (
  db: D1Database,
  invitationId: string,
): Promise<OrganizationInvitationRow | null> =>
  runD1(db, getOrganizationInvitationByIdEffect(invitationId));

export const getOrganizationInvitationByTokenHash = (
  db: D1Database,
  tokenHash: string,
): Promise<OrganizationInvitationRow | null> =>
  runD1(db, getOrganizationInvitationByTokenHashEffect(tokenHash));
