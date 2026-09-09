import {
  decodeWorkspaceHandle,
  decodeWorkspaceInput,
  decodeWorkspaceInvitationInput,
  decodeWorkspaceInvitationToken,
  decodeWorkspaceLogoInput,
  decodeWorkspaceMemberProjectsInput,
  decodeWorkspaceMemberRoleInput,
  decodeWorkspaceUpdateInput,
} from "./account-workspace-request-contract";
import { sha256 } from "./crypto-digest";
import { hasWorkspaceCapability } from "./workspace-access";
import {
  acceptWorkspaceInvitation,
  createWorkspace,
  createWorkspaceInvitation,
  isWorkspaceHandleAvailable,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  updateWorkspace,
  updateWorkspaceLogo,
  updateWorkspaceMemberProjects,
  updateWorkspaceMemberRole,
} from "./workspace-command-repository";
import {
  getWorkspaceInvitationByTokenHash,
  getWorkspaceRole,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  listWorkspaceProjectMemberships,
  listWorkspaces,
} from "./workspace-repository";
import { decodeRequestSync } from "./request-schema";
import { trimmedText, UuidString } from "./schema-codecs";

/**
 * The Workspace application layer.
 *
 * "Workspace" is the product name for the top of the hierarchy. Storage and
 * protobuf still call the same value an workspace -- `briar_organizations`,
 * `organization_id`, `WorkspaceService` -- so the repository symbols this
 * module imports keep their storage names, and the `workspaceId` ->
 * `workspaceId` mapping happens once, at the Connect handler in
 * `app-connect-workspace.ts`.
 *
 * Not to be confused with a Slack workspace or a GitHub organization; those are
 * vendor concepts and keep their vendor names.
 */

const workspaceInvitationTtlMs = 7 * 24 * 60 * 60 * 1_000;
const decodeWorkspaceId = decodeRequestSync(UuidString);
const decodeInvitationId = decodeRequestSync(UuidString);
const decodeMemberId = decodeRequestSync(trimmedText(1, 128));

export type WorkspaceApplicationErrorReason =
  | "already_member"
  | "invitation_email_mismatch"
  | "invitation_expired"
  | "invitation_management_required"
  | "invitation_not_found"
  | "invitation_project_not_found"
  | "invitation_revoked"
  | "member_management_required"
  | "member_not_found"
  | "workspace_handle_conflict"
  | "workspace_management_required"
  | "workspace_not_found"
  | "owner_role_immutable"
  | "project_not_in_workspace"
  | "role_has_full_access"
  | "self_role_change";

export class WorkspaceApplicationError extends Error {
  readonly name = "WorkspaceApplicationError";

