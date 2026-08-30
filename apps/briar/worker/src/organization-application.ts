import {
  decodeOrganizationHandle,
  decodeOrganizationInput,
  decodeOrganizationInvitationInput,
  decodeOrganizationInvitationToken,
  decodeOrganizationLogoInput,
  decodeOrganizationMemberProjectsInput,
  decodeOrganizationMemberRoleInput,
  decodeOrganizationUpdateInput,
} from "./account-organization-request-contract";
import { sha256 } from "./crypto-digest";
import { hasOrganizationCapability } from "./organization-access";
import {
  acceptOrganizationInvitation,
  createOrganization,
  createOrganizationInvitation,
  isOrganizationHandleAvailable,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganization,
  updateOrganizationLogo,
  updateOrganizationMemberProjects,
  updateOrganizationMemberRole,
} from "./organization-command-repository";
import {
  getOrganizationInvitationByTokenHash,
  getOrganizationRole,
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizationProjectMemberships,
  listOrganizations,
} from "./organization-repository";
import { decodeRequestSync } from "./request-schema";
import { trimmedText, UuidString } from "./schema-codecs";

const organizationInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000;
const decodeOrganizationId = decodeRequestSync(UuidString);
const decodeInvitationId = decodeRequestSync(UuidString);
const decodeMemberId = decodeRequestSync(trimmedText(1, 128));

export type OrganizationApplicationErrorReason =
  | "already_member"
  | "invitation_email_mismatch"
  | "invitation_expired"
  | "invitation_management_required"
  | "invitation_not_found"
  | "invitation_project_not_found"
  | "invitation_revoked"
  | "member_management_required"
  | "member_not_found"
  | "organization_handle_conflict"
  | "organization_management_required"
  | "organization_not_found"
  | "owner_role_immutable"
  | "project_not_in_organization"
  | "role_has_full_access"
  | "self_role_change";

export class OrganizationApplicationError extends Error {
  readonly name = "OrganizationApplicationError";

  constructor(
    readonly reason: OrganizationApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type OrganizationApplicationUser = {
  readonly id: string;
  readonly email: string;
};

export type OrganizationApplicationServices = {
  readonly acceptInvitation: typeof acceptOrganizationInvitation;
  readonly createInvitation: typeof createOrganizationInvitation;
  readonly createOrganization: typeof createOrganization;
  readonly getInvitationByTokenHash: typeof getOrganizationInvitationByTokenHash;
  readonly getRole: typeof getOrganizationRole;
  readonly isHandleAvailable: typeof isOrganizationHandleAvailable;
  readonly listInvitations: typeof listOrganizationInvitations;
  readonly listMembers: typeof listOrganizationMembers;
  readonly listOrganizations: typeof listOrganizations;
  readonly listProjectMemberships: typeof listOrganizationProjectMemberships;
  readonly removeMember: typeof removeOrganizationMember;
  readonly revokeInvitation: typeof revokeOrganizationInvitation;
  readonly updateLogo: typeof updateOrganizationLogo;
  readonly updateMemberProjects: typeof updateOrganizationMemberProjects;
  readonly updateMemberRole: typeof updateOrganizationMemberRole;
  readonly updateOrganization: typeof updateOrganization;
};

export const organizationApplicationServices: OrganizationApplicationServices = {
  acceptInvitation: acceptOrganizationInvitation,
  createInvitation: createOrganizationInvitation,
  createOrganization,
  getInvitationByTokenHash: getOrganizationInvitationByTokenHash,
  getRole: getOrganizationRole,
  isHandleAvailable: isOrganizationHandleAvailable,
  listInvitations: listOrganizationInvitations,
  listMembers: listOrganizationMembers,
  listOrganizations,
  listProjectMemberships: listOrganizationProjectMemberships,
  removeMember: removeOrganizationMember,
  revokeInvitation: revokeOrganizationInvitation,
  updateLogo: updateOrganizationLogo,
  updateMemberProjects: updateOrganizationMemberProjects,
  updateMemberRole: updateOrganizationMemberRole,
  updateOrganization,
};

const requireCapability = async (
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly capability:
      | "organization:read"
      | "organization:update"
      | "invitations:manage"
      | "members:manage";
  },
  services: OrganizationApplicationServices,
) => {
  const role = await services.getRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (hasOrganizationCapability(role, input.capability)) return role!;
  switch (input.capability) {
    case "organization:read":
      throw new OrganizationApplicationError(
        "organization_not_found",
        "Organization not found",
      );
    case "organization:update":
      throw new OrganizationApplicationError(
        "organization_management_required",
        "Organization management permission required",
      );
    case "invitations:manage":
      throw new OrganizationApplicationError(
        "invitation_management_required",
        "Invitation management permission required",
      );
    case "members:manage":
      throw new OrganizationApplicationError(
        "member_management_required",
        "Member management permission required",
      );
  }
};

const listMemberViews = async (
  db: D1Database,
  organizationId: string,
  services: OrganizationApplicationServices,
) => {
  const [members, memberships] = await Promise.all([
    services.listMembers(db, organizationId),
    services.listProjectMemberships(db, organizationId),
  ]);
  const projectIdsByUser = new Map<string, string[]>();
  for (const membership of memberships) {
    const projectIds = projectIdsByUser.get(membership.user_id) ?? [];
    projectIds.push(membership.project_id);
    projectIdsByUser.set(membership.user_id, projectIds);
  }
  return members.map((member) => ({
    member,
    projectIds: projectIdsByUser.get(member.user_id) ?? [],
  }));
};

export async function listOrganizationsApplication(
  input: { readonly db: D1Database; readonly userId: string },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  return services.listOrganizations(input.db, input.userId);
}

export async function createOrganizationApplication(
  input: {
    readonly db: D1Database;
    readonly userId: string;
    readonly name: string;
    readonly handle: string;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const decoded = decodeOrganizationInput({
    name: input.name,
    handle: input.handle,
  });
  if (!(await services.isHandleAvailable(input.db, decoded.handle))) {
    throw new OrganizationApplicationError(
      "organization_handle_conflict",
      "Organization handle already exists",
    );
  }
  try {
    return await services.createOrganization(input.db, {
      ...decoded,
      ownerUserId: input.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") && message.includes("handle")) {
      throw new OrganizationApplicationError(
        "organization_handle_conflict",
        "Organization handle already exists",
      );
    }
    throw error;
  }
}

export async function checkOrganizationHandleAvailabilityApplication(
  input: { readonly db: D1Database; readonly handle: string },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const handle = decodeOrganizationHandle(input.handle);
  return services.isHandleAvailable(input.db, handle);
}

export async function updateOrganizationApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly name: string;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  const { name } = decodeOrganizationUpdateInput({ name: input.name });
  const role = await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "organization:update",
  }, services);
  const organization = await services.updateOrganization(
    input.db,
    organizationId,
    name,
    role,
  );
  if (!organization) {
    throw new OrganizationApplicationError(
      "organization_not_found",
      "Organization not found",
    );
  }
  return organization;
}

