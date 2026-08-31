import {
  isRepositoryWorkflowPending,
  type AutoHuntPersistedRunStatus,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";

import { createIssueDependency } from "./issue-dependency-repository";
import {
  createIssueRelation,
  setIssueParent,
} from "./issue-relation-repository";
import { parseWorkflow, stableJson } from "./hunt-run-codec";
import { HuntTransitionError } from "./hunt-run-errors";
import { dashboardStageFor } from "./hunt-run-model";
import { getProjectSettings } from "./project-settings-repository";
import { digestRunId } from "./run-identity";

export type LinearImportRelationInput = {
  sourceIssueId: string;
  targetIssueId: string;
  type: string;
};

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
  parentIssueId: string | null;
  relations: LinearImportRelationInput[];
};

type ImportCounter = {
  linked: number;
  skipped: number;
  outsideScope: number;
  cycles: number;
};

export type LinearImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  relations: {
    hierarchy: ImportCounter;
    related: Omit<ImportCounter, "cycles">;
    dependencies: ImportCounter;
    unsupported: { duplicate: number; similar: number };
  };
};

const emptyCounter = (): ImportCounter => ({
  linked: 0,
  skipped: 0,
  outsideScope: 0,
  cycles: 0,
});

/**
 * One-time admin import of external tracker issues. All issues are matched or
 * created first, then relationship edges are connected by immutable Linear ID.
 */