  constructor(
    readonly reason: WorkspaceApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type WorkspaceApplicationUser = {
  readonly id: string;
  readonly email: string;
};

export type WorkspaceApplicationServices = {
  readonly acceptInvitation: typeof acceptWorkspaceInvitation;
  readonly createInvitation: typeof createWorkspaceInvitation;
  readonly createWorkspace: typeof createWorkspace;
  readonly getInvitationByTokenHash: typeof getWorkspaceInvitationByTokenHash;
  readonly getRole: typeof getWorkspaceRole;
  readonly isHandleAvailable: typeof isWorkspaceHandleAvailable;
  readonly listInvitations: typeof listWorkspaceInvitations;
  readonly listMembers: typeof listWorkspaceMembers;
  readonly listWorkspaces: typeof listWorkspaces;
  readonly listProjectMemberships: typeof listWorkspaceProjectMemberships;
  readonly removeMember: typeof removeWorkspaceMember;
  readonly revokeInvitation: typeof revokeWorkspaceInvitation;
  readonly updateLogo: typeof updateWorkspaceLogo;
  readonly updateMemberProjects: typeof updateWorkspaceMemberProjects;
  readonly updateMemberRole: typeof updateWorkspaceMemberRole;
  readonly updateWorkspace: typeof updateWorkspace;
};

export const workspaceApplicationServices: WorkspaceApplicationServices = {
  acceptInvitation: acceptWorkspaceInvitation,
  createInvitation: createWorkspaceInvitation,
  createWorkspace,
  getInvitationByTokenHash: getWorkspaceInvitationByTokenHash,
  getRole: getWorkspaceRole,
  isHandleAvailable: isWorkspaceHandleAvailable,
  listInvitations: listWorkspaceInvitations,
  listMembers: listWorkspaceMembers,
  listWorkspaces: listWorkspaces,
  listProjectMemberships: listWorkspaceProjectMemberships,
  removeMember: removeWorkspaceMember,
  revokeInvitation: revokeWorkspaceInvitation,
  updateLogo: updateWorkspaceLogo,
  updateMemberProjects: updateWorkspaceMemberProjects,
  updateMemberRole: updateWorkspaceMemberRole,
  updateWorkspace,
};

const requireCapability = async (
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
    readonly capability:
      | "workspace:read"
      | "workspace:update"
      | "invitations:manage"
      | "members:manage";
  },
  services: WorkspaceApplicationServices,
) => {
  const role = await services.getRole(
    input.db,
    input.workspaceId,
    input.userId,
  );
  if (hasWorkspaceCapability(role, input.capability)) return role!;
  switch (input.capability) {
    case "workspace:read":
      throw new WorkspaceApplicationError(
        "workspace_not_found",
        "Workspace not found",
      );
    case "workspace:update":
      throw new WorkspaceApplicationError(
        "workspace_management_required",
        "Workspace management permission required",
      );
    case "invitations:manage":
      throw new WorkspaceApplicationError(
        "invitation_management_required",
        "Invitation management permission required",
      );
    case "members:manage":
      throw new WorkspaceApplicationError(
        "member_management_required",
        "Member management permission required",
      );
  }
};

const listMemberViews = async (
  db: D1Database,
  workspaceId: string,
  services: WorkspaceApplicationServices,
) => {
  const [members, memberships] = await Promise.all([
    services.listMembers(db, workspaceId),
    services.listProjectMemberships(db, workspaceId),
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

export async function listWorkspacesApplication(
  input: { readonly db: D1Database; readonly userId: string },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  return services.listWorkspaces(input.db, input.userId);
}

export async function createWorkspaceApplication(
  input: {
    readonly db: D1Database;
    readonly userId: string;
    readonly name: string;
    readonly handle: string;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const decoded = decodeWorkspaceInput({
    name: input.name,
    handle: input.handle,
  });
  if (!(await services.isHandleAvailable(input.db, decoded.handle))) {
    throw new WorkspaceApplicationError(
      "workspace_handle_conflict",
      "Workspace handle already exists",
    );
  }
  try {
    return await services.createWorkspace(input.db, {
      ...decoded,
      ownerUserId: input.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique") && message.includes("handle")) {
      throw new WorkspaceApplicationError(
        "workspace_handle_conflict",
        "Workspace handle already exists",
      );
    }
    throw error;
  }
}

export async function checkWorkspaceHandleAvailabilityApplication(
  input: { readonly db: D1Database; readonly handle: string },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const handle = decodeWorkspaceHandle(input.handle);
  return services.isHandleAvailable(input.db, handle);
}

export async function updateWorkspaceApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
    readonly name: string;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  const { name } = decodeWorkspaceUpdateInput({ name: input.name });
  const role = await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "workspace:update",
  }, services);
  const workspace = await services.updateWorkspace(
    input.db,
    workspaceId,
    name,
    role,
  );
  if (!workspace) {
    throw new WorkspaceApplicationError(
      "workspace_not_found",
      "Workspace not found",
    );
  }
  return workspace;
}

export async function updateWorkspaceLogoApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
    readonly logo: string | null;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  const { logo } = decodeWorkspaceLogoInput({ logo: input.logo });
  const role = await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "workspace:update",
  }, services);
  const workspace = await services.updateLogo(
    input.db,
    workspaceId,
    logo,
    role,
  );
  if (!workspace) {
    throw new WorkspaceApplicationError(
      "workspace_not_found",
      "Workspace not found",
    );
  }
  return workspace;
}

export async function listWorkspaceInvitationsApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "invitations:manage",
  }, services);
  return services.listInvitations(input.db, workspaceId);
}

