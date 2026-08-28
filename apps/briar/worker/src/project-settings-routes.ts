import { canonicalizeCheckpointSet } from "../../src/lib/auto-hunt-contract";
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
import { canManageOrganization } from "./organization-access";
import { getProject } from "./project-command-repository";
import {
  getProjectSettings,
  updateProjectMandatoryCheckpoints,
  updateProjectSettings,
  updateUserWorkflowCheckpointDefaults,
} from "./project-settings-repository";
import { settingsJson } from "./project-settings-json";
import { readJson } from "./request-readers";
import {
  decodeCheckpointPolicyInput,
  parseProjectSettingsInput,
} from "./run-request-contract";
import { requireSession } from "./session-auth";
import {
  assertStoredCheckpointPoliciesCompatible,
  checkpointPolicyJson,
  isStoredWorkflowUnchanged,
  loadWorkflowCheckpointPolicy,
} from "./workflow-policy";
import { decodeExecutionWorkerPolicy } from "./worker-request-contract";
import {
  getProjectExecutionWorkerPolicy,
  updateProjectExecutionWorkerPolicy,
} from "./workers";

const DEFAULT_MERGE_QUEUE_QUIET_WINDOW_MS = 300_000;
const DEFAULT_MERGE_QUEUE_MAX_BATCH_SIZE = 5;

const validationCommandsFromStage = (
  stage: { checks?: unknown } | undefined,
) => stage && Array.isArray(stage.checks)
  ? stage.checks.filter((check): check is string =>
      typeof check === "string" && check.trim().length > 0
    ).map((check) => check.trim())
  : [];

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

  const settingsMatch = pathname.match(/^\/projects\/([0-9a-f-]+)\/settings$/u);
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
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
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

  const checkpointPolicyMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/checkpoint-policy$/u,
  );
  if (checkpointPolicyMatch && ["GET", "PUT"].includes(request.method)) {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      checkpointPolicyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (request.method === "GET") {
      return json({
        checkpointPolicy: checkpointPolicyJson(
          await loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
        ),
      });
    }
    const input = decodeCheckpointPolicyInput(await readJson(request));
    if (input.scope === "project" && !canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const current = await loadWorkflowCheckpointPolicy(
      db,
      project.id,
      session.user.id,
    );
    const checkpoints = canonicalizeCheckpointSet(
      current.workflow,
      input.checkpoints,
      input.scope,
    );
    const updated = input.scope === "project"
      ? await updateProjectMandatoryCheckpoints(
          db,
          project.id,
          checkpoints,
          input.expectedRevision,
        )
      : await updateUserWorkflowCheckpointDefaults(
          db,
          project.id,
          session.user.id,
          checkpoints,
          input.expectedRevision,
        );
    if (!updated) {
      throw new HttpError(
        409,
        "Checkpoint policy changed; reload before saving",
        "CHECKPOINT_POLICY_CONFLICT",
      );
    }
    return json({
      checkpointPolicy: checkpointPolicyJson(
        await loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
      ),
    });
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
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    return json({ metrics: await collectStorageMetrics(db, project.id) });
  }

  if (settingsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const [settings, policy] = await Promise.all([
      getProjectSettings(db, project.id),
      loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
    ]);
    return json({
      settings: settingsJson(settings, checkpointPolicyJson(policy)),
    });
  }
  if (settingsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = parseProjectSettingsInput(await readJson(request));
    const currentSettings = await getProjectSettings(db, project.id);
    const mergeQueueProfile = await getMergeQueueProfile(db, project.id);
    if (
      mergeQueueProfile?.enabled === 1 &&
      !input.workflow.stages.some((stage) =>
        stage.id === mergeQueueProfile.readiness_stage_id
      )
    ) {
      throw new HttpError(
        409,
        "Disable the merge queue before removing its workflow boundary stage",
        "MERGE_QUEUE_WORKFLOW_BOUNDARY_CONFLICT",
      );
    }
    if (mergeQueueProfile?.enabled === 1) {
      const boundary = input.workflow.stages.find((stage) =>
        stage.id === mergeQueueProfile.readiness_stage_id
      );
      const storedCommands = JSON.parse(
        mergeQueueProfile.validation_commands_json,
      ) as string[];
      if (
        JSON.stringify(validationCommandsFromStage(boundary)) !==
          JSON.stringify(storedCommands)
      ) {
        throw new HttpError(
          409,
          "Disable the merge queue before changing its workflow validation commands",
          "MERGE_QUEUE_WORKFLOW_VALIDATION_CONFLICT",
        );
      }
    }
    if (
      !isStoredWorkflowUnchanged(
        currentSettings?.workflow_json,
        input.workflow,
      )
    ) {
      await assertStoredCheckpointPoliciesCompatible(
        db,
        project.id,
        input.workflow,
      );
    }
    const settings = await updateProjectSettings(db, project.id, {
      velenOrg: input.velenOrg ?? null,
      dataSource: input.dataSource ?? null,
      linear: input.linear,
      githubRepository: input.githubRepository ?? null,
      workflow: input.workflow,
    });
    const policy = await loadWorkflowCheckpointPolicy(
      db,
      project.id,
      session.user.id,
    );
    return json({ settings: settingsJson(settings, checkpointPolicyJson(policy)) });
  }

  const executionPolicyMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/execution-policy$/u,
  );
  if (executionPolicyMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      executionPolicyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    return json({
      policy: await getProjectExecutionWorkerPolicy(db, project.id),
    });
  }
  if (executionPolicyMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      executionPolicyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeExecutionWorkerPolicy(await readJson(request));
    const policy = await updateProjectExecutionWorkerPolicy(db, project.id, {
      ...input,
      updatedByUserId: session.user.id,
      observedAt: new Date().toISOString(),
    });
    return json({ policy });
  }
}
