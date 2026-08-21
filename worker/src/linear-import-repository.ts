import {
  isRepositoryWorkflowPending,
  type AutoHuntPersistedRunStatus,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";

import {
  parseWorkflow,
  stableJson,
} from "./hunt-run-codec";
import { HuntTransitionError } from "./hunt-run-errors";
import { dashboardStageFor } from "./hunt-run-model";
import { getProjectSettings } from "./project-settings-repository";
import { digestRunId } from "./run-identity";

export type LinearImportRunInput = {
  sourceKey: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: AutoHuntPersistedRunStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  tracker: {
    provider: string;
    issueId: string;
    identifier: string | null;
    url: string | null;
    state: string | null;
  };
  sourceCreatedAt: string | null;
};

/**
 * One-time admin import of external tracker issues. Bypasses completion
 * eligibility so historical Linear issues can land directly as completed.
 */
export async function importLinearHuntRuns(
  db: D1Database,
  projectId: string,
  repository: string,
  inputs: LinearImportRunInput[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  const settings = await getProjectSettings(db, projectId);
  const workflowSnapshot = parseWorkflow(settings?.workflow_json);
  if (isRepositoryWorkflowPending(workflowSnapshot)) {
    throw new HuntTransitionError(
      "Repository workflow has not been generated for this project",
    );
  }
  const workflowStageIds = new Set(
    workflowSnapshot.stages.map((stage) => stage.id),
  );

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of inputs) {
    try {
      const title = raw.title.trim().slice(0, 300); // absolute DB ceiling
      if (!title) {
        failed += 1;
        continue;
      }
      const sourceKey = raw.sourceKey.trim().slice(0, 200);
      if (!sourceKey) {
        failed += 1;
        continue;
      }

      const existingBySource = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and source = 'issue' and source_key = ?
           limit 1`,
        )
        .bind(projectId, sourceKey)
        .first<{ id: string }>();
      if (existingBySource) {
        skipped += 1;
        continue;
      }

      const existingByTracker = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
           limit 1`,
        )
        .bind(projectId, raw.tracker.provider, raw.tracker.issueId)
        .first<{ id: string }>();
      if (existingByTracker) {
        skipped += 1;
        continue;
      }

      let status = raw.status;
      let workflowStage = status === "running" ? raw.workflowStage : null;
      if (
        status === "running" &&
        (!workflowStage || !workflowStageIds.has(workflowStage))
      ) {
        workflowStage = workflowSnapshot.stages[0]?.id ?? null;
        if (!workflowStage) {
          status = "queued";
          workflowStage = null;
        }
      }

      const stage = dashboardStageFor(status, workflowStage);
      const runId = await digestRunId(projectId, "issue", sourceKey);
      const eventId = crypto.randomUUID();
      const recordedAt = new Date().toISOString();
      const occurredAt = raw.sourceCreatedAt ?? recordedAt;
      const completedAt = ["completed", "cancelled"].includes(status)
        ? occurredAt
        : null;
      const detail =
        status === "queued"
          ? "Linear에서 가져온 이슈가 처리를 기다리고 있습니다."
          : `Linear에서 가져왔으며 ${status} 상태로 설정되었습니다.`;
      const resultSummary =
        status === "completed" ? "Imported from Linear as completed." : null;
      const priority =
        raw.priority != null && raw.priority >= 1 && raw.priority <= 4
          ? raw.priority
          : null;

      const results = await db.batch([
        db
          .prepare(
            `insert into briar_hunt_runs (
               id, project_id, source, source_key, title, stage, status,
               workflow_stage, workflow_snapshot_json, detail, priority,
               repository, branch, commit_sha, tracker_provider,
               tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
               tracker_issue_state, issue_description, result_summary,
               structured_result_json,
               pull_request_urls, target_sha, source_created_at,
               staging_qa_status, production_qa_status, staging_qa_detail,
               production_qa_detail, context_json, started_at, completed_at,
               last_event_at, created_at, updated_at
             ) values (?, ?, 'issue', ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?, ?, ?, ?, ?, null, '[]', null, ?, null, null, null, null, ?, ?, ?, ?, ?, ?)
             on conflict(project_id, source, source_key) do nothing`,
          )
          .bind(
            runId,
            projectId,
            sourceKey,
            title,
            stage,
            status,
            workflowStage,
            stableJson(workflowSnapshot),
            detail,
            priority,
            repository,
            raw.tracker.provider,
            raw.tracker.issueId,
            raw.tracker.identifier,
            raw.tracker.url,
            raw.tracker.state,
            raw.description?.slice(0, 100_000) ?? null,
            resultSummary,
            raw.sourceCreatedAt,
            stableJson({
              origin: "linear-import",
              linearIssueId: raw.tracker.issueId,
            }),
            occurredAt,
            completedAt,
            occurredAt,
            recordedAt,
            recordedAt,
          ),
        db
          .prepare(
            `insert into briar_hunt_events (
               id, run_id, event_key, attempt, stage, status, workflow_stage,
               detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
               pull_request_urls, target_sha, occurred_at, recorded_at
             ) values (?, ?, ?, 1, ?, ?, ?, ?, 'briar-linear-import', null, null, null, ?, '[]', null, ?, ?)
             on conflict(run_id, event_key) do nothing`,
          )
          .bind(
            eventId,
            runId,
            `${sourceKey}:import`,
            stage,
            status,
            workflowStage,
            detail,
            raw.tracker.state,
            occurredAt,
            recordedAt,
          ),
      ]);

      if ((results[0]?.meta.changes ?? 0) === 0) {
        skipped += 1;
      } else {
        imported += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { imported, skipped, failed };
}
