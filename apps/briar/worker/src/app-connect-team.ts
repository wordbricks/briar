import {
  MoveIssueToPlanningProjectResponse_Outcome,
  PlanningProjectSchema,
  PlanningProjectStatus,
  TeamExecutionWorkerPolicy_SelectionMode,
  TeamService,
  UpdateCheckpointPolicyRequest_Scope,
} from "@briar/contracts/gen/briar/app/v1/team_pb";
import type { NullableStringUpdate } from "@briar/contracts/gen/briar/app/v1/team_pb";
import { ProjectRole } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  WorkflowCheckpoint_Position,
  type AutoHuntWorkflow as AutoHuntWorkflowMessage,
  type WorkflowCheckpointSpec,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import { normalizeProjectAgentLocale } from "../../src/lib/project-agent";
import type {
  AutoHuntWorkflowCheckpoint,
  AutoHuntWorkflowInput,
  AutoHuntWorkflowRequirement,
} from "../../src/lib/auto-hunt-contract";
import { processArchiveCleanupQueue } from "./archive";
import type { BriarAuth } from "./auth";

import {
  appCheckpointPolicy,
  appExecutionPolicy,
  appProject,
  appProjectSettings,
} from "./app-connect-mappers";
import { HttpError } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  createPlanningProject,
  deletePlanningProject,
  getDefaultProjectForTeam,
  getPlanningProjectForUser,
  getTeamForUser,
  listTeamProjects,
  moveIssueWithinTeam,
  resolveIssueHierarchyLocation,
  updatePlanningProject,
  type PlanningProjectRow,
} from "./hierarchy-repository";
import {
  decodePlanningProjectCreateInput,
  decodePlanningProjectUpdateInput,
} from "./hierarchy-request-contract";
import {
  getTeamExecutionWorkerPolicyApplication,
  TeamConfigurationApplicationError,
  updateCheckpointPolicyApplication,
  updateTeamExecutionWorkerPolicyApplication,
  updateTeamSettingsApplication,
} from "./team-configuration-application";
import {
  createTeamAgentTokenApplication,
  createTeamApplication,
  deleteTeamApplication,
  TeamApplicationError,
  updateTeamIconApplication,
  updateTeamIssueKeyPrefixApplication,
  updateTeamTabsApplication,
} from "./team-application";
import { listTeams } from "./team-repository";
import { settingsJson } from "./team-settings-json";
import { schedulePostCommitCleanup } from "./post-commit-cleanup";
import {
  scheduleInboxRealtimeFlush,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { decodeRequestSync } from "./request-schema";
import {
  decodeCheckpointPolicyInput,
  parseProjectSettingsInput,
} from "./run-request-contract";
import { NonNegativeSafeInteger, UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { checkpointPolicyJson } from "./workflow-policy";
import { WorkerConflictError } from "./workers";
import { decodeExecutionWorkerPolicy } from "./worker-request-contract";

export type AppConnectTeamInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectTeamServices = {
  readonly createAgentToken: typeof createTeamAgentTokenApplication;
  readonly createTeam: typeof createTeamApplication;
  readonly deleteTeam: typeof deleteTeamApplication;
  readonly getExecutionWorkerPolicy:
    typeof getTeamExecutionWorkerPolicyApplication;
  readonly listTeams: typeof listTeams;
  readonly listTeamProjects: typeof listTeamProjects;
  readonly getPlanningProject: typeof getPlanningProjectForUser;
  readonly getTeam: typeof getTeamForUser;
  readonly createPlanningProject: typeof createPlanningProject;
  readonly deletePlanningProject: typeof deletePlanningProject;
  readonly getDefaultPlanningProject: typeof getDefaultProjectForTeam;
  readonly updatePlanningProject: typeof updatePlanningProject;
  readonly moveIssueWithinTeam: typeof moveIssueWithinTeam;
  readonly resolveIssueHierarchyLocation: typeof resolveIssueHierarchyLocation;
  readonly requireSession: typeof requireSession;
  readonly updateIcon: typeof updateTeamIconApplication;
  readonly updateCheckpointPolicy: typeof updateCheckpointPolicyApplication;
  readonly updateExecutionWorkerPolicy:
    typeof updateTeamExecutionWorkerPolicyApplication;
  readonly updateIssueKeyPrefix: typeof updateTeamIssueKeyPrefixApplication;
  readonly updateSettings: typeof updateTeamSettingsApplication;
  readonly updateTabs: typeof updateTeamTabsApplication;
};

export const appConnectTeamServices: AppConnectTeamServices = {
  createAgentToken: createTeamAgentTokenApplication,
  createTeam: createTeamApplication,
  deleteTeam: deleteTeamApplication,
  getExecutionWorkerPolicy: getTeamExecutionWorkerPolicyApplication,
  listTeams,
  listTeamProjects,
  getPlanningProject: getPlanningProjectForUser,
  getTeam: getTeamForUser,
  createPlanningProject,
  deletePlanningProject,
  getDefaultPlanningProject: getDefaultProjectForTeam,
  updatePlanningProject,
  moveIssueWithinTeam,
  resolveIssueHierarchyLocation,
  requireSession,
  updateIcon: updateTeamIconApplication,
  updateCheckpointPolicy: updateCheckpointPolicyApplication,
  updateExecutionWorkerPolicy: updateTeamExecutionWorkerPolicyApplication,
  updateIssueKeyPrefix: updateTeamIssueKeyPrefixApplication,
  updateSettings: updateTeamSettingsApplication,
  updateTabs: updateTeamTabsApplication,
};

const decodeUuid = decodeRequestSync(UuidString);
const decodeRevision = decodeRequestSync(NonNegativeSafeInteger);

const planningStatus = {
  planned: PlanningProjectStatus.PLANNED,
  active: PlanningProjectStatus.ACTIVE,
  completed: PlanningProjectStatus.COMPLETED,
  cancelled: PlanningProjectStatus.CANCELLED,
} as const;

const planningStatusFromProto = (value: PlanningProjectStatus) => {
  switch (value) {
    case PlanningProjectStatus.PLANNED: return "planned" as const;
    case PlanningProjectStatus.ACTIVE: return "active" as const;
    case PlanningProjectStatus.COMPLETED: return "completed" as const;
    case PlanningProjectStatus.CANCELLED: return "cancelled" as const;
    default: throw new ConnectError("planning project status is invalid", Code.InvalidArgument);
  }
};

const role = {
  owner: ProjectRole.OWNER,
  "co-owner": ProjectRole.CO_OWNER,
  developer: ProjectRole.DEVELOPER,
  editor: ProjectRole.EDITOR,
  viewer: ProjectRole.VIEWER,
} as const;

const validTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid planning project timestamp");
  return timestampFromDate(date);
};

const planningProjectMessage = (row: PlanningProjectRow) =>
  create(PlanningProjectSchema, {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    teamId: row.team_id,
    teamName: row.team_name,
    name: row.name,
    description: row.description,
    status: planningStatus[row.status],
    leadUserId: row.lead_user_id ?? undefined,
    leadName: row.lead_name ?? undefined,
    startDate: row.start_date ?? undefined,
    targetDate: row.target_date ?? undefined,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    sortOrder: row.sort_order,
    isDefault: row.is_default !== 0,
    role: role[row.role],
    createdAt: validTimestamp(row.created_at),
    updatedAt: validTimestamp(row.updated_at),
  });

const nullableUpdate = (value: NullableStringUpdate | undefined) => {
  if (!value || value.update.case === undefined) return undefined;
  return value.update.case === "value" ? value.update.value : null;
};

const requirePlanningWrite = (value: keyof typeof role) => {
  if (!hasOrganizationCapability(value, "issues:write")) {
    throw new HttpError(403, "Team project editing permission required");
  }
};

const requiredMessage = <A>(value: A | undefined, field: string): A => {
  if (value === undefined) {
    throw new ConnectError(`${field} is required`, Code.InvalidArgument);
  }
  return value;
};

const checkpointPosition = (
  value: WorkflowCheckpoint_Position,
): AutoHuntWorkflowCheckpoint["position"] => {
  switch (value) {
    case WorkflowCheckpoint_Position.BEFORE:
      return "before";
    case WorkflowCheckpoint_Position.AFTER:
      return "after";
    default:
      throw new ConnectError(
        `Unknown checkpoint position: ${value}`,
        Code.InvalidArgument,
      );
  }
};

const checkpointFromMessage = (
  checkpoint: WorkflowCheckpointSpec,
): AutoHuntWorkflowCheckpoint => ({
  key: checkpoint.key,
  stage: checkpoint.stage,
  position: checkpointPosition(checkpoint.position),
});

const workflowInputFromMessage = (
  workflow: AutoHuntWorkflowMessage,
): AutoHuntWorkflowInput => ({
  version: workflow.version,
  requirements: workflow.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    kind: requirement.kind as AutoHuntWorkflowRequirement["kind"],
    tool: requirement.tool,
    reason: requirement.reason,
  })),
  stages: workflow.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    required: stage.required,
    evidence: stage.evidence,
    checks: stage.checks,
  })),
  execution: workflow.execution
    ? { checkpoints: workflow.execution.checkpoints.map(checkpointFromMessage) }
    : undefined,
  completion: workflow.completion
    ? { requiredStages: workflow.completion.requiredStages }
    : undefined,
});

