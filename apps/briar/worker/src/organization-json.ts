import type {
  OrganizationInvitationRow,
  OrganizationMemberRow,
  OrganizationRow,
} from "./organization-repository";

export const organizationJson = (row: OrganizationRow) => ({
  id: row.id,
  name: row.name,
  handle: row.handle,
  logo: row.logo,
  role: row.role,
  createdAt: row.created_at,
});

export const organizationMemberJson = (
  row: OrganizationMemberRow,
  projectIds?: readonly string[],
) => ({
  userId: row.user_id,
  name: row.name,
  email: row.email,
  image: row.image,
  role: row.role,
  createdAt: row.created_at,
  ...(projectIds === undefined ? {} : { projectIds: [...projectIds] }),
});

const organizationInvitationStatus = (
  row: OrganizationInvitationRow,
  observedAt: string,
) =>
  row.revoked_at
    ? "revoked"
    : row.accepted_at
      ? "accepted"
      : row.expires_at <= observedAt
        ? "expired"
        : "pending";

const maskInvitationEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1) || "*"}***@${domain}`;
};

export const organizationInvitationJson = (
  row: OrganizationInvitationRow,
  observedAt = new Date().toISOString(),
) => ({
  id: row.id,
  organizationId: row.organization_id,
  organizationName: row.organization_name,
  initialProjectId: row.initial_project_id,
  initialProjectName: row.initial_project_name,
  email: row.email_normalized,
  emailHint: maskInvitationEmail(row.email_normalized),
  role: row.role,
  status: organizationInvitationStatus(row, observedAt),
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  createdAt: row.created_at,
});

export const publicOrganizationInvitationJson = (
  row: OrganizationInvitationRow,
  observedAt = new Date().toISOString(),
) => {
  const invitation = organizationInvitationJson(row, observedAt);
  const { email: _email, ...publicInvitation } = invitation;
  return publicInvitation;
};
