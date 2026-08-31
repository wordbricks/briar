import {
  getOrganizationInvitationById,
  getOrganizationInvitationByTokenHash,
  type OrganizationAssignableRole,
  type OrganizationRole,
  type OrganizationInvitationRow,
  type OrganizationRow,
} from "./organization-repository";

export async function createOrganization(
  db: D1Database,
  input: { name: string; handle: string; ownerUserId: string },
) {
  const createdAt = new Date().toISOString();
  const organization: OrganizationRow = {
    id: crypto.randomUUID(),
    name: input.name,
    handle: input.handle,
    logo: null,
    role: "owner",
    created_at: createdAt,
  };
  await db.batch([
    db
      .prepare(
        `insert into briar_organizations
         (id, name, handle, created_at, updated_at)
       values (?, ?, ?, ?, ?)`,
      )
      .bind(
        organization.id,
        organization.name,
        organization.handle,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_organization_members
         (organization_id, user_id, role, created_at, updated_at)
       values (?, ?, 'owner', ?, ?)`,
      )
      .bind(organization.id, input.ownerUserId, createdAt, createdAt),
  ]);
  return organization;
}

export async function updateOrganization(
  db: D1Database,
  organizationId: string,
  name: string,
  role: OrganizationRole,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_organizations
       set name = ?, updated_at = ?
       where id = ?`,
    )
    .bind(name, updatedAt, organizationId)
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, name, handle, coalesce(logo_data_url, logo) as logo, created_at
       from briar_organizations
       where id = ?`,
    )
    .bind(organizationId)
    .first<Omit<OrganizationRow, "role">>()
    .then((organization) => (organization ? { ...organization, role } : null));
}

export async function updateOrganizationLogo(
  db: D1Database,
  organizationId: string,
  logo: string | null,
  role: OrganizationRole,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_organizations
       set logo_data_url = ?, logo = null, updated_at = ?
       where id = ?`,
    )
    .bind(logo, updatedAt, organizationId)
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, name, handle, coalesce(logo_data_url, logo) as logo, created_at
       from briar_organizations
       where id = ?`,
    )
    .bind(organizationId)
    .first<Omit<OrganizationRow, "role">>()
    .then((organization) => (organization ? { ...organization, role } : null));
}

export async function isOrganizationHandleAvailable(
  db: D1Database,
  handle: string,
) {
  const organization = await db
    .prepare(`select 1 as found from briar_organizations where handle = ?`)
    .bind(handle)
    .first<{ found: number }>();
  return organization === null;
}

export async function addOrganizationMember(
  db: D1Database,
  organizationId: string,
  email: string,
  role: OrganizationAssignableRole,
) {
  const user = await db
    .prepare(`select id from "user" where lower(email) = lower(?)`)
    .bind(email)
    .first<{ id: string }>();
  if (!user) return null;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `insert into briar_organization_members
       (organization_id, user_id, role, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(organization_id, user_id) do update set
       role = excluded.role, updated_at = excluded.updated_at
     where briar_organization_members.role != 'owner'`,
    )
      .bind(organizationId, user.id, role, now, now),
    db.prepare(
      `insert into briar_project_members (
         project_id, organization_id, user_id, created_at, updated_at
       )
       select project.id, project.organization_id, ?, ?, ?
       from briar_teams project
       join briar_organization_members member
         on member.organization_id = project.organization_id
        and member.user_id = ?
       where project.organization_id = ?
       on conflict (project_id, user_id) do nothing`,
    ).bind(user.id, now, now, user.id, organizationId),
  ]);
  return user.id;
}

export async function createOrganizationInvitation(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    initialProjectId: string;
    emailNormalized: string;
    role: OrganizationAssignableRole;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  const [project, existingMember] = await Promise.all([
    db
      .prepare(
        `select id from briar_teams
         where id = ? and organization_id = ?`,
      )
      .bind(input.initialProjectId, input.organizationId)
      .first<{ id: string }>(),
    db
      .prepare(
        `select member.user_id
         from briar_organization_members member
         join "user" on "user".id = member.user_id
         where member.organization_id = ? and lower("user".email) = ?`,
      )
      .bind(input.organizationId, input.emailNormalized)
      .first<{ user_id: string }>(),
  ]);
  if (!project) return { outcome: "project_not_found" as const };
  if (existingMember) return { outcome: "already_member" as const };

  await db.batch([
    db
      .prepare(
        `update briar_organization_invitations
         set revoked_at = ?, updated_at = ?
         where organization_id = ? and email_normalized = ?
           and accepted_at is null and revoked_at is null`,
      )
      .bind(
        input.createdAt,
        input.createdAt,
        input.organizationId,
        input.emailNormalized,
      ),
    db
      .prepare(
        `insert into briar_organization_invitations (
           id, organization_id, initial_project_id, email_normalized, role,
           token_hash, invited_by_user_id, expires_at, accepted_at,
           accepted_by_user_id, revoked_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, null, null, null, ?, ?)`,
      )
      .bind(
        input.id,
        input.organizationId,
        input.initialProjectId,
        input.emailNormalized,
        input.role,
        input.tokenHash,
        input.invitedByUserId,
        input.expiresAt,
        input.createdAt,
        input.createdAt,
      ),
  ]);
  const invitation = await getOrganizationInvitationById(db, input.id);
  return invitation
    ? { outcome: "created" as const, invitation }
    : { outcome: "project_not_found" as const };
}

export async function revokeOrganizationInvitation(
  db: D1Database,
  organizationId: string,
  invitationId: string,
  revokedAt: string,
) {
  const result = await db
    .prepare(
      `update briar_organization_invitations
       set revoked_at = ?, updated_at = ?
       where id = ? and organization_id = ?
         and accepted_at is null and revoked_at is null`,
    )
    .bind(revokedAt, revokedAt, invitationId, organizationId)
    .run();
  return result.meta.changes > 0;
}

export type AcceptOrganizationInvitationOutcome =
  | { outcome: "invalid" }
  | { outcome: "expired" }
  | { outcome: "revoked" }
  | { outcome: "email_mismatch" }
  | {
      outcome: "accepted" | "already_accepted";
      invitation: OrganizationInvitationRow;
    };

export async function acceptOrganizationInvitation(
  db: D1Database,
  input: {
    tokenHash: string;
    userId: string;
    emailNormalized: string;
    acceptedAt: string;
  },
): Promise<AcceptOrganizationInvitationOutcome> {
  const invitation = await getOrganizationInvitationByTokenHash(
    db,
    input.tokenHash,
  );
  if (!invitation) return { outcome: "invalid" };
  if (invitation.revoked_at) return { outcome: "revoked" };
  if (invitation.expires_at <= input.acceptedAt) return { outcome: "expired" };
  if (invitation.email_normalized !== input.emailNormalized) {
    return { outcome: "email_mismatch" };
  }
  if (invitation.accepted_at) {
    return invitation.accepted_by_user_id === input.userId
      ? { outcome: "already_accepted", invitation }
      : { outcome: "invalid" };
  }

  await db.batch([
    db
      .prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, ?, ?, ?)
         on conflict(organization_id, user_id) do update set
           role = excluded.role, updated_at = excluded.updated_at
         where briar_organization_members.role != 'owner'`,
      )
      .bind(
        invitation.organization_id,
        input.userId,
        invitation.role,
        input.acceptedAt,
        input.acceptedAt,
      ),
    db
      .prepare(
        `update briar_organization_invitations
         set accepted_at = ?, accepted_by_user_id = ?, updated_at = ?
         where token_hash = ? and accepted_at is null and revoked_at is null
           and expires_at > ?`,
      )
      .bind(
        input.acceptedAt,
        input.userId,
        input.acceptedAt,
        input.tokenHash,
        input.acceptedAt,
      ),
    db
      .prepare(
        `insert into briar_project_members (
           project_id, organization_id, user_id, created_at, updated_at
         )
         select project.id, project.organization_id, ?, ?, ?
         from briar_teams project
         join briar_organization_members member
           on member.organization_id = project.organization_id
          and member.user_id = ?
         where project.id = ? and project.organization_id = ?
         on conflict (project_id, user_id) do nothing`,
      )
      .bind(
        input.userId,
        input.acceptedAt,
        input.acceptedAt,
        input.userId,
        invitation.initial_project_id,
        invitation.organization_id,
      ),
  ]);
  const accepted = await getOrganizationInvitationByTokenHash(
    db,
    input.tokenHash,
  );
  if (!accepted?.accepted_at || accepted.accepted_by_user_id !== input.userId) {
    return { outcome: "invalid" };
  }
  return { outcome: "accepted", invitation: accepted };
}

