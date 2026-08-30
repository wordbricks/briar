import { collectStorageMetrics } from "./archive";
import type { BriarAuth } from "./auth";
import {
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
} from "./github-connection-repository";
import { HttpError, json, privateNoStoreJson } from "./http-response";
import { decodeMergeQueueProfileUpdate } from "./merge-queue-contract";
import {
  configureMergeQueueProfile,
  getMergeQueueProfile,
  type MergeQueueProfileRow,
} from "./merge-queue-profile";
import { getMergeQueueStatus } from "./merge-queue-status";
import { hasOrganizationCapability } from "./organization-access";
import { getProject } from "./project-command-repository";
import { validationCommandsFromStage } from "./project-configuration-application";
import { getProjectSettings } from "./project-settings-repository";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";

const DEFAULT_MERGE_QUEUE_QUIET_WINDOW_MS = 300_000;
const DEFAULT_MERGE_QUEUE_MAX_BATCH_SIZE = 5;

const mergeQueueProfileJson = (row: MergeQueueProfileRow | null) => row
  ? {
      projectId: row.project_id,
      repositoryId: row.repository_id,
      repository: row.repository,
      baseBranch: row.base_branch,
      enabled: row.enabled === 1,
      readinessStageId: row.readiness_stage_id,
      validationCommands: JSON.parse(row.validation_commands_json) as string[],
      quietWindowMs: row.quiet_window_ms,
      maxBatchSize: row.max_batch_size,
      updatedAt: row.updated_at,
    }
  : null;

export type ProjectSettingsRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
};

export async function handleProjectSettingsRoute(
  routeInput: ProjectSettingsRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db } = routeInput;
  const { pathname } = url;

  const mergeQueueProfileMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/merge-queue-profile$/u,
  );
  const mergeQueueStatusMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/merge-queue-status$/u,
  );
  if (mergeQueueStatusMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      mergeQueueStatusMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    return privateNoStoreJson({
      status: await getMergeQueueStatus(db, project.id),
      generatedAt: new Date().toISOString(),
    });
  }
  if (
    mergeQueueProfileMatch &&
    (request.method === "GET" || request.method === "PUT")
  ) {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      mergeQueueProfileMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const current = await getMergeQueueProfile(db, project.id);
    if (request.method === "GET") {
      return json({ profile: mergeQueueProfileJson(current) });
    }
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeMergeQueueProfileUpdate(await readJson(request));
    const settings = await getProjectSettings(db, project.id);
    const readinessStageId = input.readinessStageId ??
      current?.readiness_stage_id;
    if (!readinessStageId) {
      throw new HttpError(
        400,
        "Choose a workflow stage before enabling the merge queue",
        "MERGE_QUEUE_READINESS_STAGE_REQUIRED",
      );
    }
    const workflow = settings?.workflow_json
      ? JSON.parse(settings.workflow_json) as {
          stages?: Array<{ id?: unknown; checks?: unknown }>;
        }
      : null;
    const readinessStage = workflow?.stages?.find((stage) =>
      stage.id === readinessStageId
    );
    if (input.enabled && !readinessStage) {
      throw new HttpError(
        409,
        "The merge queue readiness stage is not in the project workflow",
        "MERGE_QUEUE_WORKFLOW_BOUNDARY_CONFLICT",
      );
    }
    const validationCommands = readinessStage
      ? validationCommandsFromStage(readinessStage)
      : current
        ? JSON.parse(current.validation_commands_json) as string[]
        : [];
    if (input.enabled && validationCommands.length === 0) {
      throw new HttpError(
        409,
        "The merge queue boundary stage needs at least one validation command",
        "MERGE_QUEUE_VALIDATION_COMMANDS_REQUIRED",
      );
    }
    const repository = !input.enabled && current
      ? {
          repository_id: current.repository_id,
          full_name: current.repository,
        }
      : await (async () => {
          const repositoryName = settings?.github_repository?.trim()
            .toLowerCase();
          if (!repositoryName) {
            throw new HttpError(
              409,
              "Connect one GitHub repository before configuring its merge queue",
            );
          }
          const connection = await getGithubConnectionForOrganization(
            db,
            project.organization_id,
          );
          if (!connection) {
            throw new HttpError(409, "GitHub integration is not connected");
          }
          const connectedRepository = (await listGithubConnectionRepositories(
            db,
            connection.installation_id,
          )).find((candidate) =>
            candidate.full_name.toLowerCase() === repositoryName
          );
          if (!connectedRepository) {
            throw new HttpError(
              409,
              "The configured repository is not included in the GitHub installation",
            );
          }
          return connectedRepository;
        })();
    const configured = await configureMergeQueueProfile(db, {
      projectId: project.id,
      repositoryId: repository.repository_id,
      repository: repository.full_name,
      enabled: input.enabled,
      readinessStageId,
      validationCommands,
      quietWindowMs: input.quietWindowMs ?? current?.quiet_window_ms ??
        DEFAULT_MERGE_QUEUE_QUIET_WINDOW_MS,
      maxBatchSize: input.maxBatchSize ?? current?.max_batch_size ??
        DEFAULT_MERGE_QUEUE_MAX_BATCH_SIZE,
      observedAt: new Date().toISOString(),
    });
    if (configured.outcome === "active_batch") {
      throw new HttpError(
        409,
        "Drain the active merge batch before changing or disabling its lane",
      );
    }
    if (configured.outcome === "lane_owned") {
      throw new HttpError(
        409,
        "Another Briar project already owns this repository/main lane",
      );
    }
    return json({ profile: mergeQueueProfileJson(configured.profile) });
  }

  const storageMetricsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/storage-metrics$/u,
  );
  if (storageMetricsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      storageMetricsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    return json({ metrics: await collectStorageMetrics(db, project.id) });
  }

}