export async function importLinearHuntRuns(
  db: D1Database,
  projectId: string,
  repository: string,
  inputs: LinearImportRunInput[],
): Promise<LinearImportResult> {
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
  const runIdByLinearIssueId = new Map<string, string>();

  for (const raw of inputs) {
    try {
      const title = raw.title.trim().slice(0, 300);
      const sourceKey = raw.sourceKey.trim().slice(0, 200);
      if (!title || !sourceKey) {
        failed += 1;
        continue;
      }

      const existingBySource = await db.prepare(
        `select id from briar_hunt_runs
         where project_id = ? and source = 'issue' and source_key = ?
         limit 1`,
      ).bind(projectId, sourceKey).first<{ id: string }>();
      if (existingBySource) {
        runIdByLinearIssueId.set(raw.tracker.issueId, existingBySource.id);
        skipped += 1;
        continue;
      }

      const existingByTracker = await db.prepare(
        `select id from briar_hunt_runs
         where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
         limit 1`,
      ).bind(
        projectId,
        raw.tracker.provider,
        raw.tracker.issueId,
      ).first<{ id: string }>();
      if (existingByTracker) {
        runIdByLinearIssueId.set(raw.tracker.issueId, existingByTracker.id);
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
      const detail = status === "queued"
        ? "Linear에서 가져온 이슈가 처리를 기다리고 있습니다."
        : `Linear에서 가져왔으며 ${status} 상태로 설정되었습니다.`;
      const resultSummary = status === "completed"
        ? "Imported from Linear as completed."
        : null;
      const priority = raw.priority != null && raw.priority >= 1 && raw.priority <= 4
        ? raw.priority
        : null;

      const results = await db.batch([
        db.prepare(
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
        ).bind(
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
        db.prepare(
          `insert into briar_hunt_events (
             id, run_id, event_key, attempt, stage, status, workflow_stage,
             detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
             pull_request_urls, target_sha, occurred_at, recorded_at
           ) values (?, ?, ?, 1, ?, ?, ?, ?, 'briar-linear-import', null, null, null, ?, '[]', null, ?, ?)
           on conflict(run_id, event_key) do nothing`,
        ).bind(
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

      runIdByLinearIssueId.set(raw.tracker.issueId, runId);
      if ((results[0]?.meta.changes ?? 0) === 0) skipped += 1;
      else imported += 1;
    } catch {
      failed += 1;
    }
  }

  const hierarchy = emptyCounter();
  const relatedCounter = { linked: 0, skipped: 0, outsideScope: 0 };
  const dependencies = emptyCounter();
  const unsupported = { duplicate: 0, similar: 0 };
  const observedAt = new Date().toISOString();
  const hierarchyEdges = new Map<string, { child: string; parent: string }>();
  const relationEdges = new Map<string, LinearImportRelationInput>();
  const referencedLinearIssueIds = new Set<string>();

  for (const input of inputs) {
    referencedLinearIssueIds.add(input.tracker.issueId);
    if (input.parentIssueId) {
      referencedLinearIssueIds.add(input.parentIssueId);
      hierarchyEdges.set(input.tracker.issueId, {
        child: input.tracker.issueId,
        parent: input.parentIssueId,
      });
    }
    for (const relation of input.relations) {
      referencedLinearIssueIds.add(relation.sourceIssueId);
      referencedLinearIssueIds.add(relation.targetIssueId);
      const type = relation.type.toLowerCase();
      if (type === "related" || type === "duplicate" || type === "similar") {
        const [first, second] = relation.sourceIssueId < relation.targetIssueId
          ? [relation.sourceIssueId, relation.targetIssueId]
          : [relation.targetIssueId, relation.sourceIssueId];
        relationEdges.set(`${type}:${first}:${second}`, {
          ...relation,
          sourceIssueId: first,
          targetIssueId: second,
          type,
        });
      } else if (type === "blocks") {
        relationEdges.set(
          `blocks:${relation.sourceIssueId}:${relation.targetIssueId}`,
          { ...relation, type },
        );
      }
    }
  }

  if (referencedLinearIssueIds.size > 0) {
    const referencedRuns = await db.prepare(
      `select id, tracker_issue_id from briar_hunt_runs
       where project_id = ? and tracker_provider = 'linear'
         and tracker_issue_id in (select value from json_each(?))`,
    ).bind(
      projectId,
      JSON.stringify([...referencedLinearIssueIds]),
    ).all<{ id: string; tracker_issue_id: string }>();
    for (const run of referencedRuns.results) {
      if (!runIdByLinearIssueId.has(run.tracker_issue_id)) {
        runIdByLinearIssueId.set(run.tracker_issue_id, run.id);
      }
    }
  }

  for (const edge of hierarchyEdges.values()) {
    const childRunId = runIdByLinearIssueId.get(edge.child);
    const parentRunId = runIdByLinearIssueId.get(edge.parent);
    if (!childRunId || !parentRunId) {
      hierarchy.outsideScope += 1;
      continue;
    }
    const outcome = await setIssueParent(db, projectId, {
      childRunId,
      parentRunId,
      createdByUserId: null,
      createdAt: observedAt,
    });
    if (outcome === "created" || outcome === "updated") hierarchy.linked += 1;
    else if (outcome === "cycle") hierarchy.cycles += 1;
    else if (outcome === "not_found") hierarchy.outsideScope += 1;
    else hierarchy.skipped += 1;
  }

  for (const relation of relationEdges.values()) {
    if (relation.type === "duplicate" || relation.type === "similar") {
      unsupported[relation.type] += 1;
      continue;
    }
    const sourceRunId = runIdByLinearIssueId.get(relation.sourceIssueId);
    const targetRunId = runIdByLinearIssueId.get(relation.targetIssueId);
    const counter = relation.type === "related" ? relatedCounter : dependencies;
    if (!sourceRunId || !targetRunId) {
      counter.outsideScope += 1;
      continue;
    }
    if (relation.type === "related") {
      const outcome = await createIssueRelation(db, projectId, {
        runId: sourceRunId,
        relatedRunId: targetRunId,
        createdByUserId: null,
        createdAt: observedAt,
      });
      if (outcome === "created") relatedCounter.linked += 1;
      else if (outcome === "not_found") relatedCounter.outsideScope += 1;
      else relatedCounter.skipped += 1;
      continue;
    }
    const outcome = await createIssueDependency(
      db,
      projectId,
      {
        prerequisiteRunId: sourceRunId,
        dependentRunId: targetRunId,
        createdByUserId: null,
        createdAt: observedAt,
      },
      { allowStartedDependent: true },
    );
    if (outcome === "created") dependencies.linked += 1;
    else if (outcome === "cycle") dependencies.cycles += 1;
    else if (outcome === "not_found") dependencies.outsideScope += 1;
    else dependencies.skipped += 1;
  }

  return {
    imported,
    skipped,
    failed,
    relations: {
      hierarchy,
      related: relatedCounter,
      dependencies,
      unsupported,
    },
  };
}
