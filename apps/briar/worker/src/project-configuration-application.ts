import {
  AutoHuntWorkflowValidationError,
  canonicalizeCheckpointSet,
} from "../../src/lib/auto-hunt-contract";
import {
  decodeStoredMergeQueueValidationCommands,
} from "../../src/lib/merge-queue-validation-contract";
import {
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
} from "./github-connection-repository";
import { getMergeQueueProfile } from "./merge-queue-profile";
import { hasOrganizationCapability } from "./organization-access";
import { getProject } from "./project-command-repository";
import {
  getProjectSettings,
  updateProjectMandatoryCheckpoints,
  updateProjectSettings,
  updateUserWorkflowCheckpointDefaults,
} from "./project-settings-repository";
import {
  decodeCheckpointPolicyInput,
  parseProjectSettingsInput,
} from "./run-request-contract";
import {
  assertStoredCheckpointPoliciesCompatible,
  isStoredWorkflowUnchanged,
  loadWorkflowCheckpointPolicy,
} from "./workflow-policy";
import {
  getProjectExecutionWorkerPolicy,
  updateProjectExecutionWorkerPolicy,
} from "./workers";
import { decodeExecutionWorkerPolicy } from "./worker-request-contract";

export type ProjectConfigurationApplicationErrorReason =
  | "checkpoint_policy_conflict"
  | "checkpoint_policy_incompatible"
  | "development_management_required"
  | "github_app_not_connected"
  | "github_repository_not_installed"
  | "invalid_configuration"
  | "merge_queue_workflow_boundary_conflict"
  | "merge_queue_workflow_validation_conflict"
  | "project_not_found";

export class ProjectConfigurationApplicationError extends Error {
  readonly name = "ProjectConfigurationApplicationError";

  constructor(
    readonly reason: ProjectConfigurationApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type ProjectConfigurationApplicationServices = {
  readonly assertStoredCheckpointPoliciesCompatible:
    typeof assertStoredCheckpointPoliciesCompatible;
  readonly getGithubConnectionForOrganization:
    typeof getGithubConnectionForOrganization;
  readonly getMergeQueueProfile: typeof getMergeQueueProfile;
  readonly getProject: typeof getProject;
  readonly getProjectExecutionWorkerPolicy:
    typeof getProjectExecutionWorkerPolicy;
  readonly getProjectSettings: typeof getProjectSettings;
  readonly listGithubConnectionRepositories:
    typeof listGithubConnectionRepositories;
  readonly loadWorkflowCheckpointPolicy: typeof loadWorkflowCheckpointPolicy;
  readonly updateProjectExecutionWorkerPolicy:
    typeof updateProjectExecutionWorkerPolicy;
  readonly updateProjectMandatoryCheckpoints:
    typeof updateProjectMandatoryCheckpoints;
  readonly updateProjectSettings: typeof updateProjectSettings;
  readonly updateUserWorkflowCheckpointDefaults:
    typeof updateUserWorkflowCheckpointDefaults;
};

const projectConfigurationApplicationServices:
  ProjectConfigurationApplicationServices = {
    assertStoredCheckpointPoliciesCompatible,
    getGithubConnectionForOrganization,
    getMergeQueueProfile,
    getProject,
    getProjectExecutionWorkerPolicy,
    getProjectSettings,
    listGithubConnectionRepositories,
    loadWorkflowCheckpointPolicy,
    updateProjectExecutionWorkerPolicy,
    updateProjectMandatoryCheckpoints,
    updateProjectSettings,
    updateUserWorkflowCheckpointDefaults,
  };

const requireProject = async (
  db: D1Database,
  projectId: string,
  userId: string,
  services: ProjectConfigurationApplicationServices,
) => {
  const project = await services.getProject(db, projectId, userId);
  if (!project) {
    throw new ProjectConfigurationApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return project;
};

const requireDevelopmentManagement = (
  project: Awaited<ReturnType<typeof getProject>> & {},
) => {
  if (!hasOrganizationCapability(project.member_role, "development:manage")) {
    throw new ProjectConfigurationApplicationError(
      "development_management_required",
      "Development management permission required",
    );
  }
};

export const validationCommandsFromStage = (
  stage: { checks?: unknown } | undefined,
) => stage && Array.isArray(stage.checks)
  ? stage.checks.filter((check): check is string =>
      typeof check === "string" && check.trim().length > 0
    ).map((check) => check.trim())
  : [];

export async function updateProjectSettingsApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly settings: ReturnType<typeof parseProjectSettingsInput>;
  },
  services: ProjectConfigurationApplicationServices =
    projectConfigurationApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    services,
  );
  requireDevelopmentManagement(project);

  const workflow = input.settings.workflow;

