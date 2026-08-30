import { timestampDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import {
  ProjectService,
  type Project as ProjectMessage,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/project_pb";
import {
  ProjectRole,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/common_pb";
import type { Project } from "../../types";
import { decodeProjectResponse } from "../api/project-contract";
import {
  mobileCallOptions,
  mobileRpc,
  mobileTransport,
} from "./core";

const projectClient = mobileTransport
  ? createClient(ProjectService, mobileTransport)
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

export async function listProjects(
  token: string,
  signal?: AbortSignal,
): Promise<Project[]> {
  if (!projectClient) throw new Error("Briar API URL이 설정되지 않았습니다.");
  return mobileRpc(async () => {
    const response = await projectClient.listProjects(
      {},
      mobileCallOptions(token, signal),
    );
    return response.projects.map(projectFromMessage);
  });
}
