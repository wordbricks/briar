import { createClient } from "@connectrpc/connect";
import { ProjectRole as ProtoProjectRole} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  WorkspaceInvitationStatus as ProtoInvitationStatus,
  WorkspaceService,
  type Workspace as WorkspaceMessage,
  type WorkspaceInvitation as WorkspaceInvitationMessage,
  type WorkspaceInvitationPreview as WorkspaceInvitationPreviewMessage} from "@briar/contracts/gen/briar/app/v1/workspace_pb";
import type {
  Workspace,
  WorkspaceAssignableRole,
  WorkspaceInvitation,
  WorkspaceInvitationPreview,
  WorkspaceInvitationStatus,
} from "../../types";
import { briarWebAppOrigin } from "../api-config";
import { appCallOptions, appTransport } from "./core";
import {
  optionalTimestamp,
  organizationMemberFromProto,
  teamRoleFromProto,
  requiredMessage,
  requiredTimestamp,
} from "./mappers";

const organizationClient = appTransport
  ? createClient(WorkspaceService, appTransport)
  : undefined;

const requireWorkspaceClient = () => {
  if (!organizationClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return organizationClient;
};

const assignableRoleToProto = (
  role: WorkspaceAssignableRole,
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
): WorkspaceAssignableRole => {
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
      throw new Error("Workspace invitation cannot assign the owner role");
    case ProtoProjectRole.UNSPECIFIED:
      throw new Error("Workspace invitation role is missing");
    default:
      throw new Error(`Unknown workspace invitation role: ${role}`);
  }
};

const invitationStatusFromProto = (
  status: ProtoInvitationStatus,
): WorkspaceInvitationStatus => {
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
      throw new Error("Workspace invitation status is missing");
    default:
      throw new Error(`Unknown workspace invitation status: ${status}`);
  }
};

const invitationDetailsFromMessage = (
  invitation:
    | WorkspaceInvitationMessage
    | WorkspaceInvitationPreviewMessage,
) => ({
  id: invitation.id,
  workspaceId: invitation.workspaceId,
  workspaceName: invitation.workspaceName,
  initialProjectId: invitation.initialProjectId,
  initialProjectName: invitation.initialProjectName,
  emailHint: invitation.emailHint,
  role: assignableRoleFromProto(invitation.role),
  status: invitationStatusFromProto(invitation.status),
  expiresAt: requiredTimestamp(
    invitation.expiresAt,
    "workspaceInvitation.expiresAt",
  ),
  acceptedAt: optionalTimestamp(invitation.acceptedAt),
  createdAt: requiredTimestamp(
    invitation.createdAt,
    "workspaceInvitation.createdAt",
  ),
});

const organizationFromMessage = (
  workspace: WorkspaceMessage,
): Workspace => ({
  id: workspace.id,
  name: workspace.name,
  handle: workspace.handle,
  logo: workspace.logo ?? null,
  role: teamRoleFromProto(workspace.role),
  createdAt: requiredTimestamp(
    workspace.createdAt,
    "workspace.createdAt",
  ),
});

const invitationFromMessage = (
  invitation: WorkspaceInvitationMessage,
): WorkspaceInvitation => ({
  ...invitationDetailsFromMessage(invitation),
  email: invitation.email,
});

const invitationPreviewFromMessage = (
  invitation: WorkspaceInvitationPreviewMessage,
): WorkspaceInvitationPreview => invitationDetailsFromMessage(invitation);

export async function loadWorkspaces(
  token: string,
  signal?: AbortSignal,
): Promise<Workspace[]> {
  const response = await requireWorkspaceClient().listWorkspaces(
    {},
    appCallOptions(token, signal),
  );
  return response.workspaces.map(organizationFromMessage);
}

export async function createWorkspace(
  token: string,
  input: { readonly name: string; readonly handle: string },
): Promise<{ organization: Workspace }> {
  const response = await requireWorkspaceClient().createWorkspace(
    input,
    appCallOptions(token),
  );
  return { organization: organizationFromMessage(
      requiredMessage(response.workspace, "createWorkspace.workspace"),
    ),
  };
}

export async function isWorkspaceHandleAvailable(
  token: string,
  handle: string,
) {
  return (await requireWorkspaceClient().checkWorkspaceHandleAvailability(
    { handle },
    appCallOptions(token),
  )).available;
}

