import {
  WorkspaceService as OrganizationService} from "@briar/contracts/gen/briar/app/v1/workspace_pb";
import { ProjectRole } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import type { BriarAuth } from "./auth";

import {
  appOrganization,
  appOrganizationInvitation,
  appOrganizationInvitationPreview,
  appOrganizationMember,
} from "./app-connect-mappers";
import { HttpError } from "./http-response";
import {
  acceptWorkspaceInvitationApplication,
  checkWorkspaceHandleAvailabilityApplication,
  createWorkspaceApplication,
  createWorkspaceInvitationApplication,
  getWorkspaceInvitationApplication,
  listWorkspaceInvitationsApplication,
  listWorkspaceMembersApplication,
  listWorkspacesApplication,
  removeWorkspaceMemberApplication,
  revokeWorkspaceInvitationApplication,
  updateWorkspaceApplication,
  updateWorkspaceLogoApplication,
  updateWorkspaceMemberProjectsApplication,
  updateWorkspaceMemberRoleApplication,
  WorkspaceApplicationError,
} from "./organization-application";
import { requireSession } from "./session-auth";

export type AppConnectOrganizationInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

const assignableRoleInput = (role: ProjectRole): string => {
  switch (role) {
    case ProjectRole.OWNER:
      return "owner";
    case ProjectRole.CO_OWNER:
      return "co-owner";
    case ProjectRole.DEVELOPER:
      return "developer";
    case ProjectRole.EDITOR:
      return "editor";
    case ProjectRole.VIEWER:
      return "viewer";
    case ProjectRole.UNSPECIFIED:
      throw new ConnectError("Organization role is required", Code.InvalidArgument);
    default:
      throw new ConnectError(
        `Unknown organization role: ${role}`,
        Code.InvalidArgument,
      );
  }
};

const throwApplicationError = (error: unknown): never => {
  if (!(error instanceof WorkspaceApplicationError)) throw error;
  switch (error.reason) {
    case "workspace_not_found":
    case "invitation_not_found":
    case "member_not_found":
    case "invitation_project_not_found":
      throw new HttpError(404, error.message);
    case "workspace_management_required":
    case "invitation_management_required":
    case "member_management_required":
    case "owner_role_immutable":
      throw new HttpError(403, error.message);
    case "workspace_handle_conflict":
    case "already_member":
    case "invitation_email_mismatch":
    case "role_has_full_access":
      throw new HttpError(409, error.message);
    case "invitation_expired":
    case "invitation_revoked":
      throw new HttpError(410, error.message);
    case "project_not_in_workspace":
    case "self_role_change":
      throw new HttpError(400, error.message);
  }
};

const withApplicationErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    return throwApplicationError(error);
  }
};

