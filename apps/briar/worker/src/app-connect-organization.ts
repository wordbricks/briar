import {
  OrganizationService,
} from "@briar/contracts/gen/briar/app/v1/organization_pb";
import { ProjectRole } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import type { BriarAuth } from "./auth";
import { withConnectErrors } from "./app-connect-errors";
import {
  appOrganization,
  appOrganizationInvitation,
  appOrganizationInvitationPreview,
  appOrganizationMember,
} from "./app-connect-mappers";
import { HttpError } from "./http-response";
import {
  acceptOrganizationInvitationApplication,
  checkOrganizationHandleAvailabilityApplication,
  createOrganizationApplication,
  createOrganizationInvitationApplication,
  getOrganizationInvitationApplication,
  listOrganizationInvitationsApplication,
  listOrganizationMembersApplication,
  listOrganizationsApplication,
  OrganizationApplicationError,
  removeOrganizationMemberApplication,
  revokeOrganizationInvitationApplication,
  updateOrganizationApplication,
  updateOrganizationLogoApplication,
  updateOrganizationMemberProjectsApplication,
  updateOrganizationMemberRoleApplication,
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
  if (!(error instanceof OrganizationApplicationError)) throw error;
  switch (error.reason) {
    case "organization_not_found":
    case "invitation_not_found":
    case "member_not_found":
    case "invitation_project_not_found":
      throw new HttpError(404, error.message);
    case "organization_management_required":
    case "invitation_management_required":
    case "member_management_required":
    case "owner_role_immutable":
      throw new HttpError(403, error.message);
    case "organization_handle_conflict":
    case "already_member":
    case "invitation_email_mismatch":
    case "role_has_full_access":
      throw new HttpError(409, error.message);
    case "invitation_expired":
    case "invitation_revoked":
      throw new HttpError(410, error.message);
    case "project_not_in_organization":
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

export const createAppOrganizationService = (
  { request, auth, db }: AppConnectOrganizationInput,
): ServiceImpl<typeof OrganizationService> => ({
  listOrganizations: () => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const organizations = await withApplicationErrors(
      listOrganizationsApplication({ db, userId: session.user.id }),
    );
    return { organizations: organizations.map(appOrganization) };
  }),

  createOrganization: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const organization = await withApplicationErrors(
      createOrganizationApplication({
        db,
        userId: session.user.id,
        name: input.name,
        handle: input.handle,
      }),
    );
    return { organization: appOrganization(organization) };
  }),

  checkOrganizationHandleAvailability: (input) =>
    withConnectErrors(async () => {
      await requireSession(auth, request);
      const available = await withApplicationErrors(
        checkOrganizationHandleAvailabilityApplication({
          db,
          handle: input.handle,
        }),
      );
      return { available };
    }),

  updateOrganization: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const organization = await withApplicationErrors(
      updateOrganizationApplication({
        db,
        organizationId: input.organizationId,
        userId: session.user.id,
        name: input.name,
      }),
    );
    return { organization: appOrganization(organization) };
  }),

  updateOrganizationLogo: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const logo = input.logoUpdate.case === "logo"
      ? input.logoUpdate.value
      : input.logoUpdate.case === "clearLogo"
      ? null
      : (() => {
        throw new ConnectError("logo update is required", Code.InvalidArgument);
      })();
    const organization = await withApplicationErrors(
      updateOrganizationLogoApplication({
        db,
        organizationId: input.organizationId,
        userId: session.user.id,
        logo,
      }),
    );
    return { organization: appOrganization(organization) };
  }),

  listOrganizationInvitations: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const observedAt = new Date().toISOString();
    const invitations = await withApplicationErrors(
      listOrganizationInvitationsApplication({
        db,
        organizationId: input.organizationId,
        userId: session.user.id,
      }),
    );
    return {
      invitations: invitations.map((invitation) =>
        appOrganizationInvitation(invitation, observedAt)
      ),
    };
  }),

  createOrganizationInvitation: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const result = await withApplicationErrors(
      createOrganizationInvitationApplication({
        db,
        organizationId: input.organizationId,
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
  }),

  revokeOrganizationInvitation: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    await withApplicationErrors(revokeOrganizationInvitationApplication({
      db,
      organizationId: input.organizationId,
      invitationId: input.invitationId,
      userId: session.user.id,
    }));
    return {};
  }),

  getOrganizationInvitation: (input) => withConnectErrors(async () => {
    const result = await withApplicationErrors(
      getOrganizationInvitationApplication({ db, token: input.token }),
    );
    return {
      invitation: appOrganizationInvitationPreview(
        result.invitation,
        result.observedAt,
      ),
    };
  }),

  acceptOrganizationInvitation: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const result = await withApplicationErrors(
      acceptOrganizationInvitationApplication({
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
  }),

  listOrganizationMembers: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const members = await withApplicationErrors(
      listOrganizationMembersApplication({
        db,
        organizationId: input.organizationId,
        userId: session.user.id,
      }),
    );
    return {
      members: members.map(({ member, projectIds }) =>
        appOrganizationMember(member, projectIds)
      ),
    };
  }),

  updateOrganizationMemberRole: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    const members = await withApplicationErrors(
      updateOrganizationMemberRoleApplication({
        db,
        organizationId: input.organizationId,
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
  }),

  updateOrganizationMemberProjects: (input) =>
    withConnectErrors(async () => {
      const session = await requireSession(auth, request);
      const members = await withApplicationErrors(
        updateOrganizationMemberProjectsApplication({
          db,
          organizationId: input.organizationId,
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
    }),

  removeOrganizationMember: (input) => withConnectErrors(async () => {
    const session = await requireSession(auth, request);
    await withApplicationErrors(removeOrganizationMemberApplication({
      db,
      organizationId: input.organizationId,
      userId: session.user.id,
      memberId: input.userId,
    }));
    return {};
  }),
});

export function registerAppOrganizationService(
  router: ConnectRouter,
  input: AppConnectOrganizationInput,
) {
  router.service(OrganizationService, createAppOrganizationService(input));
}
