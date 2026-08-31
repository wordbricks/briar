import { createClient } from "@connectrpc/connect";
import { ProjectRole as ProtoProjectRole } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  OrganizationInvitationStatus as ProtoInvitationStatus,
  OrganizationService,
  type Organization as OrganizationMessage,
  type OrganizationInvitation as OrganizationInvitationMessage,
  type OrganizationInvitationPreview as OrganizationInvitationPreviewMessage,
} from "@briar/contracts/gen/briar/app/v1/organization_pb";
import type {
  Organization,
  OrganizationAssignableRole,
  OrganizationInvitation,
  OrganizationInvitationPreview,
  OrganizationInvitationStatus,
} from "../../types";
import { briarWebAppOrigin } from "../api-config";
import { appCallOptions, appTransport } from "./core";
import {
  optionalTimestamp,
  organizationMemberFromProto,
  projectRoleFromProto,
  requiredMessage,
  requiredTimestamp,
} from "./mappers";

const organizationClient = appTransport
  ? createClient(OrganizationService, appTransport)
  : undefined;

const requireOrganizationClient = () => {
  if (!organizationClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return organizationClient;
};

const assignableRoleToProto = (
  role: OrganizationAssignableRole,
): ProtoProjectRole => {
  switch (role) {
    case "co-owner":
      return ProtoProjectRole.CO_OWNER;
    case "developer":
      return ProtoProjectRole.DEVELOPER;
    case "editor":
      return ProtoProjectRole.EDITOR;
    case "viewer":
      return ProtoProjectRole.VIEWER;
  }
};

const assignableRoleFromProto = (
  role: ProtoProjectRole,
): OrganizationAssignableRole => {
  switch (role) {
    case ProtoProjectRole.CO_OWNER:
      return "co-owner";
    case ProtoProjectRole.DEVELOPER:
      return "developer";
    case ProtoProjectRole.EDITOR:
      return "editor";
    case ProtoProjectRole.VIEWER:
      return "viewer";
    case ProtoProjectRole.OWNER:
      throw new Error("Organization invitation cannot assign the owner role");
    case ProtoProjectRole.UNSPECIFIED:
      throw new Error("Organization invitation role is missing");
    default:
      throw new Error(`Unknown organization invitation role: ${role}`);
  }
};

const invitationStatusFromProto = (
  status: ProtoInvitationStatus,
): OrganizationInvitationStatus => {
  switch (status) {
    case ProtoInvitationStatus.PENDING:
      return "pending";
    case ProtoInvitationStatus.ACCEPTED:
      return "accepted";
    case ProtoInvitationStatus.EXPIRED:
      return "expired";
    case ProtoInvitationStatus.REVOKED:
      return "revoked";
    case ProtoInvitationStatus.UNSPECIFIED:
      throw new Error("Organization invitation status is missing");
    default:
      throw new Error(`Unknown organization invitation status: ${status}`);
  }
};

const invitationDetailsFromMessage = (
  invitation:
    | OrganizationInvitationMessage
    | OrganizationInvitationPreviewMessage,
) => ({
  id: invitation.id,
  organizationId: invitation.organizationId,
  organizationName: invitation.organizationName,
  initialProjectId: invitation.initialProjectId,
  initialProjectName: invitation.initialProjectName,
  emailHint: invitation.emailHint,
  role: assignableRoleFromProto(invitation.role),
  status: invitationStatusFromProto(invitation.status),
  expiresAt: requiredTimestamp(
    invitation.expiresAt,
    "organizationInvitation.expiresAt",
  ),
  acceptedAt: optionalTimestamp(invitation.acceptedAt),
  createdAt: requiredTimestamp(
    invitation.createdAt,
    "organizationInvitation.createdAt",
  ),
});

const organizationFromMessage = (
  organization: OrganizationMessage,
): Organization => ({
  id: organization.id,
  name: organization.name,
  handle: organization.handle,
  logo: organization.logo ?? null,
  role: projectRoleFromProto(organization.role),
  createdAt: requiredTimestamp(
    organization.createdAt,
    "organization.createdAt",
  ),
});

const invitationFromMessage = (
  invitation: OrganizationInvitationMessage,
): OrganizationInvitation => ({
  ...invitationDetailsFromMessage(invitation),
  email: invitation.email,
});

const invitationPreviewFromMessage = (
  invitation: OrganizationInvitationPreviewMessage,
): OrganizationInvitationPreview => invitationDetailsFromMessage(invitation);

export async function loadOrganizations(
  token: string,
): Promise<Organization[]> {
  const response = await requireOrganizationClient().listOrganizations(
    {},
    appCallOptions(token),
  );
  return response.organizations.map(organizationFromMessage);
}

export async function createOrganization(
  token: string,
  input: { readonly name: string; readonly handle: string },
): Promise<{ organization: Organization }> {
  const response = await requireOrganizationClient().createOrganization(
    input,
    appCallOptions(token),
  );
  return {
    organization: organizationFromMessage(
      requiredMessage(response.organization, "createOrganization.organization"),
    ),
  };
}

export async function isOrganizationHandleAvailable(
  token: string,
  handle: string,
) {
  return (await requireOrganizationClient().checkOrganizationHandleAvailability(
    { handle },
    appCallOptions(token),
  )).available;
}

export async function updateOrganization(
  token: string,
  organizationId: string,
  name: string,
): Promise<{ organization: Organization }> {
  const response = await requireOrganizationClient().updateOrganization(
    { organizationId, name },
    appCallOptions(token),
  );
  return {
    organization: organizationFromMessage(
      requiredMessage(response.organization, "updateOrganization.organization"),
    ),
  };
}

export async function updateOrganizationLogo(
  token: string,
  organizationId: string,
  logo: string | null,
): Promise<{ organization: Organization }> {
  const response = await requireOrganizationClient().updateOrganizationLogo(
    {
      organizationId,
      logoUpdate: logo === null
        ? { case: "clearLogo", value: {} }
        : { case: "logo", value: logo },
    },
    appCallOptions(token),
  );
  return {
    organization: organizationFromMessage(
      requiredMessage(
        response.organization,
        "updateOrganizationLogo.organization",
      ),
    ),
  };
}

export async function loadOrganizationInvitations(
  token: string,
  organizationId: string,
) {
  const response = await requireOrganizationClient()
    .listOrganizationInvitations(
      { organizationId },
      appCallOptions(token),
    );
  return response.invitations.map(invitationFromMessage);
}

export async function createOrganizationInvitation(
  token: string,
  organizationId: string,
  input: {
    readonly email: string;
    readonly role: OrganizationAssignableRole;
    readonly initialProjectId: string;
  },
) {
  const response = await requireOrganizationClient()
    .createOrganizationInvitation(
      {
        organizationId,
        email: input.email,
        role: assignableRoleToProto(input.role),
        initialProjectId: input.initialProjectId,
      },
      appCallOptions(token),
    );
  const appOrigin = briarWebAppOrigin || "https://briar.wordbricks.ai";
  return {
    invitation: invitationFromMessage(
      requiredMessage(
        response.invitation,
        "createOrganizationInvitation.invitation",
      ),
    ),
    inviteUrl: new URL(response.invitePath, appOrigin).toString(),
  };
}

export async function revokeOrganizationInvitation(
  token: string,
  organizationId: string,
  invitationId: string,
) {
  await requireOrganizationClient().revokeOrganizationInvitation(
    { organizationId, invitationId },
    appCallOptions(token),
  );
}

export async function loadOrganizationInvitation(token: string) {
  const response = await requireOrganizationClient().getOrganizationInvitation(
    { token },
  );
  return {
    invitation: invitationPreviewFromMessage(
      requiredMessage(
        response.invitation,
        "getOrganizationInvitation.invitation",
      ),
    ),
  };
}

export async function acceptOrganizationInvitation(
  sessionToken: string,
  invitationToken: string,
) {
  const response = await requireOrganizationClient()
    .acceptOrganizationInvitation(
      { token: invitationToken },
      appCallOptions(sessionToken),
    );
  return {
    invitation: invitationPreviewFromMessage(
      requiredMessage(
        response.invitation,
        "acceptOrganizationInvitation.invitation",
      ),
    ),
    alreadyAccepted: response.alreadyAccepted,
  };
}

export async function loadOrganizationMembers(
  token: string,
  organizationId: string,
) {
  const response = await requireOrganizationClient().listOrganizationMembers(
    { organizationId },
    appCallOptions(token),
  );
  return response.members.map(organizationMemberFromProto);
}

export async function updateOrganizationMemberRole(
  token: string,
  organizationId: string,
  userId: string,
  role: OrganizationAssignableRole,
) {
  const response = await requireOrganizationClient()
    .updateOrganizationMemberRole(
      { organizationId, userId, role: assignableRoleToProto(role) },
      appCallOptions(token),
    );
  return { members: response.members.map(organizationMemberFromProto) };
}

export async function updateOrganizationMemberProjects(
  token: string,
  organizationId: string,
  userId: string,
  projectIds: string[],
) {
  const response = await requireOrganizationClient()
    .updateOrganizationMemberProjects(
      { organizationId, userId, projectIds },
      appCallOptions(token),
    );
  return { members: response.members.map(organizationMemberFromProto) };
}

export async function removeOrganizationMember(
  token: string,
  organizationId: string,
  userId: string,
) {
  await requireOrganizationClient().removeOrganizationMember(
    { organizationId, userId },
    appCallOptions(token),
  );
}
