import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  ProjectService,
  type Project as ProjectMessage,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/project_pb";
import {
  ProjectRole,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/common_pb";
import type { Project } from "../../types";
import { briarApiUrl } from "../api-config";
import { ApiError } from "../api/errors";
import { decodeProjectResponse } from "../api/project-contract";

const transport = briarApiUrl
  ? createConnectTransport({ baseUrl: briarApiUrl })
  : undefined;

const projectClient = transport
  ? createClient(ProjectService, transport)
  : undefined;

const projectRole = (role: ProjectRole): Project["role"] => {
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
      throw new Error("Project role is missing");
    default:
      throw new Error(`Unknown project role: ${role}`);
  }
};

const projectFromMessage = (project: ProjectMessage): Project => {
  if (project.createdAt === undefined) {
    throw new Error("Project creation timestamp is missing");
  }
  return decodeProjectResponse({
    id: project.id,
    name: project.name,
    issueKeyPrefix: project.issueKeyPrefix,
    scheduleTabEnabled: project.scheduleTabEnabled,
    icon: project.icon ?? null,
    organizationId: project.organizationId,
    organizationName: project.organizationName,
    role: projectRole(project.role),
    createdAt: timestampDate(project.createdAt).toISOString(),
  });
};

const apiErrorFromConnect = (error: ConnectError): ApiError => {
  const status = (() => {
    switch (error.code) {
      case Code.InvalidArgument:
        return 400;
      case Code.Unauthenticated:
        return 401;
      case Code.PermissionDenied:
        return 403;
      case Code.NotFound:
        return 404;
      case Code.AlreadyExists:
      case Code.Aborted:
        return 409;
      case Code.ResourceExhausted:
        return 429;
      default:
        return 500;
    }
  })();
  return new ApiError(status, error.rawMessage || error.message);
};

export async function listProjects(
  token: string,
  signal?: AbortSignal,
): Promise<Project[]> {
  if (!projectClient) throw new Error("Briar API URL이 설정되지 않았습니다.");
  try {
    const response = await projectClient.listProjects({}, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    return response.projects.map(projectFromMessage);
  } catch (error) {
    if (error instanceof ConnectError) throw apiErrorFromConnect(error);
    throw error;
  }
}
