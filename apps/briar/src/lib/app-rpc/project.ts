import { createClient } from "@connectrpc/connect";
import {
  MoveIssueToPlanningProjectResponse_Outcome,
  PlanningProjectStatus as PlanningProjectStatusMessage,
  ProjectService,
  UpdateCheckpointPolicyRequest_Scope,
  type PlanningProject as PlanningProjectMessage,
  type Project as ProjectMessage,
} from "@briar/contracts/gen/briar/app/v1/project_pb";
import type {
  PlanningProject,
  PlanningProjectStatus,
  Project,
  ProjectExecutionWorkerPolicy,
  ProjectSettings,
} from "../../types";
import { isProjectIconDataUrl } from "../project-icon";
import { appCallOptions, appTransport } from "./core";
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

const planningStatusFromProto = (
  value: PlanningProjectStatusMessage,
): PlanningProjectStatus => {
  switch (value) {
    case PlanningProjectStatusMessage.PLANNED: return "planned";
    case PlanningProjectStatusMessage.ACTIVE: return "active";
    case PlanningProjectStatusMessage.COMPLETED: return "completed";
    case PlanningProjectStatusMessage.CANCELLED: return "cancelled";
    default: throw new Error("Planning project status is invalid");
  }
};

const planningStatusToProto = (
  value: PlanningProjectStatus,
): PlanningProjectStatusMessage => ({
  planned: PlanningProjectStatusMessage.PLANNED,
  active: PlanningProjectStatusMessage.ACTIVE,
  completed: PlanningProjectStatusMessage.COMPLETED,
  cancelled: PlanningProjectStatusMessage.CANCELLED,
})[value];

const planningProjectFromMessage = (
  project: PlanningProjectMessage,
): PlanningProject => ({
  id: project.id,
  workspaceId: project.workspaceId,
  workspaceName: project.workspaceName,
  teamId: project.teamId,
  teamName: project.teamName,
  name: project.name,
  description: project.description,
  status: planningStatusFromProto(project.status),
  leadUserId: project.leadUserId ?? null,
  leadName: project.leadName ?? null,
  startDate: project.startDate ?? null,
  targetDate: project.targetDate ?? null,
  icon: project.icon ?? null,
  color: project.color ?? null,
  sortOrder: project.sortOrder,
  isDefault: project.isDefault,
  role: projectRoleFromProto(project.role),
  createdAt: requiredTimestamp(project.createdAt, "planningProject.createdAt"),
  updatedAt: requiredTimestamp(project.updatedAt, "planningProject.updatedAt"),
});

const nullableUpdate = (value: string | null | undefined) =>
  value === undefined
    ? undefined
    : { update: value === null
      ? { case: "clear" as const, value: {} }
      : { case: "value" as const, value } };

export async function loadTeamProjects(token: string, teamId: string) {
  const response = await requireProjectClient().listTeamPlanningProjects(
    { teamId },
    appCallOptions(token),
  );
  return response.projects.map(planningProjectFromMessage);
}

export async function createPlanningProject(
  token: string,
  teamId: string,
  input: {
    name: string;
    description?: string;
    status?: PlanningProjectStatus;
    leadUserId?: string;
    startDate?: string;
    targetDate?: string;
    icon?: string;
    color?: string;
    sortOrder?: number;
  },
) {
  const response = await requireProjectClient().createPlanningProject({
    teamId,
    ...input,
    status: input.status === undefined ? undefined : planningStatusToProto(input.status),
  }, appCallOptions(token));
  return planningProjectFromMessage(requiredMessage(response.project, "createPlanningProject.project"));
}

