import { createClient } from "@connectrpc/connect";
import {
  MoveIssueToPlanningProjectResponse_Outcome,
  PlanningProjectStatus as PlanningProjectStatusMessage,
  TeamService,
  UpdateCheckpointPolicyRequest_Scope,
  type PlanningProject as PlanningProjectMessage,
  type Team as TeamMessage,
} from "@briar/contracts/gen/briar/app/v1/team_pb";
import type {
  PlanningProject,
  PlanningProjectStatus,
  Project,
  ProjectExecutionWorkerPolicy,
  ProjectSettings,
} from "../../types";
import { isTeamIconDataUrl } from "../team-icon";
import { isTeamIconColor, isTeamIconName } from "../team-icon-library";
import { appCallOptions, appTransport } from "./core";
import {
  teamRoleFromProto,
  requiredMessage,
  requiredTimestamp,
} from "./mappers";
import {
  checkpointPolicyFromProto,
  executionPolicyFromProto,
  executionSelectionModeToProto,
  teamSettingsFromProto,
  workflowCheckpointToProto,
  workflowToProto,
} from "./team-configuration-mappers";

const teamClient = appTransport
  ? createClient(TeamService, appTransport)
  : undefined;

const requireTeamClient = () => {
  if (!teamClient) throw new Error("Briar API URL이 설정되지 않았습니다.");
  return teamClient;
};

export const teamFromMessage = (project: TeamMessage): Project => ({
  id: project.id,
  name: project.name,
  issueKeyPrefix: project.issueKeyPrefix,
  scheduleTabEnabled: project.scheduleTabEnabled,
  icon:
    project.icon !== undefined && isTeamIconDataUrl(project.icon)
      ? project.icon
      : null,
  iconName:
    project.iconName !== undefined && isTeamIconName(project.iconName)
      ? project.iconName
      : null,
  iconColor:
    project.iconColor !== undefined && isTeamIconColor(project.iconColor)
      ? project.iconColor
      : null,
  organizationId: project.organizationId,
  organizationName: project.organizationName,
  role: teamRoleFromProto(project.role),
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
  role: teamRoleFromProto(project.role),
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
  const response = await requireTeamClient().listTeamPlanningProjects(
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
  const response = await requireTeamClient().createPlanningProject({
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
  const response = await requireTeamClient().updatePlanningProject({
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
  const response = await requireTeamClient().deletePlanningProject(
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
  const response = await requireTeamClient().moveIssueToPlanningProject(
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
  return requireTeamClient().resolveIssueHierarchyLocation(
    { sourceTeamId, runId },
    appCallOptions(token),
  );
}

export async function listTeams(
  token: string,
  signal?: AbortSignal,
): Promise<Project[]> {
  const client = requireTeamClient();
  const response = await client.listTeams(
    {},
    appCallOptions(token, signal),
  );
  return response.teams.map(teamFromMessage);
}

export async function createTeam(
  token: string,
  input: { readonly name: string; readonly organizationId?: string },
): Promise<{ project: Project; agentToken: string }> {
  const client = requireTeamClient();
  const response = await client.createTeam(input, appCallOptions(token));
  return {
    project: teamFromMessage(
      requiredMessage(response.team, "createTeam.team"),
    ),
    agentToken: response.agentToken,
  };
}

export async function deleteTeam(token: string, projectId: string) {
  const client = requireTeamClient();
  const response = await client.deleteTeam(
    { teamId: projectId },
    appCallOptions(token),
  );
  if (!response.deleted) throw new Error("Project was not deleted");
}

export type TeamIconUpdate =
  | { readonly type: "image"; readonly dataUrl: string }
  | { readonly type: "named"; readonly name: string; readonly color: string | null }
  | { readonly type: "clear" };

export async function updateTeamIcon(
  token: string,
  projectId: string,
  update: TeamIconUpdate,
): Promise<{ project: Project }> {
  const client = requireTeamClient();
  const response = await client.updateTeamIcon(
    {
      teamId: projectId,
      iconUpdate:
        update.type === "image"
          ? { case: "icon", value: update.dataUrl }
          : update.type === "clear"
          ? { case: "clearIcon", value: {} }
          : {
              case: "namedIcon",
              value: { name: update.name, color: update.color ?? undefined },
            },
    },
    appCallOptions(token),
  );
  return {
    project: teamFromMessage(
      requiredMessage(response.team, "updateTeamIcon.team"),
    ),
  };
}

export async function updateTeamIssueKeyPrefix(
  token: string,
  projectId: string,
  issueKeyPrefix: string,
): Promise<{ project: Project }> {
  const client = requireTeamClient();
  const response = await client.updateTeamIssueKeyPrefix(
    { teamId: projectId, issueKeyPrefix },
    appCallOptions(token),
  );
  return {
    project: teamFromMessage(
      requiredMessage(
        response.team,
        "updateTeamIssueKeyPrefix.team",
      ),
    ),
  };
}

export async function updateTeamTabs(
  token: string,
  projectId: string,
  tabs: { readonly schedule: boolean },
): Promise<{ project: Project }> {
  const client = requireTeamClient();
  const response = await client.updateTeamTabs(
    { teamId: projectId, schedule: tabs.schedule },
    appCallOptions(token),
  );
  return {
    project: teamFromMessage(
      requiredMessage(response.team, "updateTeamTabs.team"),
    ),
  };
}

export async function createAgentToken(token: string, projectId: string) {
  const client = requireTeamClient();
  const response = await client.createTeamAgentToken(
    { teamId: projectId },
    appCallOptions(token),
  );
  return { agentToken: response.agentToken };
}

export async function updateTeamSettings(
  token: string,
  projectId: string,
  settings: ProjectSettings,
) {
  const client = requireTeamClient();
  const response = await client.updateTeamSettings(
    {
      teamId: projectId,
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
    settings: teamSettingsFromProto(
      requiredMessage(response.settings, "updateTeamSettings.settings"),
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
    >["teamMandatory"];
    expectedRevision: number;
  },
) {
  const client = requireTeamClient();
  const response = await client.updateCheckpointPolicy(
    {
      teamId: projectId,
      scope: input.scope === "project"
        ? UpdateCheckpointPolicyRequest_Scope.TEAM
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

export async function loadTeamExecutionWorkerPolicy(
  token: string,
  projectId: string,
) {
  const client = requireTeamClient();
  const response = await client.getTeamExecutionWorkerPolicy(
    { teamId: projectId },
    appCallOptions(token),
  );
  return {
    policy: requiredExecutionPolicy(response.policy),
  };
}

export async function updateTeamExecutionWorkerPolicy(
  token: string,
  projectId: string,
  policy: Pick<
    ProjectExecutionWorkerPolicy,
    "selectionMode" | "defaultWorkerId" | "allowedWorkerIds"
  >,
) {
  const client = requireTeamClient();
  const response = await client.updateTeamExecutionWorkerPolicy(
    {
      teamId: projectId,
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