const throwApplicationError = (error: unknown): never => {
  if (error instanceof TeamConfigurationApplicationError) {
    switch (error.reason) {
      case "development_management_required":
        throw new HttpError(403, error.message);
      case "project_not_found":
        throw new HttpError(404, error.message);
      case "invalid_configuration":
        throw new HttpError(400, error.message);
      case "checkpoint_policy_conflict":
      case "checkpoint_policy_incompatible":
      case "github_app_not_connected":
      case "github_repository_not_installed":
      case "merge_queue_workflow_boundary_conflict":
      case "merge_queue_workflow_validation_conflict":
        throw new HttpError(409, error.message);
    }
  }
  if (error instanceof WorkerConflictError) {
    throw new HttpError(409, error.message);
  }
  if (!(error instanceof TeamApplicationError)) throw error;
  switch (error.reason) {
    case "project_not_found":
      throw new HttpError(404, error.message);
    case "invalid_project_icon":
      throw new HttpError(400, error.message);
    case "development_management_required":
    case "project_management_required":
    case "repository_connection_permission_denied":
      throw new HttpError(403, error.message);
    case "transfer_reconciliation_required":
      throw new HttpError(
        409,
        error.message,
        "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
      );
  }
};

const withApplicationErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    return throwApplicationError(error);
  }
};

