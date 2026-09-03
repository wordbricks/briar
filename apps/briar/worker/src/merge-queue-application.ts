import {
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import {
  decodeStoredMergeQueueValidationCommands,
} from "../../src/lib/merge-queue-validation-contract";
import {
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
} from "./github-connection-repository";
import { configureMergeQueueProfile, getMergeQueueProfile } from "./merge-queue-profile";
import { getMergeQueueStatus } from "./merge-queue-status";
import { hasOrganizationCapability } from "./organization-access";
import { getTeam } from "./team-command-repository";
import { validationCommandsFromStage } from "./team-configuration-application";
import { getTeamSettings } from "./team-settings-repository";

const DEFAULT_MERGE_QUEUE_QUIET_WINDOW_MS = 300_000;
const DEFAULT_MERGE_QUEUE_MAX_BATCH_SIZE = 5;

export type MergeQueueApplicationErrorReason =
  | "active_batch"
  | "development_management_required"
  | "github_app_not_connected"
  | "github_repository_not_installed"
  | "lane_owned"
  | "project_not_found"
  | "readiness_stage_required"
  | "repository_not_configured"
  | "validation_commands_required"
  | "workflow_boundary_conflict";

export class MergeQueueApplicationError extends Error {
  readonly name = "MergeQueueApplicationError";

  constructor(
    readonly reason: MergeQueueApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type MergeQueueApplicationServices = {
  readonly configureMergeQueueProfile: typeof configureMergeQueueProfile;
  readonly getGithubConnectionForOrganization: typeof getGithubConnectionForOrganization;
  readonly getMergeQueueProfile: typeof getMergeQueueProfile;
  readonly getMergeQueueStatus: typeof getMergeQueueStatus;
  readonly getTeam: typeof getTeam;
  readonly getTeamSettings: typeof getTeamSettings;
  readonly listGithubConnectionRepositories: typeof listGithubConnectionRepositories;
};

export const mergeQueueApplicationServices: MergeQueueApplicationServices = {
  configureMergeQueueProfile,
  getGithubConnectionForOrganization,
  getMergeQueueProfile,
  getMergeQueueStatus,
  getTeam,
  getTeamSettings,
  listGithubConnectionRepositories,
};

const requireProject = async (
  db: D1Database,
  projectId: string,
  userId: string,
  services: MergeQueueApplicationServices,
) => {
  const project = await services.getTeam(db, projectId, userId);
  if (!project) {
    throw new MergeQueueApplicationError("project_not_found", "Project not found");
  }
  return project;
};

export async function getMergeQueueProfileApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: MergeQueueApplicationServices = mergeQueueApplicationServices,
) {
  const project = await requireProject(input.db, input.projectId, input.userId, services);
  return services.getMergeQueueProfile(input.db, project.id);
}

export async function getMergeQueueStatusApplication(
  input: {
    readonly db: D1Database;
    readonly generatedAt: string;
    readonly projectId: string;
    readonly userId: string;
  },
  services: MergeQueueApplicationServices = mergeQueueApplicationServices,
) {
  const project = await requireProject(input.db, input.projectId, input.userId, services);
  return {
    ...(await services.getMergeQueueStatus(input.db, project.id)),
    generatedAt: input.generatedAt,
  };
}

export async function updateMergeQueueProfileApplication(
  input: {
    readonly command: {
      readonly enabled: boolean;
      readonly maxBatchSize?: number;
      readonly quietWindowMs?: number;
      readonly readinessStageId?: string;
    };
    readonly db: D1Database;
    readonly observedAt: string;
    readonly projectId: string;
    readonly userId: string;
  },
  services: MergeQueueApplicationServices = mergeQueueApplicationServices,
) {
  const project = await requireProject(input.db, input.projectId, input.userId, services);
  if (!hasOrganizationCapability(project.member_role, "development:manage")) {
    throw new MergeQueueApplicationError(
      "development_management_required",
      "Development management permission required",
    );
  }

  const current = await services.getMergeQueueProfile(input.db, project.id);
  const settings = await services.getTeamSettings(input.db, project.id);
  const readinessStageId = input.command.readinessStageId ?? current?.readiness_stage_id;
  if (!readinessStageId) {
    throw new MergeQueueApplicationError(
      "readiness_stage_required",
      "Choose a workflow stage before enabling the merge queue",
    );
  }

  const workflow = settings?.workflow_json
    ? normalizeAutoHuntWorkflow(JSON.parse(settings.workflow_json))
    : null;
  const readinessStage = workflow?.stages.find((stage) => stage.id === readinessStageId);
  if (input.command.enabled && !readinessStage) {
    throw new MergeQueueApplicationError(
      "workflow_boundary_conflict",
      "The merge queue readiness stage is not in the project workflow",
    );
  }
  const validationCommands = readinessStage
    ? validationCommandsFromStage(readinessStage)
    : current
      ? decodeStoredMergeQueueValidationCommands(current.validation_commands_json)
      : [];
  if (input.command.enabled && validationCommands.length === 0) {
    throw new MergeQueueApplicationError(
      "validation_commands_required",
      "The merge queue boundary stage needs at least one validation command",
    );
  }

  const repository =
    !input.command.enabled && current
      ? {
          repository_id: current.repository_id,
          full_name: current.repository,
        }
      : await (async () => {
          const repositoryName = settings?.github_repository?.trim().toLowerCase();
          if (!repositoryName) {
            throw new MergeQueueApplicationError(
              "repository_not_configured",
              "Connect one GitHub repository before configuring its merge queue",
            );
          }
          const connection = await services.getGithubConnectionForOrganization(
            input.db,
            project.organization_id,
          );
          if (!connection) {
            throw new MergeQueueApplicationError(
              "github_app_not_connected",
              "GitHub integration is not connected",
            );
          }
          const connectedRepository = (
            await services.listGithubConnectionRepositories(input.db, connection.installation_id)
          ).find((candidate) => candidate.full_name.toLowerCase() === repositoryName);
          if (!connectedRepository) {
            throw new MergeQueueApplicationError(
              "github_repository_not_installed",
              "The configured repository is not included in the GitHub installation",
            );
          }
          return connectedRepository;
        })();

  const configured = await services.configureMergeQueueProfile(input.db, {
    projectId: project.id,
    repositoryId: repository.repository_id,
    repository: repository.full_name,
    enabled: input.command.enabled,
    readinessStageId,
    validationCommands,
    quietWindowMs:
      input.command.quietWindowMs ??
      current?.quiet_window_ms ??
      DEFAULT_MERGE_QUEUE_QUIET_WINDOW_MS,
    maxBatchSize:
      input.command.maxBatchSize ?? current?.max_batch_size ?? DEFAULT_MERGE_QUEUE_MAX_BATCH_SIZE,
    observedAt: input.observedAt,
  });
  switch (configured.outcome) {
    case "updated":
      return configured.profile;
    case "active_batch":
      throw new MergeQueueApplicationError(
        "active_batch",
        "Drain the active merge batch before changing or disabling its lane",
      );
    case "lane_owned":
      throw new MergeQueueApplicationError(
        "lane_owned",
        "Another Briar project already owns this repository/main lane",
      );
  }
}