export async function createWorkspaceInvitationApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
    readonly email: string;
    readonly role: unknown;
    readonly initialProjectId: string;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  const { role } = decodeWorkspaceMemberRoleInput({ role: input.role });
  const decoded = decodeWorkspaceInvitationInput({
    email: input.email,
    role,
    initialProjectId: input.initialProjectId,
  });
  await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "invitations:manage",
  }, services);
  const token =
    `briar_invite_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const createdAt = new Date().toISOString();
  const result = await services.createInvitation(input.db, {
    id: crypto.randomUUID(),
    workspaceId,
    initialProjectId: decoded.initialProjectId,
    emailNormalized: decoded.email,
    role: decoded.role,
    tokenHash: await sha256(token),
    invitedByUserId: input.userId,
    expiresAt: new Date(Date.now() + workspaceInvitationTtlMs).toISOString(),
    createdAt,
  });
  if (result.outcome === "project_not_found") {
    throw new WorkspaceApplicationError(
      "invitation_project_not_found",
      "Invitation project not found",
    );
  }
  if (result.outcome === "already_member") {
    throw new WorkspaceApplicationError(
      "already_member",
      "A member with that email already belongs to this workspace",
    );
  }
  return {
    invitation: result.invitation,
    invitePath: `/app/invitations/${token}`,
    observedAt: createdAt,
  };
}

export async function revokeWorkspaceInvitationApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly invitationId: string;
    readonly userId: string;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  const invitationId = decodeInvitationId(input.invitationId);
  await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "invitations:manage",
  }, services);
  if (
    !(await services.revokeInvitation(
      input.db,
      workspaceId,
      invitationId,
      new Date().toISOString(),
    ))
  ) {
    throw new WorkspaceApplicationError(
      "invitation_not_found",
      "Pending invitation not found",
    );
  }
}

export async function getWorkspaceInvitationApplication(
  input: { readonly db: D1Database; readonly token: string },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const token = decodeWorkspaceInvitationToken(input.token);
  const observedAt = new Date().toISOString();
  const invitation = await services.getInvitationByTokenHash(
    input.db,
    await sha256(token),
  );
  if (!invitation) {
    throw new WorkspaceApplicationError(
      "invitation_not_found",
      "Invitation not found",
    );
  }
  return { invitation, observedAt };
}

export async function acceptWorkspaceInvitationApplication(
  input: {
    readonly db: D1Database;
    readonly token: string;
    readonly user: WorkspaceApplicationUser;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const token = decodeWorkspaceInvitationToken(input.token);
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
      throw new WorkspaceApplicationError(
        "invitation_email_mismatch",
        "Sign in with the email address that matches this invitation",
      );
    case "expired":
      throw new WorkspaceApplicationError(
        "invitation_expired",
        "Invitation expired",
      );
    case "revoked":
      throw new WorkspaceApplicationError(
        "invitation_revoked",
        "Invitation revoked",
      );
    case "invalid":
      throw new WorkspaceApplicationError(
        "invitation_not_found",
        "Invitation not found",
      );
  }
}

export async function listWorkspaceMembersApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "workspace:read",
  }, services);
  return listMemberViews(input.db, workspaceId, services);
}

export async function updateWorkspaceMemberRoleApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
    readonly memberId: string;
    readonly role: unknown;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  const memberId = decodeMemberId(input.memberId);
  const { role } = decodeWorkspaceMemberRoleInput({ role: input.role });
  await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "members:manage",
  }, services);
  if (memberId === input.userId) {
    throw new WorkspaceApplicationError(
      "self_role_change",
      "You cannot change your own workspace role",
    );
  }
  const currentRole = await services.getRole(input.db, workspaceId, memberId);
  if (!currentRole) {
    throw new WorkspaceApplicationError("member_not_found", "Member not found");
  }
  if (currentRole === "owner") {
    throw new WorkspaceApplicationError(
      "owner_role_immutable",
      "Workspace owner role cannot be changed",
    );
  }
  if (
    !(await services.updateMemberRole(
      input.db,
      workspaceId,
      memberId,
      role,
    ))
  ) {
    throw new WorkspaceApplicationError("member_not_found", "Member not found");
  }
  return listMemberViews(input.db, workspaceId, services);
}

export async function updateWorkspaceMemberProjectsApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
    readonly memberId: string;
    readonly projectIds: readonly string[];
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  const memberId = decodeMemberId(input.memberId);
  await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "members:manage",
  }, services);
  const { projectIds } = decodeWorkspaceMemberProjectsInput({
    projectIds: [...input.projectIds],
  });
  const outcome = await services.updateMemberProjects(
    input.db,
    workspaceId,
    memberId,
    projectIds,
  );
  switch (outcome) {
    case "updated":
      return listMemberViews(input.db, workspaceId, services);
    case "member_not_found":
      throw new WorkspaceApplicationError("member_not_found", "Member not found");
    case "role_has_full_access":
      throw new WorkspaceApplicationError(
        "role_has_full_access",
        "Workspace owners and co-owners always have access to every project",
      );
    case "project_not_found":
      throw new WorkspaceApplicationError(
        "project_not_in_workspace",
        "Every project must belong to the workspace",
      );
  }
}

export async function removeWorkspaceMemberApplication(
  input: {
    readonly db: D1Database;
    readonly workspaceId: string;
    readonly userId: string;
    readonly memberId: string;
  },
  services: WorkspaceApplicationServices = workspaceApplicationServices,
) {
  const workspaceId = decodeWorkspaceId(input.workspaceId);
  const memberId = decodeMemberId(input.memberId);
  await requireCapability({
    db: input.db,
    workspaceId,
    userId: input.userId,
    capability: "members:manage",
  }, services);
  if (!(await services.removeMember(input.db, workspaceId, memberId))) {
    throw new WorkspaceApplicationError("member_not_found", "Member not found");
  }
}
