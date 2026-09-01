import {
  canonicalizeProjectWorkflow,
  encodeAutoHuntWorkflowCheckpointsJson,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
} from "../../src/lib/auto-hunt-contract";

import { stableJson } from "./hunt-run-codec";

export type ProjectSettingsRow = {
  project_id: string;
  velen_org: string | null;
  data_source: string | null;
  linear_enabled: number;
  linear_source: string | null;
  linear_team_key: string | null;
  github_repository_id: number | null;
  github_repository: string | null;
  workflow_json: string;
  mandatory_checkpoints_json: string;
  checkpoint_policy_revision: number;
  created_at: string;
  updated_at: string;
};

export type ProjectSettingsInput = {
  velenOrg: string | null;
  dataSource: string | null;
  linear: {
    enabled: boolean;
    source: string | null;
    teamKey: string | null;
  };
  githubRepositoryId?: number | null;
  githubRepository: string | null;
  workflow: AutoHuntWorkflow;
};

export async function getProjectSettings(db: D1Database, projectId: string) {
  return await db
    .prepare(
      `select project_id, velen_org, data_source, linear_enabled,
              linear_source, linear_team_key, github_repository_id,
              github_repository, workflow_json,
              mandatory_checkpoints_json, checkpoint_policy_revision,
              created_at, updated_at
       from briar_project_settings
       where project_id = ?`,
    )
    .bind(projectId)
    .first<ProjectSettingsRow>();
}

export async function updateProjectMandatoryCheckpoints(
  db: D1Database,
  projectId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
  expectedRevision: number,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_project_settings
       set mandatory_checkpoints_json = ?,
           checkpoint_policy_revision = checkpoint_policy_revision + 1,
           updated_at = ?
       where project_id = ? and checkpoint_policy_revision = ?`,
    )
    .bind(
      encodeAutoHuntWorkflowCheckpointsJson(checkpoints),
      updatedAt,
      projectId,
      expectedRevision,
    )
    .run();
  // Dashboard sync triggers may add their own row changes to D1 metadata.
  // The guarded settings row changed iff the total is non-zero.
  return (result.meta.changes ?? 0) > 0;
}

export async function updateUserWorkflowCheckpointDefaults(
  db: D1Database,
  projectId: string,
  userId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
  expectedRevision: number,
) {
  const updatedAt = new Date().toISOString();
  const result = expectedRevision === 0
    ? await db
        .prepare(
          `insert into briar_user_workflow_checkpoint_defaults (
             project_id, user_id, checkpoints_json, revision, created_at, updated_at
           ) values (?, ?, ?, 1, ?, ?)
           on conflict(project_id, user_id) do nothing`,
        )
        .bind(
          projectId,
          userId,
          encodeAutoHuntWorkflowCheckpointsJson(checkpoints),
          updatedAt,
          updatedAt,
        )
        .run()
    : await db
        .prepare(
          `update briar_user_workflow_checkpoint_defaults
           set checkpoints_json = ?, revision = revision + 1, updated_at = ?
           where project_id = ? and user_id = ? and revision = ?`,
        )
        .bind(
          encodeAutoHuntWorkflowCheckpointsJson(checkpoints),
          updatedAt,
          projectId,
          userId,
          expectedRevision,
        )
        .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updateProjectSettings(
  db: D1Database,
  projectId: string,
  input: ProjectSettingsInput,
) {
  const updatedAt = new Date().toISOString();
  const workflow = canonicalizeProjectWorkflow(input.workflow);
  await db
    .prepare(
      `insert into briar_project_settings (
         project_id, velen_org, data_source, linear_enabled, linear_source,
         linear_team_key, github_repository_id, github_repository, workflow_json,
         mandatory_checkpoints_json, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(project_id) do update set
         velen_org = excluded.velen_org,
         data_source = excluded.data_source,
         linear_enabled = excluded.linear_enabled,
         linear_source = excluded.linear_source,
         linear_team_key = excluded.linear_team_key,
         github_repository_id = excluded.github_repository_id,
         github_repository = excluded.github_repository,
         workflow_json = excluded.workflow_json,
         mandatory_checkpoints_json = case
           when exists (
             select 1 from json_each(
               briar_project_settings.workflow_json,
               '$.stages'
             ) stage
             where json_extract(stage.value, '$.id') = 'repository_workflow_pending'
           ) then excluded.mandatory_checkpoints_json
           else briar_project_settings.mandatory_checkpoints_json
         end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      projectId,
      input.velenOrg,
      input.dataSource,
      input.linear.enabled ? 1 : 0,
      input.linear.enabled ? input.linear.source : null,
      input.linear.enabled ? input.linear.teamKey : null,
      input.githubRepositoryId ?? null,
      input.githubRepository,
      stableJson(workflow),
      encodeAutoHuntWorkflowCheckpointsJson(workflow.execution.checkpoints),
      updatedAt,
      updatedAt,
    )
    .run();
  return await getProjectSettings(db, projectId);
}