export async function updateOrganizationLogoApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly logo: string | null;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  const { logo } = decodeOrganizationLogoInput({ logo: input.logo });
  const role = await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "organization:update",
  }, services);
  const organization = await services.updateLogo(
    input.db,
    organizationId,
    logo,
    role,
  );
  if (!organization) {
    throw new OrganizationApplicationError(
      "organization_not_found",
      "Organization not found",
    );
  }
  return organization;
}

export async function listOrganizationInvitationsApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "invitations:manage",
  }, services);
  return services.listInvitations(input.db, organizationId);
}

export async function createOrganizationInvitationApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly email: string;
    readonly role: unknown;
    readonly initialProjectId: string;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  const { role } = decodeOrganizationMemberRoleInput({ role: input.role });
  const decoded = decodeOrganizationInvitationInput({
    email: input.email,
    role,
    initialProjectId: input.initialProjectId,
  });
  await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "invitations:manage",
  }, services);
  const token =
    `briar_invite_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const createdAt = new Date().toISOString();
  const result = await services.createInvitation(input.db, {
    id: crypto.randomUUID(),
    organizationId,
    initialProjectId: decoded.initialProjectId,
    emailNormalized: decoded.email,
    role: decoded.role,
    tokenHash: await sha256(token),
    invitedByUserId: input.userId,
    expiresAt: new Date(Date.now() + organizationInvitationTtlMs).toISOString(),
    createdAt,
  });
  if (result.outcome === "project_not_found") {
    throw new OrganizationApplicationError(
      "invitation_project_not_found",
      "Invitation project not found",
    );
  }
  if (result.outcome === "already_member") {
    throw new OrganizationApplicationError(
      "already_member",
      "A member with that email already belongs to this organization",
    );
  }
  return {
    invitation: result.invitation,
    invitePath: `/app/invitations/${token}`,
    observedAt: createdAt,
  };
}

export async function revokeOrganizationInvitationApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly invitationId: string;
    readonly userId: string;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  const invitationId = decodeInvitationId(input.invitationId);
  await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "invitations:manage",
  }, services);
  if (
    !(await services.revokeInvitation(
      input.db,
      organizationId,
      invitationId,
      new Date().toISOString(),
    ))
  ) {
    throw new OrganizationApplicationError(
      "invitation_not_found",
      "Pending invitation not found",
    );
  }
}

export async function getOrganizationInvitationApplication(
  input: { readonly db: D1Database; readonly token: string },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const token = decodeOrganizationInvitationToken(input.token);
  const observedAt = new Date().toISOString();
  const invitation = await services.getInvitationByTokenHash(
    input.db,
    await sha256(token),
  );
  if (!invitation) {
    throw new OrganizationApplicationError(
      "invitation_not_found",
      "Invitation not found",
    );
  }
  return { invitation, observedAt };
}

export async function acceptOrganizationInvitationApplication(
  input: {
    readonly db: D1Database;
    readonly token: string;
    readonly user: OrganizationApplicationUser;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const token = decodeOrganizationInvitationToken(input.token);
  const acceptedAt = new Date().toISOString();
  const result = await services.acceptInvitation(input.db, {
    tokenHash: await sha256(token),
    userId: input.user.id,
    emailNormalized: input.user.email.trim().toLowerCase(),
    acceptedAt,
  });
  switch (result.outcome) {
    case "accepted":
    case "already_accepted":
      return {
        invitation: result.invitation,
        alreadyAccepted: result.outcome === "already_accepted",
        observedAt: acceptedAt,
      };
    case "email_mismatch":
      throw new OrganizationApplicationError(
        "invitation_email_mismatch",
        "Sign in with the email address that matches this invitation",
      );
    case "expired":
      throw new OrganizationApplicationError(
        "invitation_expired",
        "Invitation expired",
      );
    case "revoked":
      throw new OrganizationApplicationError(
        "invitation_revoked",
        "Invitation revoked",
      );
    case "invalid":
      throw new OrganizationApplicationError(
        "invitation_not_found",
        "Invitation not found",
      );
  }
}

export async function listOrganizationMembersApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "organization:read",
  }, services);
  return listMemberViews(input.db, organizationId, services);
}

export async function updateOrganizationMemberRoleApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly memberId: string;
    readonly role: unknown;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  const memberId = decodeMemberId(input.memberId);
  const { role } = decodeOrganizationMemberRoleInput({ role: input.role });
  await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "members:manage",
  }, services);
  if (memberId === input.userId) {
    throw new OrganizationApplicationError(
      "self_role_change",
      "You cannot change your own organization role",
    );
  }
  const currentRole = await services.getRole(input.db, organizationId, memberId);
  if (!currentRole) {
    throw new OrganizationApplicationError("member_not_found", "Member not found");
  }
  if (currentRole === "owner") {
    throw new OrganizationApplicationError(
      "owner_role_immutable",
      "Organization owner role cannot be changed",
    );
  }
  if (
    !(await services.updateMemberRole(
      input.db,
      organizationId,
      memberId,
      role,
    ))
  ) {
    throw new OrganizationApplicationError("member_not_found", "Member not found");
  }
  return listMemberViews(input.db, organizationId, services);
}

export async function updateOrganizationMemberProjectsApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly memberId: string;
    readonly projectIds: readonly string[];
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  const memberId = decodeMemberId(input.memberId);
  await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "members:manage",
  }, services);
  const { projectIds } = decodeOrganizationMemberProjectsInput({
    projectIds: [...input.projectIds],
  });
  const outcome = await services.updateMemberProjects(
    input.db,
    organizationId,
    memberId,
    projectIds,
  );
  switch (outcome) {
    case "updated":
      return listMemberViews(input.db, organizationId, services);
    case "member_not_found":
      throw new OrganizationApplicationError("member_not_found", "Member not found");
    case "role_has_full_access":
      throw new OrganizationApplicationError(
        "role_has_full_access",
        "Organization owners and co-owners always have access to every project",
      );
    case "project_not_found":
      throw new OrganizationApplicationError(
        "project_not_in_organization",
        "Every project must belong to the organization",
      );
  }
}

export async function removeOrganizationMemberApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly memberId: string;
  },
  services: OrganizationApplicationServices = organizationApplicationServices,
) {
  const organizationId = decodeOrganizationId(input.organizationId);
  const memberId = decodeMemberId(input.memberId);
  await requireCapability({
    db: input.db,
    organizationId,
    userId: input.userId,
    capability: "members:manage",
  }, services);
  if (!(await services.removeMember(input.db, organizationId, memberId))) {
    throw new OrganizationApplicationError("member_not_found", "Member not found");
  }
}