export const createAppTeamService = (
  { request, auth, db, env, context }: AppConnectTeamInput,
  services: AppConnectTeamServices = appConnectTeamServices,
): ServiceImpl<typeof TeamService> => ({
  listTeams: async () => {
    const session = await services.requireSession(auth, request);
    const rows = await services.listTeams(db, session.user.id);
    return { teams: rows.map(appProject) };
  },

  listTeamPlanningProjects: async (input) => {
    const session = await services.requireSession(auth, request);
    const team = await services.getTeam(db, decodeUuid(input.teamId), session.user.id);
    if (!team) throw new HttpError(404, "Team not found");
    const projects = await services.listTeamProjects(db, team.id, session.user.id);
    return { projects: projects.map(planningProjectMessage) };
  },

  createPlanningProject: async (input) => {
    const session = await services.requireSession(auth, request);
    const team = await services.getTeam(db, decodeUuid(input.teamId), session.user.id);
    if (!team) throw new HttpError(404, "Team not found");
    requirePlanningWrite(team.role);
    const body = decodePlanningProjectCreateInput({
      name: input.name,
      description: input.description,
      status: input.status === undefined ? undefined : planningStatusFromProto(input.status),
      leadUserId: input.leadUserId,
      startDate: input.startDate,
      targetDate: input.targetDate,
      icon: input.icon,
      color: input.color,
      sortOrder: input.sortOrder,
    });
    const projectId = await services.createPlanningProject(db, { teamId: team.id, ...body });
    const project = await services.getPlanningProject(db, projectId, session.user.id);
    if (!project) throw new Error("Created project is unavailable");
    return { project: planningProjectMessage(project) };
  },

  updatePlanningProject: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await services.getPlanningProject(db, decodeUuid(input.projectId), session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    requirePlanningWrite(project.role);
    const body = decodePlanningProjectUpdateInput({
      name: input.name,
      description: input.description,
      status: input.status === undefined ? undefined : planningStatusFromProto(input.status),
      leadUserId: nullableUpdate(input.leadUserId),
      startDate: nullableUpdate(input.startDate),
      targetDate: nullableUpdate(input.targetDate),
      icon: nullableUpdate(input.icon),
      color: nullableUpdate(input.color),
      sortOrder: input.sortOrder,
    });
    if (!(await services.updatePlanningProject(db, project.id, body))) {
      throw new HttpError(409, "The Team default project must remain available");
    }
    const updated = await services.getPlanningProject(db, project.id, session.user.id);
    if (!updated) throw new HttpError(404, "Project not found");
    return { project: planningProjectMessage(updated) };
  },

  deletePlanningProject: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await services.getPlanningProject(
      db,
      decodeUuid(input.projectId),
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    requirePlanningWrite(project.role);
    if (project.is_default !== 0) {
      throw new HttpError(409, "The Team default project must remain available");
    }
    const defaultProject = await services.getDefaultPlanningProject(
      db,
      project.team_id,
    );
    if (!defaultProject) {
      throw new HttpError(409, "The Team default project is unavailable");
    }
    const result = await services.deletePlanningProject(db, {
      projectId: project.id,
      teamId: project.team_id,
      defaultProjectId: defaultProject.id,
    });
    if (!result.deleted) throw new HttpError(404, "Project not found");
    scheduleProjectRealtimePublish(env, db, project.team_id, context);
    return result;
  },

  moveIssueToPlanningProject: async (input) => {
    const session = await services.requireSession(auth, request);
    const source = await services.getPlanningProject(db, decodeUuid(input.sourceProjectId), session.user.id);
    if (!source) throw new HttpError(404, "Project not found");
    requirePlanningWrite(source.role);
    const targetProjectId = decodeUuid(input.targetProjectId);
    const runId = decodeUuid(input.runId);
    const outcome = await services.moveIssueWithinTeam(db, {
      sourceProjectId: source.id,
      targetProjectId,
      runId,
      userId: session.user.id,
    });
    if (outcome === "not_found") throw new HttpError(404, "Issue not found");
    if (outcome === "different_team") {
      throw new HttpError(409, "Use a Team transfer to move an issue across repository boundaries", "ISSUE_TEAM_TRANSFER_REQUIRED");
    }
    const target = await services.getPlanningProject(db, targetProjectId, session.user.id);
    if (!target) throw new HttpError(404, "Target project not found");
    return {
      outcome: outcome === "moved"
        ? MoveIssueToPlanningProjectResponse_Outcome.MOVED
        : MoveIssueToPlanningProjectResponse_Outcome.SAME_PROJECT,
      issueId: runId,
      workspaceId: target.workspace_id,
      teamId: target.team_id,
      projectId: target.id,
    };
  },

  resolveIssueHierarchyLocation: async (input) => {
    const session = await services.requireSession(auth, request);
    const runId = decodeUuid(input.runId);
    const location = await services.resolveIssueHierarchyLocation(db, {
      sourceTeamId: decodeUuid(input.sourceTeamId),
      runId,
      userId: session.user.id,
    });
    if (!location) throw new HttpError(404, "Issue not found");
    return {
      runId,
      workspaceId: location.workspace_id,
      teamId: location.team_id,
      projectId: location.project_id,
      projectName: location.project_name,
    };
  },

  createTeam: async (input) => {
    const session = await services.requireSession(auth, request);
    const result = await withApplicationErrors(
      services.createTeam({
        db,
        user: session.user,
        name: input.name,
        organizationId: input.organizationId,
        locale: normalizeProjectAgentLocale(
          request.headers.get("accept-language"),
        ),
      }),
    );
    scheduleInboxRealtimeFlush(env, db, context);
    return { team: appProject(result.project), agentToken: result.agentToken };
  },

  deleteTeam: async (input) => {
    const session = await services.requireSession(auth, request);
    const result = await withApplicationErrors(
      services.deleteTeam({
        db,
        projectId: decodeUuid(input.teamId),
        userId: session.user.id,
      }),
    );
    void schedulePostCommitCleanup({
      context,
      operation: "project_delete",
      observedAt: result.observedAt,
      tasks: [{
        queue: "archive",
        run: () =>
          processArchiveCleanupQueue(
            db,
            env.ARCHIVES,
            env.ATTACHMENTS,
            result.observedAt,
            1_000,
          ),
      }],
    });
    scheduleProjectRealtimePublish(env, db, result.projectId, context);
    return { deleted: true };
  },

  updateTeamIcon: async (input) => {
    const session = await services.requireSession(auth, request);
    const iconUpdate =
      input.iconUpdate.case === "icon"
        ? { type: "image" as const, dataUrl: input.iconUpdate.value }
        : input.iconUpdate.case === "clearIcon"
        ? { type: "clear" as const }
        : input.iconUpdate.case === "namedIcon"
        ? {
            type: "named" as const,
            name: input.iconUpdate.value.name,
            color: input.iconUpdate.value.color ?? null,
          }
        : (() => {
          throw new ConnectError("icon update is required", Code.InvalidArgument);
        })();
    const project = await withApplicationErrors(
      services.updateIcon({
        db,
        projectId: decodeUuid(input.teamId),
        userId: session.user.id,
        iconUpdate,
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { team: appProject(project) };
  },

  updateTeamIssueKeyPrefix: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await withApplicationErrors(
      services.updateIssueKeyPrefix({
        db,
        projectId: decodeUuid(input.teamId),
        userId: session.user.id,
        issueKeyPrefix: input.issueKeyPrefix,
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { team: appProject(project) };
  },

  updateTeamTabs: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await withApplicationErrors(
      services.updateTabs({
        db,
        projectId: decodeUuid(input.teamId),
        userId: session.user.id,
        schedule: input.schedule,
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { team: appProject(project) };
  },

  createTeamAgentToken: async (input) => {
    const session = await services.requireSession(auth, request);
    const projectId = decodeUuid(input.teamId);
    const agentToken = await withApplicationErrors(
      services.createAgentToken({
        db,
        projectId,
        userId: session.user.id,
      }),
    );
    scheduleProjectRealtimePublish(env, db, projectId, context);
    return { agentToken };
  },

  updateTeamSettings: async (input) => {
    const session = await services.requireSession(auth, request);
    const projectId = decodeUuid(input.teamId);
    const linear = requiredMessage(input.linear, "linear");
    const workflow = requiredMessage(input.workflow, "workflow");
    const settings = parseProjectSettingsInput({
      velenOrg: input.velenOrg ?? null,
      dataSource: input.dataSource ?? null,
      linear: {
        enabled: linear.enabled,
        source: linear.source ?? null,
        teamKey: linear.teamKey ?? null,
      },
      githubRepository: input.githubRepository ?? null,
      workflow: workflowInputFromMessage(workflow),
    });
    const result = await withApplicationErrors(
      services.updateSettings({
        db,
        projectId,
        userId: session.user.id,
        settings,
      }),
    );
    scheduleProjectRealtimePublish(env, db, projectId, context);
    return {
      settings: appProjectSettings(settingsJson(
        result.settings,
        checkpointPolicyJson(result.checkpointPolicy),
      )),
    };
  },

  updateCheckpointPolicy: async (input) => {
    const session = await services.requireSession(auth, request);
    const projectId = decodeUuid(input.teamId);
    const scope = (() => {
      switch (input.scope) {
        case UpdateCheckpointPolicyRequest_Scope.TEAM:
          return "project" as const;
        case UpdateCheckpointPolicyRequest_Scope.USER:
          return "user" as const;
        default:
          throw new ConnectError("scope is required", Code.InvalidArgument);
      }
    })();
    const policy = await withApplicationErrors(
      services.updateCheckpointPolicy({
        db,
        projectId,
        userId: session.user.id,
        policy: decodeCheckpointPolicyInput({
          scope,
          checkpoints: input.checkpoints.map(checkpointFromMessage),
          expectedRevision: decodeRevision(Number(input.expectedRevision)),
        }),
      }),
    );
    scheduleProjectRealtimePublish(env, db, projectId, context);
    return { checkpointPolicy: appCheckpointPolicy(checkpointPolicyJson(policy)) };
  },

  getTeamExecutionWorkerPolicy: async (input) => {
    const session = await services.requireSession(auth, request);
    const policy = await withApplicationErrors(
      services.getExecutionWorkerPolicy({
        db,
        projectId: decodeUuid(input.teamId),
        userId: session.user.id,
      }),
    );
    return { policy: appExecutionPolicy(policy) };
  },

  updateTeamExecutionWorkerPolicy: async (input) => {
    const session = await services.requireSession(auth, request);
    const projectId = decodeUuid(input.teamId);
    const selectionMode = (() => {
      switch (input.selectionMode) {
        case TeamExecutionWorkerPolicy_SelectionMode.ANY:
          return "any" as const;
        case TeamExecutionWorkerPolicy_SelectionMode.ALLOWLIST:
          return "allowlist" as const;
        default:
          throw new ConnectError(
            "selection mode is required",
            Code.InvalidArgument,
          );
      }
    })();
    const policy = await withApplicationErrors(
      services.updateExecutionWorkerPolicy({
        db,
        projectId,
        userId: session.user.id,
        policy: decodeExecutionWorkerPolicy({
          selectionMode,
          defaultWorkerId: input.defaultWorkerId ?? null,
          allowedWorkerIds: input.allowedWorkerIds,
        }),
        observedAt: new Date().toISOString(),
      }),
    );
    scheduleProjectRealtimePublish(env, db, projectId, context);
    return { policy: appExecutionPolicy(policy) };
  },
});

export const registerAppTeamService = (
  router: ConnectRouter,
  input: AppConnectTeamInput,
  services: AppConnectTeamServices = appConnectTeamServices,
) => {
  router.service(TeamService, createAppTeamService(input, services));
};
