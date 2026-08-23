import { type RunPullRequestRow } from "./github-pull-request-model";
import { getHuntRunForProject } from "./hunt-run-repository";
import { resumeWorkflowCheckpoint } from "./workflow-checkpoint-repository";
import { type WorkflowCheckpointProgressRow } from "./workflow-progress-repository";

async function hasUnboundGithubPullRequestEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
  attempt: number,
  revision: number,
) {
  const row = await db
    .prepare(
      `select 1 as unbound
       from briar_run_evidence evidence
       where evidence.project_id = ? and evidence.run_id = ?
         and evidence.attempt = ? and evidence.revision = ?
         and evidence.evidence_type = 'pull_request'
         and evidence.status in ('pending', 'passed')
         and not exists (
           select 1 from briar_run_pull_requests link
           where link.run_id = evidence.run_id
             and link.attempt = evidence.attempt
             and link.revision = evidence.revision
             and link.repository_id = cast(json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.repositoryId'
             ) as integer)
             and link.pull_request_id = cast(json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.pullRequestId'
             ) as integer)
             and link.pull_request_node_id = json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.pullRequestNodeId'
             )
             and link.pull_request_number = cast(json_extract(
               evidence.metadata_json,
               '$.githubPullRequest.pullRequestNumber'
             ) as integer)
         )
       limit 1`,
    )
    .bind(projectId, runId, attempt, revision)
    .first<{ unbound: number }>();
  return Boolean(row);
}

async function hasBlockedGithubConnectionForRun(
  db: D1Database,
  projectId: string,
  runId: string,
  attempt: number,
  revision: number,
) {
  const row = await db
    .prepare(
      `select 1 as blocked
       from briar_run_pull_requests link
       join briar_projects project on project.id = link.project_id
       where link.project_id = ? and link.run_id = ?
         and link.attempt = ? and link.revision = ?
         and link.installation_id is not null
         and exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = link.installation_id
         )
         and not exists (
           select 1 from briar_github_connections connection
           where connection.installation_id = link.installation_id
             and connection.status = 'connected'
             and connection.organization_id = project.organization_id
         )
       limit 1`,
    )
    .bind(projectId, runId, attempt, revision)
    .first<{ blocked: number }>();
  return Boolean(row);
}

async function hasIncompleteMergeBatchForRun(
  db: D1Database,
  projectId: string,
  runId: string,
  attempt: number,
  revision: number,
) {
  const row = await db.prepare(
    `select 1 as pending
     from briar_run_pull_requests link
     join briar_merge_batch_candidates candidate
       on candidate.repository_id = link.repository_id
      and candidate.base_branch = coalesce(link.base_branch, 'main')
      and candidate.pull_request_number = link.pull_request_number
      and candidate.frozen_head_sha = link.head_sha
     join briar_merge_batches batch on batch.id = candidate.batch_id
     where link.project_id = ? and link.run_id = ?
       and link.attempt = ? and link.revision = ?
       and batch.state in (
         'frozen', 'enqueueing', 'waiting_tail', 'validating',
         'publishing', 'awaiting_merge', 'blocked', 'draining'
       )
     limit 1`,
  ).bind(
    projectId,
    runId,
    attempt,
    revision,
  ).first<{ pending: number }>();
  return Boolean(row);
}

export async function resumeRunAfterGithubMerge(
  db: D1Database,
  projectId: string,
  runId: string,
  actor = "github-webhook",
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return { outcome: "not_found" as const };
  if (run.resume_requested_at) {
    return { outcome: "already_resumed" as const };
  }
  if (
    await hasIncompleteMergeBatchForRun(
      db,
      projectId,
      run.id,
      run.current_attempt,
      run.current_revision,
    )
  ) {
    return { outcome: "not_ready" as const };
  }
  if (
    await hasBlockedGithubConnectionForRun(
      db,
      projectId,
      run.id,
      run.current_attempt,
      run.current_revision,
    )
  ) {
    return { outcome: "ineligible" as const };
  }
  if (
    await hasUnboundGithubPullRequestEvidence(
      db,
      projectId,
      run.id,
      run.current_attempt,
      run.current_revision,
    )
  ) {
    return { outcome: "not_ready" as const };
  }
  const result = await db
    .prepare(
      `select * from briar_run_pull_requests
       where project_id = ? and run_id = ? and attempt = ? and revision = ?
       order by coalesce(merged_at, provider_updated_at, updated_at) desc, url`,
    )
    .bind(
      projectId,
      run.id,
      run.current_attempt,
      run.current_revision,
    )
    .all<RunPullRequestRow>();
  const links = result.results;
  if (
    links.length === 0 ||
    links.some((link) => link.state !== "merged" || !link.last_delivery_id)
  ) {
    return { outcome: "not_ready" as const };
  }
  const latest = links[0]!;
  const approvedAt = latest.merged_at ?? latest.provider_updated_at ?? latest.updated_at;
  const requestId = `github:${latest.last_delivery_id}`;
  if (!run.waiting_checkpoint_key) {
    return { outcome: "ineligible" as const };
  }
  const checkpoint = await db
    .prepare(
      `select checkpoint_key, attempt, revision
       from briar_run_checkpoint_progress
       where run_id = ? and attempt = ? and revision = ?
         and checkpoint_key = ? and stage_id = 'pr_open'
         and position = 'after' and state = 'waiting'`,
    )
    .bind(
      run.id,
      run.current_attempt,
      run.current_revision,
      run.waiting_checkpoint_key,
    )
    .first<Pick<
      WorkflowCheckpointProgressRow,
      "checkpoint_key" | "attempt" | "revision"
    >>();
  if (!checkpoint) return { outcome: "ineligible" as const };
  const resumed = await resumeWorkflowCheckpoint(db, projectId, {
    runId: run.id,
    checkpointKey: checkpoint.checkpoint_key,
    attempt: checkpoint.attempt,
    revision: checkpoint.revision,
    requestId,
    actor,
    approvedAt,
    requireAllGithubPullRequestsMerged: true,
  });
  return {
    outcome:
      resumed.outcome === "approved"
        ? ("resumed" as const)
        : resumed.outcome === "already_approved"
          ? ("already_resumed" as const)
          : resumed.outcome,
  };
}