export async function updateWorkspace(
  token: string,
  workspaceId: string,
  name: string,
): Promise<{ organization: Workspace }> {
  const response = await requireWorkspaceClient().updateWorkspace(
    { workspaceId: workspaceId, name },
    appCallOptions(token),
  );
  return { organization: organizationFromMessage(
      requiredMessage(response.workspace, "updateWorkspace.workspace"),
    ),
  };
}

export async function updateWorkspaceLogo(
  token: string,
  workspaceId: string,
  logo: string | null,
): Promise<{ organization: Workspace }> {
  const response = await requireWorkspaceClient().updateWorkspaceLogo(
    {
      workspaceId: workspaceId,
      logoUpdate: logo === null
        ? { case: "clearLogo", value: {} }
        : { case: "logo", value: logo },
    },
    appCallOptions(token),
  );
  return { organization: organizationFromMessage(
      requiredMessage(
        response.workspace,
        "updateWorkspaceLogo.workspace",
      ),
    ),
  };
}

export async function loadWorkspaceInvitations(
  token: string,
  workspaceId: string,
) {
  const response = await requireWorkspaceClient()
    .listWorkspaceInvitations(
      { workspaceId: workspaceId },
      appCallOptions(token),
    );
  return response.invitations.map(invitationFromMessage);
}

export async function createWorkspaceInvitation(
  token: string,
  workspaceId: string,
  input: {
    readonly email: string;
    readonly role: WorkspaceAssignableRole;
    readonly initialProjectId: string;
  },
) {
  const response = await requireWorkspaceClient()
    .createWorkspaceInvitation(
      {
        workspaceId: workspaceId,
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
        "createWorkspaceInvitation.invitation",
      ),
    ),
    inviteUrl: new URL(response.invitePath, appOrigin).toString(),
  };
}

export async function revokeWorkspaceInvitation(
  token: string,
  workspaceId: string,
  invitationId: string,
) {
  await requireWorkspaceClient().revokeWorkspaceInvitation(
    { workspaceId: workspaceId, invitationId },
    appCallOptions(token),
  );
}

export async function loadWorkspaceInvitation(token: string) {
  const response = await requireWorkspaceClient().getWorkspaceInvitation(
    { token },
  );
  return {
    invitation: invitationPreviewFromMessage(
      requiredMessage(
        response.invitation,
        "getWorkspaceInvitation.invitation",
      ),
    ),
  };
}

export async function acceptWorkspaceInvitation(
  sessionToken: string,
  invitationToken: string,
) {
  const response = await requireWorkspaceClient()
    .acceptWorkspaceInvitation(
      { token: invitationToken },
      appCallOptions(sessionToken),
    );
  return {
    invitation: invitationPreviewFromMessage(
      requiredMessage(
        response.invitation,
        "acceptWorkspaceInvitation.invitation",
      ),
    ),
    alreadyAccepted: response.alreadyAccepted,
  };
}

export async function loadWorkspaceMembers(
  token: string,
  workspaceId: string,
) {
  const response = await requireWorkspaceClient().listWorkspaceMembers(
    { workspaceId: workspaceId },
    appCallOptions(token),
  );
  return response.members.map(organizationMemberFromProto);
}

export async function updateWorkspaceMemberRole(
  token: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceAssignableRole,
) {
  const response = await requireWorkspaceClient()
    .updateWorkspaceMemberRole(
      { workspaceId: workspaceId, userId, role: assignableRoleToProto(role) },
      appCallOptions(token),
    );
  return { members: response.members.map(organizationMemberFromProto) };
}

export async function updateWorkspaceMemberProjects(
  token: string,
  workspaceId: string,
  userId: string,
  projectIds: string[],
) {
  const response = await requireWorkspaceClient()
    .updateWorkspaceMemberProjects(
      { workspaceId: workspaceId, userId, projectIds },
      appCallOptions(token),
    );
  return { members: response.members.map(organizationMemberFromProto) };
}

export async function removeWorkspaceMember(
  token: string,
  workspaceId: string,
  userId: string,
) {
  await requireWorkspaceClient().removeWorkspaceMember(
    { workspaceId: workspaceId, userId },
    appCallOptions(token),
  );
}
