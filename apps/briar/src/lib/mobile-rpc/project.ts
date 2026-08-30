import { createClient } from "@connectrpc/connect";
import {
  ProjectService,
  type Project as ProjectMessage,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/project_pb";
import type { Project } from "../../types";
import { decodeProjectResponse } from "../api/project-contract";
import {
  mobileCallOptions,
  mobileRpc,
  mobileTransport,
} from "./core";
import { projectRoleFromProto, requiredTimestamp } from "./mappers";

const projectClient = mobileTransport
  ? createClient(ProjectService, mobileTransport)
  : undefined;

export const projectFromMessage = (project: ProjectMessage): Project =>
  decodeProjectResponse({
    id: project.id,
    name: project.name,
    issueKeyPrefix: project.issueKeyPrefix,
    scheduleTabEnabled: project.scheduleTabEnabled,
    icon: project.icon ?? null,
    organizationId: project.organizationId,
    organizationName: project.organizationName,
    role: projectRoleFromProto(project.role),
    createdAt: requiredTimestamp(project.createdAt, "project.createdAt"),
  });

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