export async function updateOrganizationMemberRole(
  db: D1Database,
  organizationId: string,
  userId: string,
  role: OrganizationAssignableRole,
) {
  const updatedAt = new Date().toISOString();
  const updateRoleStatement = db.prepare(
    `update briar_organization_members
     set role = ?, updated_at = ?
     where organization_id = ? and user_id = ? and role != 'owner'`,
  ).bind(role, updatedAt, organizationId, userId);
  const statements: D1PreparedStatement[] = [];
  if (role !== "co-owner") {
    statements.push(
      db.prepare(
        `insert into briar_project_members (
           project_id, organization_id, user_id, created_at, updated_at
         )
         select project.id, project.organization_id, member.user_id, ?, ?
         from briar_teams project
         join briar_organization_members member
           on member.organization_id = project.organization_id
          and member.user_id = ?
         where project.organization_id = ?
           and member.role in ('owner', 'co-owner')
         on conflict (project_id, user_id) do nothing`,
      ).bind(updatedAt, updatedAt, userId, organizationId),
    );
  }
  statements.push(updateRoleStatement);
  const results = await db.batch(statements);
  return (results.at(-1)?.meta.changes ?? 0) > 0;
}

export type UpdateOrganizationMemberProjectsOutcome =
  | "updated"
  | "member_not_found"
  | "role_has_full_access"
  | "project_not_found";