export async function updatePlanningProject(
  token: string,
  projectId: string,
  input: Partial<{
    name: string;
    description: string;
    status: PlanningProjectStatus;
    leadUserId: string | null;
    startDate: string | null;
    targetDate: string | null;
    icon: string | null;
    color: string | null;
    sortOrder: number;
  }>,
) {
  const response = await requireProjectClient().updatePlanningProject({
    projectId,
    name: input.name,
    description: input.description,
    status: input.status === undefined ? undefined : planningStatusToProto(input.status),
    leadUserId: nullableUpdate(input.leadUserId),
    startDate: nullableUpdate(input.startDate),
    targetDate: nullableUpdate(input.targetDate),
    icon: nullableUpdate(input.icon),
    color: nullableUpdate(input.color),
    sortOrder: input.sortOrder,
  }, appCallOptions(token));
  return planningProjectFromMessage(requiredMessage(response.project, "updatePlanningProject.project"));
}

export async function deletePlanningProject(
  token: string,
  projectId: string,
) {
  const response = await requireProjectClient().deletePlanningProject(
    { projectId },
    appCallOptions(token),
  );
  if (!response.deleted) throw new Error("Project was not deleted");
  return { movedIssueCount: response.movedIssueCount };
}

export async function moveIssueToPlanningProject(
  token: string,
  sourceProjectId: string,
  runId: string,
  targetProjectId: string,
) {
  const response = await requireProjectClient().moveIssueToPlanningProject(
    { sourceProjectId, runId, targetProjectId },
    appCallOptions(token),
  );
  const outcome = response.outcome === MoveIssueToPlanningProjectResponse_Outcome.MOVED
    ? "moved" as const
    : response.outcome === MoveIssueToPlanningProjectResponse_Outcome.SAME_PROJECT
    ? "same_project" as const
    : (() => { throw new Error("Issue project move outcome is invalid"); })();
  return { ...response, outcome };
}

export async function resolveIssueHierarchyLocation(
  token: string,
  sourceTeamId: string,
  runId: string,
) {
  return requireProjectClient().resolveIssueHierarchyLocation(
    { sourceTeamId, runId },
    appCallOptions(token),
  );
}

export async function listProjects(
  token: string,
  signal?: AbortSignal,
): Promise<Project[]> {
  const client = requireProjectClient();
  const response = await client.listProjects(
    {},
    appCallOptions(token, signal),
  );
  return response.projects.map(projectFromMessage);
}

export async function createProject(
  token: string,
  input: { readonly name: string; readonly organizationId?: string },
): Promise<{ project: Project; agentToken: string }> {
  const client = requireProjectClient();
  const response = await client.createProject(input, appCallOptions(token));
  return {
    project: projectFromMessage(
      requiredMessage(response.project, "createProject.project"),
    ),
    agentToken: response.agentToken,
  };
}

export async function deleteProject(token: string, projectId: string) {
  const client = requireProjectClient();
  const response = await client.deleteProject(
    { projectId },
    appCallOptions(token),
  );
  if (!response.deleted) throw new Error("Project was not deleted");
}

export async function updateProjectIcon(
  token: string,
  projectId: string,
  icon: string | null,
): Promise<{ project: Project }> {
  const client = requireProjectClient();
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
}

export async function updateProjectIssueKeyPrefix(
  token: string,
  projectId: string,
  issueKeyPrefix: string,
): Promise<{ project: Project }> {
  const client = requireProjectClient();
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
}

export async function updateProjectTabs(
  token: string,
  projectId: string,
  tabs: { readonly schedule: boolean },
): Promise<{ project: Project }> {
  const client = requireProjectClient();
  const response = await client.updateProjectTabs(
    { projectId, schedule: tabs.schedule },
    appCallOptions(token),
  );
  return {
    project: projectFromMessage(
      requiredMessage(response.project, "updateProjectTabs.project"),
    ),
  };
}

export async function createAgentToken(token: string, projectId: string) {
  const client = requireProjectClient();
  const response = await client.createProjectAgentToken(
    { projectId },
    appCallOptions(token),
  );
  return { agentToken: response.agentToken };
}

export async function updateProjectSettings(
  token: string,
  projectId: string,
  settings: ProjectSettings,
) {
  const client = requireProjectClient();
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
  const response = await client.getProjectExecutionWorkerPolicy(
    { projectId },
    appCallOptions(token),
  );
  return {
    policy: requiredExecutionPolicy(response.policy),
  };
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
}