  const [currentSettings, mergeQueueProfile] = await Promise.all([
    services.getProjectSettings(input.db, project.id),
    services.getMergeQueueProfile(input.db, project.id),
  ]);
  if (
    mergeQueueProfile?.enabled === 1 &&
    !workflow.stages.some((stage) =>
      stage.id === mergeQueueProfile.readiness_stage_id
    )
  ) {
    throw new ProjectConfigurationApplicationError(
      "merge_queue_workflow_boundary_conflict",
      "Disable the merge queue before removing its workflow boundary stage",
    );
  }
  if (mergeQueueProfile?.enabled === 1) {
    const boundary = workflow.stages.find((stage) =>
      stage.id === mergeQueueProfile.readiness_stage_id
    );
    const storedCommands = decodeStoredMergeQueueValidationCommands(
      mergeQueueProfile.validation_commands_json,
    );
    if (
      JSON.stringify(validationCommandsFromStage(boundary)) !==
        JSON.stringify(storedCommands)
    ) {
      throw new ProjectConfigurationApplicationError(
        "merge_queue_workflow_validation_conflict",
        "Disable the merge queue before changing its workflow validation commands",
      );
    }
  }
  if (
    !isStoredWorkflowUnchanged(currentSettings?.workflow_json, workflow)
  ) {
    try {
      await services.assertStoredCheckpointPoliciesCompatible(
        input.db,
        project.id,
        workflow,
      );
    } catch (error) {
      if (error instanceof AutoHuntWorkflowValidationError) {
        throw new ProjectConfigurationApplicationError(
          "checkpoint_policy_incompatible",
          error.message,
        );
      }
      throw error;
    }
  }

  const githubRepository = input.settings.githubRepository
    ? await (async () => {
        const connection = await services.getGithubConnectionForOrganization(
          input.db,
          project.organization_id,
        );
        if (!connection) {
          throw new ProjectConfigurationApplicationError(
            "github_app_not_connected",
            "Connect the organization GitHub App before selecting a project repository",
          );
        }
        const repository = (await services.listGithubConnectionRepositories(
          input.db,
          connection.installation_id,
        )).find((candidate) =>
          candidate.full_name.toLowerCase() ===
            input.settings.githubRepository!.toLowerCase()
        );
        if (!repository) {
          throw new ProjectConfigurationApplicationError(
            "github_repository_not_installed",
            "The selected repository is not included in the GitHub App installation",
          );
        }
        return repository;
      })()
    : null;
  const settings = await services.updateProjectSettings(input.db, project.id, {
    velenOrg: input.settings.velenOrg ?? null,
    dataSource: input.settings.dataSource ?? null,
    linear: input.settings.linear,
    githubRepositoryId: githubRepository?.repository_id ?? null,
    githubRepository: githubRepository?.full_name ?? null,
    workflow,
  });
  const checkpointPolicy = await services.loadWorkflowCheckpointPolicy(
    input.db,
    project.id,
    input.userId,
  );
  return { settings, checkpointPolicy };
}

export async function updateCheckpointPolicyApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly policy: ReturnType<typeof decodeCheckpointPolicyInput>;
  },
  services: ProjectConfigurationApplicationServices =
    projectConfigurationApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    services,
  );
  if (input.policy.scope === "project") requireDevelopmentManagement(project);
  const current = await services.loadWorkflowCheckpointPolicy(
    input.db,
    project.id,
    input.userId,
  );
  let checkpoints;
  try {
    checkpoints = canonicalizeCheckpointSet(
      current.workflow,
      input.policy.checkpoints,
      input.policy.scope,
    );
  } catch (error) {
    if (error instanceof AutoHuntWorkflowValidationError) {
      throw new ProjectConfigurationApplicationError(
        "invalid_configuration",
        error.message,
      );
    }
    throw error;
  }
  const updated = input.policy.scope === "project"
    ? await services.updateProjectMandatoryCheckpoints(
        input.db,
        project.id,
        checkpoints,
        input.policy.expectedRevision,
      )
    : await services.updateUserWorkflowCheckpointDefaults(
        input.db,
        project.id,
        input.userId,
        checkpoints,
        input.policy.expectedRevision,
      );
  if (!updated) {
    throw new ProjectConfigurationApplicationError(
      "checkpoint_policy_conflict",
      "Checkpoint policy changed; reload before saving",
    );
  }
  return services.loadWorkflowCheckpointPolicy(
    input.db,
    project.id,
    input.userId,
  );
}

export async function getProjectExecutionWorkerPolicyApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: ProjectConfigurationApplicationServices =
    projectConfigurationApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    services,
  );
  return services.getProjectExecutionWorkerPolicy(input.db, project.id);
}

export async function updateProjectExecutionWorkerPolicyApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly policy: ReturnType<typeof decodeExecutionWorkerPolicy>;
    readonly observedAt: string;
  },
  services: ProjectConfigurationApplicationServices =
    projectConfigurationApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    services,
  );
  requireDevelopmentManagement(project);
  return services.updateProjectExecutionWorkerPolicy(input.db, project.id, {
    selectionMode: input.policy.selectionMode,
    defaultWorkerId: input.policy.defaultWorkerId,
    allowedWorkerIds: input.policy.allowedWorkerIds,
    updatedByUserId: input.userId,
    observedAt: input.observedAt,
  });
}
