import {
  ProjectExecutionWorkerPolicy_SelectionMode,
  ProjectService,
  UpdateCheckpointPolicyRequest_Scope,
} from "@briar/contracts/gen/briar/app/v1/project_pb";
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
import { withConnectErrors } from "./app-connect-errors";
import {
  appCheckpointPolicy,
  appExecutionPolicy,
  appProject,
  appProjectSettings,
} from "./app-connect-mappers";
import { HttpError } from "./http-response";
import {
  getProjectExecutionWorkerPolicyApplication,
  ProjectConfigurationApplicationError,
  updateCheckpointPolicyApplication,
  updateProjectExecutionWorkerPolicyApplication,
  updateProjectSettingsApplication,
} from "./project-configuration-application";
import {
  createProjectAgentTokenApplication,
  createProjectApplication,
  deleteProjectApplication,
  ProjectApplicationError,
  updateProjectIconApplication,
  updateProjectIssueKeyPrefixApplication,
  updateProjectTabsApplication,
} from "./project-application";
import { listProjects } from "./project-repository";
import { settingsJson } from "./project-settings-json";
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

export type AppConnectProjectInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectProjectServices = {
  readonly createAgentToken: typeof createProjectAgentTokenApplication;
  readonly createProject: typeof createProjectApplication;
  readonly deleteProject: typeof deleteProjectApplication;
  readonly getExecutionWorkerPolicy:
    typeof getProjectExecutionWorkerPolicyApplication;
  readonly listProjects: typeof listProjects;
  readonly requireSession: typeof requireSession;
  readonly updateIcon: typeof updateProjectIconApplication;
  readonly updateCheckpointPolicy: typeof updateCheckpointPolicyApplication;
  readonly updateExecutionWorkerPolicy:
    typeof updateProjectExecutionWorkerPolicyApplication;
  readonly updateIssueKeyPrefix: typeof updateProjectIssueKeyPrefixApplication;
  readonly updateSettings: typeof updateProjectSettingsApplication;
  readonly updateTabs: typeof updateProjectTabsApplication;
};

export const appConnectProjectServices: AppConnectProjectServices = {
  createAgentToken: createProjectAgentTokenApplication,
  createProject: createProjectApplication,
  deleteProject: deleteProjectApplication,
  getExecutionWorkerPolicy: getProjectExecutionWorkerPolicyApplication,
  listProjects,
  requireSession,
  updateIcon: updateProjectIconApplication,
  updateCheckpointPolicy: updateCheckpointPolicyApplication,
  updateExecutionWorkerPolicy: updateProjectExecutionWorkerPolicyApplication,
  updateIssueKeyPrefix: updateProjectIssueKeyPrefixApplication,
  updateSettings: updateProjectSettingsApplication,
  updateTabs: updateProjectTabsApplication,
};

const decodeUuid = decodeRequestSync(UuidString);
const decodeRevision = decodeRequestSync(NonNegativeSafeInteger);

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
  if (error instanceof ProjectConfigurationApplicationError) {
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
  if (!(error instanceof ProjectApplicationError)) throw error;
  switch (error.reason) {
    case "project_not_found":
      throw new HttpError(404, error.message);
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

export const createAppProjectService = (
  { request, auth, db, env, context }: AppConnectProjectInput,
  services: AppConnectProjectServices = appConnectProjectServices,
): ServiceImpl<typeof ProjectService> => ({
  listProjects: async () =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const rows = await services.listProjects(db, session.user.id);
      return { projects: rows.map(appProject) };
    }),

  createProject: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const result = await withApplicationErrors(
        services.createProject({
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
      return { project: appProject(result.project), agentToken: result.agentToken };
    }),

  deleteProject: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const result = await withApplicationErrors(
        services.deleteProject({
          db,
          projectId: decodeUuid(input.projectId),
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
    }),

  updateProjectIcon: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const icon = input.iconUpdate.case === "icon"
        ? input.iconUpdate.value
        : input.iconUpdate.case === "clearIcon"
        ? null
        : (() => {
          throw new ConnectError("icon update is required", Code.InvalidArgument);
        })();
      const project = await withApplicationErrors(
        services.updateIcon({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
          icon,
        }),
      );
      scheduleProjectRealtimePublish(env, db, project.id, context);
      return { project: appProject(project) };
    }),

  updateProjectIssueKeyPrefix: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const project = await withApplicationErrors(
        services.updateIssueKeyPrefix({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
          issueKeyPrefix: input.issueKeyPrefix,
        }),
      );
      scheduleProjectRealtimePublish(env, db, project.id, context);
      return { project: appProject(project) };
    }),

  updateProjectTabs: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const project = await withApplicationErrors(
        services.updateTabs({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
          schedule: input.schedule,
        }),
      );
      scheduleProjectRealtimePublish(env, db, project.id, context);
      return { project: appProject(project) };
    }),

  createProjectAgentToken: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const projectId = decodeUuid(input.projectId);
      const agentToken = await withApplicationErrors(
        services.createAgentToken({
          db,
          projectId,
          userId: session.user.id,
        }),
      );
      scheduleProjectRealtimePublish(env, db, projectId, context);
      return { agentToken };
    }),

  updateProjectSettings: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const projectId = decodeUuid(input.projectId);
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
    }),

  updateCheckpointPolicy: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const projectId = decodeUuid(input.projectId);
      const scope = (() => {
        switch (input.scope) {
          case UpdateCheckpointPolicyRequest_Scope.PROJECT:
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
    }),

  getProjectExecutionWorkerPolicy: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const policy = await withApplicationErrors(
        services.getExecutionWorkerPolicy({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
        }),
      );
      return { policy: appExecutionPolicy(policy) };
    }),

  updateProjectExecutionWorkerPolicy: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const projectId = decodeUuid(input.projectId);
      const selectionMode = (() => {
        switch (input.selectionMode) {
          case ProjectExecutionWorkerPolicy_SelectionMode.ANY:
            return "any" as const;
          case ProjectExecutionWorkerPolicy_SelectionMode.ALLOWLIST:
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
    }),
});

export const registerAppProjectService = (
  router: ConnectRouter,
  input: AppConnectProjectInput,
  services: AppConnectProjectServices = appConnectProjectServices,
) => {
  router.service(ProjectService, createAppProjectService(input, services));
};