export async function updateOrganizationMemberProjects(
  db: D1Database,
  organizationId: string,
  userId: string,
  projectIds: readonly string[],
): Promise<UpdateOrganizationMemberProjectsOutcome> {
  const uniqueProjectIds = [...new Set(projectIds)];
  const member = await db
    .prepare(
      `select role from briar_organization_members
       where organization_id = ? and user_id = ?`,
    )
    .bind(organizationId, userId)
    .first<{ role: OrganizationRole }>();
  if (!member) return "member_not_found";
  if (member.role === "owner" || member.role === "co-owner") {
    return "role_has_full_access";
  }

  if (uniqueProjectIds.length > 0) {
    const placeholders = uniqueProjectIds.map(() => "?").join(", ");
    const row = await db
      .prepare(
        `select count(*) as count
         from briar_teams
         where organization_id = ? and id in (${placeholders})`,
      )
      .bind(organizationId, ...uniqueProjectIds)
      .first<{ count: number }>();
    if (row?.count !== uniqueProjectIds.length) return "project_not_found";
  }

  const current = await db
    .prepare(
      `select project_id from briar_project_members
       where organization_id = ? and user_id = ?`,
    )
    .bind(organizationId, userId)
    .all<{ project_id: string }>();
  const currentIds = new Set(current.results.map((row) => row.project_id));
  const requestedIds = new Set(uniqueProjectIds);
  const removedIds = [...currentIds].filter((id) => !requestedIds.has(id));
  const addedIds = uniqueProjectIds.filter((id) => !currentIds.has(id));
  if (removedIds.length === 0 && addedIds.length === 0) return "updated";

  const updatedAt = new Date().toISOString();
  await db.batch([
    ...removedIds.map((projectId) =>
      db.prepare(
        `delete from briar_project_members
         where project_id = ? and organization_id = ? and user_id = ?`,
      ).bind(projectId, organizationId, userId)
    ),
    ...removedIds.map((projectId) =>
      db.prepare(
        `update briar_hunt_runs
         set assignee_user_id = null, updated_at = ?
         where project_id = ? and assignee_user_id = ?`,
      ).bind(updatedAt, projectId, userId)
    ),
    ...removedIds.map((projectId) =>
      db.prepare(
        `delete from briar_project_agent_tokens
         where project_id = ? and issued_to_user_id = ?`,
      ).bind(projectId, userId)
    ),
    ...addedIds.map((projectId) =>
      db.prepare(
        `insert into briar_project_members (
           project_id, organization_id, user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?)`,
      ).bind(projectId, organizationId, userId, updatedAt, updatedAt)
    ),
  ]);
  return "updated";
}

export async function removeOrganizationMember(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const updatedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `update briar_hunt_runs
         set assignee_user_id = null, updated_at = ?
         where assignee_user_id = ?
           and project_id in (
             select id from briar_teams where organization_id = ?
           )
           and exists (
             select 1 from briar_organization_members
             where organization_id = ? and user_id = ? and role != 'owner'
           )`,
      )
      .bind(updatedAt, userId, organizationId, organizationId, userId),
    db
      .prepare(
        `delete from briar_project_agent_tokens
         where issued_to_user_id = ?
           and project_id in (
             select id from briar_teams where organization_id = ?
           )
           and exists (
             select 1 from briar_organization_members
             where organization_id = ? and user_id = ? and role != 'owner'
           )`,
      )
      .bind(userId, organizationId, organizationId, userId),
    db
      .prepare(
        `delete from briar_organization_members
         where organization_id = ? and user_id = ? and role != 'owner'`,
      )
      .bind(organizationId, userId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}
