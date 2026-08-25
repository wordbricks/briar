import {
  additionalWorkflowCheckpoints,
  normalizeAutoHuntWorkflow,
  workflowWithAdditionalCheckpoints,
  type AutoHuntWorkflowCheckpoint,
} from "../../src/lib/auto-hunt-contract";

import { archiveCleanupQueueUpsertSql } from "./archive-cleanup-repository";
import {
  runIsFullAuto,
  stableJson,
} from "./hunt-run-codec";
import { type HuntRunRow } from "./hunt-run-model";
import { getHuntRunForProject } from "./hunt-run-repository";
import {
  type ModelEffort,
  type ProjectAgentProvider,
} from "./project-agent-model";
import type { IssueDifficulty } from "../../src/lib/issue-difficulty";

export async function rollbackNewAppIssue(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_hunt_runs
       where id = ? and project_id = ? and source = 'issue'
         and status = 'queued' and claim_attempts = 0
         and event_count = 1`,
    )
    .bind(runId, projectId)
    .run();
  return result.meta.changes > 0;
}

export async function updateIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    title: string;
    description: string | null;
    priority: number | null;
    difficulty?: IssueDifficulty;
    assigneeUserId?: string | null;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_hunt_runs
       set title = ?, issue_description = ?, priority = ?,
           difficulty = coalesce(?, difficulty),
           assignee_user_id = case when ? = 1 then ? else assignee_user_id end,
           updated_at = ?
       where id = ? and project_id = ?
       returning *`,
    )
    .bind(
      input.title,
      input.description,
      input.priority,
      input.difficulty ?? null,
      input.assigneeUserId === undefined ? 0 : 1,
      input.assigneeUserId ?? null,
      input.updatedAt,
      runId,
      projectId,
    )
    .first<HuntRunRow>();
}

export async function updateIssueExecutionPreferences(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    provider: ProjectAgentProvider | null;
    model: string | null;
    effort: ModelEffort | null;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_hunt_runs
       set preferred_agent_provider = ?,
           preferred_agent_model = ?,
           preferred_agent_effort = ?,
           updated_at = ?
       where id = ? and project_id = ?
       returning *`,
    )
    .bind(
      input.provider,
      input.model,
      input.effort,
      input.updatedAt,
      runId,
      projectId,
    )
    .first<HuntRunRow>();
}

export async function updateIssueCheckpoints(
  db: D1Database,
  projectId: string,
  runId: string,
  checkpoints: AutoHuntWorkflowCheckpoint[],
  updatedAt: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return "not_found" as const;
  if (runIsFullAuto(run)) return "ineligible" as const;
  if (
    !["backlog", "queued"].includes(run.status) ||
    run.claim_token_hash ||
    run.claimed_at
  ) {
    return "ineligible" as const;
  }

  const currentWorkflow = normalizeAutoHuntWorkflow(
    JSON.parse(run.workflow_snapshot_json),
  );
  const previousIssueCheckpoints = JSON.parse(
    run.issue_checkpoints_json || "[]",
  ) as AutoHuntWorkflowCheckpoint[];
  const previousBoundaries = new Set(
    previousIssueCheckpoints.map(
      (checkpoint) => `${checkpoint.stage}:${checkpoint.position}`,
    ),
  );
  const baseWorkflow = normalizeAutoHuntWorkflow({
    ...currentWorkflow,
    execution: {
      checkpoints: currentWorkflow.execution.checkpoints.filter(
        (checkpoint) =>
          !previousBoundaries.has(`${checkpoint.stage}:${checkpoint.position}`),
      ),
    },
  });
  const normalizedCheckpoints = additionalWorkflowCheckpoints(
    baseWorkflow,
    checkpoints,
  );
  const nextWorkflow = workflowWithAdditionalCheckpoints(
    baseWorkflow,
    normalizedCheckpoints,
  );
  const result = await db
    .prepare(
      `update briar_hunt_runs
       set workflow_snapshot_json = ?, issue_checkpoints_json = ?, updated_at = ?
       where id = ? and project_id = ?
         and workflow_snapshot_json = ?
         and status in ('backlog', 'queued')
         and claim_token_hash is null
         and claimed_at is null`,
    )
    .bind(
      stableJson(nextWorkflow),
      stableJson(normalizedCheckpoints),
      updatedAt,
      runId,
      projectId,
      run.workflow_snapshot_json,
    )
    .run();
  return (result.meta.changes ?? 0) > 0
    ? ("updated" as const)
    : ("ineligible" as const);
}

export async function deleteIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  observedAt: string,
): Promise<"deleted" | "active" | "not_found"> {
  const deletableRun = `run.id = ? and run.project_id = ?
    and run.status <> 'running'
    and not (
      run.status = 'queued'
      and run.lease_expires_at is not null
      and run.lease_expires_at > ?
    )`;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'archives', archive.object_key, ?, ?, ?
         from briar_log_archives archive
         join briar_hunt_runs run on run.id = archive.run_id
         where ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', related.value, ?, ?, ?
         from briar_log_archives archive
         join briar_hunt_runs run on run.id = archive.run_id,
              json_each(archive.related_object_keys_json) related
         where related.type = 'text' and ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', attachment.object_key, ?, ?, ?
         from briar_issue_attachments attachment
         join briar_hunt_runs run on run.id = attachment.run_id
         where ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `insert into briar_archive_cleanup_queue (
           bucket, object_key, project_id, run_id, queued_at
         )
         select 'attachments', image.object_key, ?, ?, ?
         from briar_run_evidence_images image
         join briar_hunt_runs run on run.id = image.run_id
         where ${deletableRun}
         ${archiveCleanupQueueUpsertSql}`,
      )
      .bind(projectId, runId, observedAt, runId, projectId, observedAt),
    db
      .prepare(
        `delete from briar_hunt_runs
         where id = ? and project_id = ?
           and status <> 'running'
           and not (
             status = 'queued'
             and lease_expires_at is not null
             and lease_expires_at > ?
           )
         returning id`,
      )
      .bind(runId, projectId, observedAt),
    db
      .prepare(
        `select id from briar_hunt_runs
         where id = ? and project_id = ?`,
      )
      .bind(runId, projectId),
  ]);
  if ((results[4]?.results?.length ?? 0) > 0) return "deleted";
  return (results[5]?.results?.length ?? 0) > 0 ? "active" : "not_found";
}
