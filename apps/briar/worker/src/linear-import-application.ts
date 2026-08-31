import {
  autoHuntPersistedRunStatuses,
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  type AutoHuntPersistedRunStatus,
} from "../../src/lib/auto-hunt-contract";
import {
  defaultPlacementForLinearType,
  linearSourceKey,
  mapLinearPriority,
} from "../../src/lib/linear-import";
import * as Schema from "effect/Schema";
import { hasOrganizationCapability } from "./organization-access";
import {
  fetchLinearIssuesForTeams,
  fetchLinearViewerAndTeams,
  fetchLinearWorkflowStates,
  LINEAR_IMPORT_ISSUE_LIMIT,
} from "./linear";
import { importLinearHuntRuns } from "./linear-import-repository";
import { getProject } from "./project-command-repository";
import { getProjectSettings } from "./project-settings-repository";
import {
  mutableArray,
  strictSchema,
  trimmedText,
} from "./schema-codecs";
import { WorkflowStageId } from "./run-request-contract";

export const LinearImportApiKey = trimmedText(10, 500);

const uniqueValues = <A>(values: readonly A[]) =>
  new Set(values).size === values.length ? undefined : "Values must be unique";

export const LinearImportTeamIds = mutableArray(
  trimmedText(1, 100),
).check(
  Schema.isLengthBetween(1, 50),
  Schema.isUnique(),
);

export const LinearImportStatusMapping = strictSchema(Schema.Struct({
  stateId: trimmedText(1, 100),
  status: Schema.Literals(autoHuntPersistedRunStatuses),
  workflowStage: Schema.NullOr(WorkflowStageId),
}).check(
  Schema.makeFilter((mapping) =>
    (mapping.status === "running") === (mapping.workflowStage !== null)
      ? undefined
      : "Running mappings require one workflow stage",
  ),
));

export const LinearImportStatusMappings = mutableArray(
  LinearImportStatusMapping,
).check(
  Schema.isLengthBetween(1, 500),
  Schema.makeFilter((mappings) =>
    uniqueValues(mappings.map((mapping) => mapping.stateId))
      ? "Linear state IDs must be unique"
      : undefined
  ),
);

export type LinearImportStatusMapping = typeof LinearImportStatusMapping.Type;

export type LinearImportApplicationErrorReason =
  | "development_management_required"
  | "invalid_status_mapping"
  | "project_not_found";

export class LinearImportApplicationError extends Error {
  readonly name = "LinearImportApplicationError";

  constructor(
    readonly reason: LinearImportApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type LinearImportApplicationServices = {
  readonly fetchLinearIssuesForTeams: typeof fetchLinearIssuesForTeams;
  readonly fetchLinearViewerAndTeams: typeof fetchLinearViewerAndTeams;
  readonly fetchLinearWorkflowStates: typeof fetchLinearWorkflowStates;
  readonly getProject: typeof getProject;
  readonly getProjectSettings: typeof getProjectSettings;
  readonly importLinearHuntRuns: typeof importLinearHuntRuns;
};

export const linearImportApplicationServices: LinearImportApplicationServices = {
  fetchLinearIssuesForTeams,
  fetchLinearViewerAndTeams,
  fetchLinearWorkflowStates,
  getProject,
  getProjectSettings,
  importLinearHuntRuns,
};

const requireDevelopmentProject = async (
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: LinearImportApplicationServices,
) => {
  const project = await services.getProject(
    input.db,
    input.projectId,
    input.userId,
  );
  if (!project) {
    throw new LinearImportApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  if (!hasOrganizationCapability(project.member_role, "development:manage")) {
    throw new LinearImportApplicationError(
      "development_management_required",
      "Development management permission required",
    );
  }
  return project;
};

export async function connectLinearImportApplication(
  input: {
    readonly apiKey: string;
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: LinearImportApplicationServices = linearImportApplicationServices,
) {
  await requireDevelopmentProject(input, services);
  return services.fetchLinearViewerAndTeams(input.apiKey);
}

export async function listLinearImportStatesApplication(
  input: {
    readonly apiKey: string;
    readonly db: D1Database;
    readonly projectId: string;
    readonly teamIds: string[];
    readonly userId: string;
  },
  services: LinearImportApplicationServices = linearImportApplicationServices,
) {
  await requireDevelopmentProject(input, services);
  return services.fetchLinearWorkflowStates(input.apiKey, input.teamIds);
}

export async function importLinearIssuesApplication(
  input: {
    readonly apiKey: string;
    readonly db: D1Database;
    readonly projectId: string;
    readonly statusMappings: readonly LinearImportStatusMapping[];
    readonly teamIds: string[];
    readonly userId: string;
  },
  services: LinearImportApplicationServices = linearImportApplicationServices,
) {
  const project = await requireDevelopmentProject(input, services);
  const settings = await services.getProjectSettings(input.db, project.id);
  const workflow = settings?.workflow_json
    ? normalizeAutoHuntWorkflow(JSON.parse(settings.workflow_json))
    : cloneAutoHuntWorkflow();
  const firstStageId = workflow.stages[0]?.id ?? null;
  const workflowStageIds = new Set(workflow.stages.map((stage) => stage.id));
  const statusMap = new Map<
    string,
    { status: AutoHuntPersistedRunStatus; workflowStage: string | null }
  >();
  for (const mapping of input.statusMappings) {
    if (
      mapping.workflowStage !== null &&
      !workflowStageIds.has(mapping.workflowStage)
    ) {
      throw new LinearImportApplicationError(
        "invalid_status_mapping",
        "A Linear status mapping targets an unknown workflow stage",
      );
    }
    statusMap.set(mapping.stateId, {
      status: mapping.status,
      workflowStage: mapping.workflowStage,
    });
  }

  const { issues, truncated } = await services.fetchLinearIssuesForTeams(
    input.apiKey,
    input.teamIds,
    LINEAR_IMPORT_ISSUE_LIMIT,
  );
  const runs = issues.map((issue) => {
    const mapped =
      (issue.state ? statusMap.get(issue.state.id) : null) ??
      defaultPlacementForLinearType(issue.state?.type ?? "unstarted", firstStageId);
    return {
      sourceKey: linearSourceKey(issue.id),
      title: issue.title,
      description: issue.description,
      priority: mapLinearPriority(issue.priority),
      status: mapped.status,
      workflowStage: mapped.workflowStage,
      tracker: {
        provider: "linear",
        issueId: issue.id,
        identifier: issue.identifier,
        url: issue.url,
        state: issue.state?.name ?? null,
      },
      sourceCreatedAt: issue.createdAt,
      parentIssueId: issue.parentId,
      relations: issue.relations,
    };
  });
  const result = await services.importLinearHuntRuns(
    input.db,
    project.id,
    settings?.github_repository ?? project.name,
    runs,
  );
  return {
    ...result,
    total: issues.length,
    truncated,
  };
}