// Protobuf boundary. `OrganizationService`, its method names and its
// `organizationId` request fields are wire contract and keep the old product
// name; everything behind this file is Workspace-named. Each handler therefore
// hands `input.organizationId` to the application layer as `workspaceId`.
export const createAppOrganizationService = (
  { request, auth, db }: AppConnectOrganizationInput,
): ServiceImpl<typeof OrganizationService> => ({
  listWorkspaces: async () => {
    const session = await requireSession(auth, request);
    const organizations = await withApplicationErrors(
      listWorkspacesApplication({ db, userId: session.user.id }),
    );
    return { workspaces: organizations.map(appOrganization) };
  },

  createWorkspace: async (input) => {
    const session = await requireSession(auth, request);
    const organization = await withApplicationErrors(
      createWorkspaceApplication({
        db,
        userId: session.user.id,
        name: input.name,
        handle: input.handle,
      }),
    );
    return { workspace: appOrganization(organization) };
  },

  checkWorkspaceHandleAvailability: async (input) => {
    await requireSession(auth, request);
    const available = await withApplicationErrors(
      checkWorkspaceHandleAvailabilityApplication({
        db,
        handle: input.handle,
      }),
    );
    return { available };
  },

  updateWorkspace: async (input) => {
    const session = await requireSession(auth, request);
    const organization = await withApplicationErrors(
      updateWorkspaceApplication({
        db,
        workspaceId: input.workspaceId,
        userId: session.user.id,
        name: input.name,
      }),
    );
    return { workspace: appOrganization(organization) };
  },

  updateWorkspaceLogo: async (input) => {
    const session = await requireSession(auth, request);
    const logo = input.logoUpdate.case === "logo"
      ? input.logoUpdate.value
      : input.logoUpdate.case === "clearLogo"
      ? null
      : (() => {
        throw new ConnectError("logo update is required", Code.InvalidArgument);
      })();
    const organization = await withApplicationErrors(
      updateWorkspaceLogoApplication({
        db,
        workspaceId: input.workspaceId,
        userId: session.user.id,
        logo,
      }),
    );
    return { workspace: appOrganization(organization) };
  },

  listWorkspaceInvitations: async (input) => {
    const session = await requireSession(auth, request);
    const observedAt = new Date().toISOString();
    const invitations = await withApplicationErrors(
      listWorkspaceInvitationsApplication({
        db,
        workspaceId: input.workspaceId,
        userId: session.user.id,
      }),
    );
    return {
      invitations: invitations.map((invitation) =>
        appOrganizationInvitation(invitation, observedAt)
      ),
    };
  },

  createWorkspaceInvitation: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withApplicationErrors(
      createWorkspaceInvitationApplication({
        db,
        workspaceId: input.workspaceId,
        userId: session.user.id,
        email: input.email,
        role: assignableRoleInput(input.role),
        initialProjectId: input.initialProjectId,
      }),
    );
    return {
      invitation: appOrganizationInvitation(
        result.invitation,
        result.observedAt,
      ),
      invitePath: result.invitePath,
    };
  },

  revokeWorkspaceInvitation: async (input) => {
    const session = await requireSession(auth, request);
    await withApplicationErrors(revokeWorkspaceInvitationApplication({
      db,
      workspaceId: input.workspaceId,
      invitationId: input.invitationId,
      userId: session.user.id,
    }));
    return {};
  },

  getWorkspaceInvitation: async (input) => {
    const result = await withApplicationErrors(
      getWorkspaceInvitationApplication({ db, token: input.token }),
    );
    return {
      invitation: appOrganizationInvitationPreview(
        result.invitation,
        result.observedAt,
      ),
    };
  },

  acceptWorkspaceInvitation: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withApplicationErrors(
      acceptWorkspaceInvitationApplication({
        db,
        token: input.token,
        user: session.user,
      }),
    );
    return {
      invitation: appOrganizationInvitationPreview(
        result.invitation,
        result.observedAt,
      ),
      alreadyAccepted: result.alreadyAccepted,
    };
  },

  listWorkspaceMembers: async (input) => {
    const session = await requireSession(auth, request);
    const members = await withApplicationErrors(
      listWorkspaceMembersApplication({
        db,
        workspaceId: input.workspaceId,
        userId: session.user.id,
      }),
    );
    return {
      members: members.map(({ member, projectIds }) =>
        appOrganizationMember(member, projectIds)
      ),
    };
  },

  updateWorkspaceMemberRole: async (input) => {
    const session = await requireSession(auth, request);
    const members = await withApplicationErrors(
      updateWorkspaceMemberRoleApplication({
        db,
        workspaceId: input.workspaceId,
        userId: session.user.id,
        memberId: input.userId,
        role: assignableRoleInput(input.role),
      }),
    );
    return {
      members: members.map(({ member, projectIds }) =>
        appOrganizationMember(member, projectIds)
      ),
    };
  },

  updateWorkspaceMemberProjects: async (input) => {
    const session = await requireSession(auth, request);
    const members = await withApplicationErrors(
      updateWorkspaceMemberProjectsApplication({
        db,
        workspaceId: input.workspaceId,
        userId: session.user.id,
        memberId: input.userId,
        projectIds: input.projectIds,
      }),
    );
    return {
      members: members.map(({ member, projectIds }) =>
        appOrganizationMember(member, projectIds)
      ),
    };
  },

  removeWorkspaceMember: async (input) => {
    const session = await requireSession(auth, request);
    await withApplicationErrors(removeWorkspaceMemberApplication({
      db,
      workspaceId: input.workspaceId,
      userId: session.user.id,
      memberId: input.userId,
    }));
    return {};
  },
});

export function registerAppOrganizationService(
  router: ConnectRouter,
  input: AppConnectOrganizationInput,
) {
  router.service(OrganizationService, createAppOrganizationService(input));
}
