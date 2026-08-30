import { createClient } from "@connectrpc/connect";
import {
  ProjectService,
  UpdateCheckpointPolicyRequest_Scope,
  type Project as ProjectMessage,
} from "@briar/contracts/gen/briar/app/v1/project_pb";
import type {
  Project,
  ProjectExecutionWorkerPolicy,
  ProjectSettings,
} from "../../types";
import { isProjectIconDataUrl } from "../project-icon";
import { appCallOptions, appRpc, appTransport } from "./core";
import {
  projectRoleFromProto,
  requiredMessage,
  requiredTimestamp,
} from "./mappers";
import {
  checkpointPolicyFromProto,
  executionPolicyFromProto,
  executionSelectionModeToProto,
  projectSettingsFromProto,
  workflowCheckpointToProto,
  workflowToProto,
} from "./project-configuration-mappers";

const projectClient = appTransport
  ? createClient(ProjectService, appTransport)
  : undefined;

const requireProjectClient = () => {
  if (!projectClient) throw new Error("Briar API URL이 설정되지 않았습니다.");
  return projectClient;
};

export const projectFromMessage = (project: ProjectMessage): Project => ({
  id: project.id,
  name: project.name,
  issueKeyPrefix: project.issueKeyPrefix,
  scheduleTabEnabled: project.scheduleTabEnabled,
  icon:
    project.icon !== undefined && isProjectIconDataUrl(project.icon)
      ? project.icon
      : null,
  organizationId: project.organizationId,
  organizationName: project.organizationName,
  role: projectRoleFromProto(project.role),
  createdAt: requiredTimestamp(project.createdAt, "project.createdAt"),
});

export async function listProjects(
  token: string,
  signal?: AbortSignal,
): Promise<Project[]> {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.listProjects(
      {},
      appCallOptions(token, signal),
    );
    return response.projects.map(projectFromMessage);
  });
}

export async function createProject(
  token: string,
  input: { readonly name: string; readonly organizationId?: string },
): Promise<{ project: Project; agentToken: string }> {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.createProject(input, appCallOptions(token));
    return {
      project: projectFromMessage(
        requiredMessage(response.project, "createProject.project"),
      ),
      agentToken: response.agentToken,
    };
  });
}

export async function deleteProject(token: string, projectId: string) {
  const client = requireProjectClient();
  await appRpc(async () => {
    const response = await client.deleteProject(
      { projectId },
      appCallOptions(token),
    );
    if (!response.deleted) throw new Error("Project was not deleted");
  });
}

export async function updateProjectIcon(
  token: string,
  projectId: string,
  icon: string | null,
): Promise<{ project: Project }> {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.updateProjectIcon(
      {
        projectId,
        iconUpdate: icon === null
          ? { case: "clearIcon", value: {} }
          : { case: "icon", value: icon },
      },
      appCallOptions(token),
    );
    return {
      project: projectFromMessage(
        requiredMessage(response.project, "updateProjectIcon.project"),
      ),
    };
  });
}

export async function updateProjectIssueKeyPrefix(
  token: string,
  projectId: string,
  issueKeyPrefix: string,
): Promise<{ project: Project }> {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.updateProjectIssueKeyPrefix(
      { projectId, issueKeyPrefix },
      appCallOptions(token),
    );
    return {
      project: projectFromMessage(
        requiredMessage(
          response.project,
          "updateProjectIssueKeyPrefix.project",
        ),
      ),
    };
  });
}

export async function updateProjectTabs(
  token: string,
  projectId: string,
  tabs: { readonly schedule: boolean },
): Promise<{ project: Project }> {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.updateProjectTabs(
      { projectId, schedule: tabs.schedule },
      appCallOptions(token),
    );
    return {
      project: projectFromMessage(
        requiredMessage(response.project, "updateProjectTabs.project"),
      ),
    };
  });
}

export async function createAgentToken(token: string, projectId: string) {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.createProjectAgentToken(
      { projectId },
      appCallOptions(token),
    );
    return { agentToken: response.agentToken };
  });
}

export async function updateProjectSettings(
  token: string,
  projectId: string,
  settings: ProjectSettings,
) {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.updateProjectSettings(
      {
        projectId,
        velenOrg: settings.velenOrg ?? undefined,
        dataSource: settings.dataSource ?? undefined,
        linear: {
          enabled: settings.linear.enabled,
          source: settings.linear.source ?? undefined,
          teamKey: settings.linear.teamKey ?? undefined,
        },
        githubRepository: settings.githubRepository ?? undefined,
        workflow: workflowToProto(settings.workflow),
      },
      appCallOptions(token),
    );
    return {
      settings: projectSettingsFromProto(
        requiredMessage(response.settings, "updateProjectSettings.settings"),
      ),
    };
  });
}

export async function updateCheckpointPolicy(
  token: string,
  projectId: string,
  input: {
    scope: "project" | "user";
    checkpoints: NonNullable<
      ProjectSettings["checkpointPolicy"]
    >["projectMandatory"];
    expectedRevision: number;
  },
) {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.updateCheckpointPolicy(
      {
        projectId,
        scope: input.scope === "project"
          ? UpdateCheckpointPolicyRequest_Scope.PROJECT
          : UpdateCheckpointPolicyRequest_Scope.USER,
        checkpoints: input.checkpoints.map(workflowCheckpointToProto),
        expectedRevision: BigInt(input.expectedRevision),
      },
      appCallOptions(token),
    );
    return {
      checkpointPolicy: checkpointPolicyFromProto(
        requiredMessage(
          response.checkpointPolicy,
          "updateCheckpointPolicy.checkpointPolicy",
        ),
      ),
    };
  });
}

const requiredExecutionPolicy = (
  value: Parameters<typeof executionPolicyFromProto>[0],
): ProjectExecutionWorkerPolicy => {
  const policy = executionPolicyFromProto(value);
  if (!policy) throw new Error("Project execution Worker policy is missing");
  return policy;
};

export async function loadProjectExecutionWorkerPolicy(
  token: string,
  projectId: string,
) {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.getProjectExecutionWorkerPolicy(
      { projectId },
      appCallOptions(token),
    );
    return {
      policy: requiredExecutionPolicy(response.policy),
    };
  });
}

export async function updateProjectExecutionWorkerPolicy(
  token: string,
  projectId: string,
  policy: Pick<
    ProjectExecutionWorkerPolicy,
    "selectionMode" | "defaultWorkerId" | "allowedWorkerIds"
  >,
) {
  const client = requireProjectClient();
  return appRpc(async () => {
    const response = await client.updateProjectExecutionWorkerPolicy(
      {
        projectId,
        selectionMode: executionSelectionModeToProto(policy.selectionMode),
        defaultWorkerId: policy.defaultWorkerId ?? undefined,
        allowedWorkerIds: policy.allowedWorkerIds,
      },
      appCallOptions(token),
    );
    return {
      policy: requiredExecutionPolicy(response.policy),
    };
  });
}
