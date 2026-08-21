import {
  getOrganizationInvitationById,
  getOrganizationInvitationByTokenHash,
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
  role: Exclude<OrganizationRole, "owner">,
) {
  const user = await db
    .prepare(`select id from "user" where lower(email) = lower(?)`)
    .bind(email)
    .first<{ id: string }>();
  if (!user) return null;
  const now = new Date().toISOString();
  await db
    .prepare(
      `insert into briar_organization_members
       (organization_id, user_id, role, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(organization_id, user_id) do update set
       role = excluded.role, updated_at = excluded.updated_at
     where briar_organization_members.role != 'owner'`,
    )
    .bind(organizationId, user.id, role, now, now)
    .run();
  return user.id;
}

export async function createOrganizationInvitation(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    initialProjectId: string;
    emailNormalized: string;
    role: Exclude<OrganizationRole, "owner">;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  const [project, existingMember] = await Promise.all([
    db
      .prepare(
        `select id from briar_projects
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
  role: Exclude<OrganizationRole, "owner">,
) {
  const result = await db
    .prepare(
      `update briar_organization_members
       set role = ?, updated_at = ?
       where organization_id = ? and user_id = ? and role != 'owner'`,
    )
    .bind(role, new Date().toISOString(), organizationId, userId)
    .run();
  return result.meta.changes > 0;
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
             select id from briar_projects where organization_id = ?
           )
           and exists (
             select 1 from briar_organization_members
             where organization_id = ? and user_id = ? and role != 'owner'
           )`,
      )
      .bind(updatedAt, userId, organizationId, organizationId, userId),
    db
      .prepare(
        `delete from briar_organization_members
         where organization_id = ? and user_id = ? and role != 'owner'`,
      )
      .bind(organizationId, userId),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0;
}