export async function attemptGithubMergeAutoResume(
  db: D1Database,
  projectId: string,
  runId: string,
  actor = "github-webhook",
) {
  try {
    return await resumeRunAfterGithubMerge(db, projectId, runId, actor);
  } catch (error) {
    console.error(JSON.stringify({
      message: "GitHub merge auto-resume deferred",
      projectId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return { outcome: "deferred" as const };
  }
}

export async function reconcileGithubMergedRuns(
  db: D1Database,
  limit = 100,
) {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const candidates = await db
    .prepare(
      `select run.project_id, run.id as run_id
       from briar_hunt_runs run
       where run.status = 'running'
         and run.paused_at is not null
         and run.resume_requested_at is null
         and run.workflow_stage = 'pr_open'
         and exists (
           select 1 from briar_run_pull_requests link
           where link.project_id = run.project_id and link.run_id = run.id
             and link.attempt = run.current_attempt
             and link.revision = run.current_revision
         )
         and not exists (
           select 1 from briar_run_pull_requests link
           where link.project_id = run.project_id and link.run_id = run.id
             and link.attempt = run.current_attempt
             and link.revision = run.current_revision
             and (link.state <> 'merged' or link.last_delivery_id is null)
         )
         and not exists (
           select 1
           from briar_run_pull_requests link
           join briar_projects project on project.id = link.project_id
           where link.project_id = run.project_id and link.run_id = run.id
             and link.attempt = run.current_attempt
             and link.revision = run.current_revision
             and link.installation_id is not null
             and exists (
               select 1 from briar_github_connections connection
               where connection.installation_id = link.installation_id
             )
             and not exists (
               select 1 from briar_github_connections connection
               where connection.installation_id = link.installation_id
                 and connection.status = 'connected'
                 and connection.organization_id = project.organization_id
             )
         )
         and not exists (
           select 1 from briar_run_evidence evidence
           where evidence.project_id = run.project_id
             and evidence.run_id = run.id
             and evidence.attempt = run.current_attempt
             and evidence.revision = run.current_revision
             and evidence.evidence_type = 'pull_request'
             and evidence.status in ('pending', 'passed')
             and not exists (
               select 1 from briar_run_pull_requests link
               where link.run_id = evidence.run_id
                 and link.attempt = evidence.attempt
                 and link.revision = evidence.revision
                 and link.repository_id = cast(json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.repositoryId'
                 ) as integer)
                 and link.pull_request_id = cast(json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.pullRequestId'
                 ) as integer)
                 and link.pull_request_node_id = json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.pullRequestNodeId'
                 )
                 and link.pull_request_number = cast(json_extract(
                   evidence.metadata_json,
                   '$.githubPullRequest.pullRequestNumber'
                 ) as integer)
             )
         )
         and (
           run.waiting_checkpoint_key is null
           or exists (
             select 1 from briar_run_checkpoint_progress checkpoint
             where checkpoint.run_id = run.id
               and checkpoint.attempt = run.current_attempt
               and checkpoint.revision = run.current_revision
               and checkpoint.checkpoint_key = run.waiting_checkpoint_key
               and checkpoint.stage_id = 'pr_open'
               and checkpoint.position = 'after'
               and checkpoint.state = 'waiting'
           )
         )
       order by run.paused_at, run.id
       limit ?`,
    )
    .bind(boundedLimit)
    .all<{ project_id: string; run_id: string }>();
  const outcomes: string[] = [];
  for (const candidate of candidates.results) {
    const result = await attemptGithubMergeAutoResume(
      db,
      candidate.project_id,
      candidate.run_id,
    );
    outcomes.push(result.outcome);
  }
  return {
    examined: candidates.results.length,
    resumed: outcomes.filter((outcome) => outcome === "resumed").length,
    alreadyResumed: outcomes.filter((outcome) => outcome === "already_resumed")
      .length,
    deferred: outcomes.filter((outcome) => outcome === "deferred").length,
  };
}
