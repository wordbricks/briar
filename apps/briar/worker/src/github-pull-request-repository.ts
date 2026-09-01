import type {
  GitHubPullRequestIdentity,
} from "@briar/contracts/gen/briar/types/v1/github_identity_pb";
import { attemptGithubMergeAutoResume } from "./github-merge-reconciliation";
import {
  type GithubPullRequestState,
  type GithubPullRequestSyncInput,
  type RunPullRequestRow,
} from "./github-pull-request-model";
import { stableJson } from "./hunt-run-codec";
import { getHuntRunForProject } from "./hunt-run-repository";

const githubPullRequestStateRank = {
  unknown: 0,
  open: 1,
  closed: 2,
  merged: 3,
} satisfies Record<GithubPullRequestState, number>;

export const githubPullRequestUrlTarget = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    return null;
  }
  const match = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/u,
  );
  return match
    ? {
        repository: `${match[1]}/${match[2]}`.toLowerCase(),
        number: Number(match[3]),
      }
    : null;
};

export type GithubPullRequestEvidenceIdentity = {
  repositoryId: number;
  repository: string;
  pullRequestId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
};

export const githubPullRequestEvidenceIdentity = (
  value: GitHubPullRequestIdentity | null | undefined,
  target: { repository: string; number: number },
): GithubPullRequestEvidenceIdentity | null => {
  if (!value) return null;
  const repository = target.repository;
  const repositoryId = Number(value.repositoryId);
  const pullRequestId = Number(value.pullRequestId);
  const pullRequestNodeId = value.pullRequestNodeId.trim();
  const pullRequestNumber = Number(value.pullRequestNumber);
  if (
    !Number.isSafeInteger(repositoryId) || Number(repositoryId) <= 0 ||
    !Number.isSafeInteger(pullRequestId) || Number(pullRequestId) <= 0 ||
    !Number.isSafeInteger(pullRequestNumber) || Number(pullRequestNumber) <= 0 ||
    pullRequestNumber !== target.number ||
    pullRequestNodeId.length < 1 ||
    pullRequestNodeId.length > 200
  ) return null;
  return {
    repositoryId,
    repository,
    pullRequestId,
    pullRequestNodeId,
    pullRequestNumber,
  };
};

const githubPullRequestSyncDetail = (input: GithubPullRequestSyncInput) => {
  if (input.state === "merged") {
    return `GitHub PR #${input.pullRequestNumber}이(가) merge되었습니다.`;
  }
  if (input.state === "closed") {
    return `GitHub PR #${input.pullRequestNumber}이(가) merge 없이 닫혔습니다.`;
  }
  return input.draft
    ? `GitHub PR #${input.pullRequestNumber}이(가) draft 상태입니다.`
    : `GitHub PR #${input.pullRequestNumber}이(가) 열려 있습니다.`;
};

async function githubPullRequestLinksForEvent(
  db: D1Database,
  input: Pick<
    GithubPullRequestSyncInput,
    | "repositoryId"
    | "repository"
    | "pullRequestId"
    | "pullRequestNodeId"
    | "pullRequestNumber"
    | "state"
    | "mergedAt"
    | "providerUpdatedAt"
    | "linkedIssues"
    | "organizationId"
  >,
) {
  const linkedIssuesJson = stableJson(input.linkedIssues);
  const result = await db
    .prepare(
      `select link.*
       from briar_run_pull_requests link
       join briar_hunt_runs run
         on run.id = link.run_id and run.project_id = link.project_id
       join briar_teams project on project.id = link.project_id
       join briar_github_pull_requests snapshot
         on snapshot.repository_id = link.repository_id
        and snapshot.pull_request_number = link.pull_request_number
        and snapshot.pull_request_id = link.pull_request_id
        and snapshot.pull_request_node_id = link.pull_request_node_id
       where unixepoch(snapshot.provider_updated_at) >=
           unixepoch(link.revision_started_at)
         and unixepoch(?) >= unixepoch(link.revision_started_at)
         and (? is null or project.organization_id = ?)
         and link.repository_id = ? and link.pull_request_number = ?
         and link.pull_request_id = ? and link.pull_request_node_id = ?
         and (
           link.last_delivery_id is not null
           or (
             link.repository = ?
             and (? is null or ? = 'merged')
           )
         )
         and (? <> 'merged' or ? is not null)
         and (
           ? <> 'merged'
           or exists (
             select 1 from json_each(?) issue
             where json_extract(issue.value, '$.projectId') = link.project_id
               and json_extract(issue.value, '$.runId') = link.run_id
           )
         )
         and (
           ? <> 'merged'
           or (
             snapshot.updated_at >= link.created_at
             and unixepoch(snapshot.merged_at) >= unixepoch(link.created_at)
           )
         )`,
    )
    .bind(
      input.providerUpdatedAt,
      input.organizationId ?? null,
      input.organizationId ?? null,
      input.repositoryId,
      input.pullRequestNumber,
      input.pullRequestId,
      input.pullRequestNodeId,
      input.repository,
      input.mergedAt,
      input.state,
      input.state,
      input.mergedAt,
      input.state,
      linkedIssuesJson,
      input.state,
    )
    .all<RunPullRequestRow>();
  return result.results;
}

async function recordGithubPullRequestSyncEvent(
  db: D1Database,
  projectId: string,
  runId: string,
  input: GithubPullRequestSyncInput,
) {
  const eventId = crypto.randomUUID();
  const eventKey = `github:pull_request:${input.deliveryId}`;
  const recordedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, current_attempt, current_revision, stage, status,
                workflow_stage, ?, ?, branch, commit_sha, null,
                tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        githubPullRequestSyncDetail(input),
        input.actor.slice(0, 128),
        input.providerUpdatedAt,
        recordedAt,
        runId,
        projectId,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set last_event_at = max(last_event_at, ?),
             updated_at = max(updated_at, ?)
         where id = ? and project_id = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        input.providerUpdatedAt,
        input.observedAt,
        runId,
        projectId,
        eventId,
      ),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}

export async function syncGithubPullRequest(
  db: D1Database,
  rawInput: GithubPullRequestSyncInput,
) {
  const repository = rawInput.repository.toLowerCase();
  const input = {
    ...rawInput,
    repository,
    url: `https://github.com/${repository}/pull/${rawInput.pullRequestNumber}`,
  };
  await db
    .prepare(
      `insert into briar_github_pull_requests (
         repository_id, pull_request_number, installation_id, repository,
         pull_request_id, pull_request_node_id, url, state, draft,
         head_sha, base_sha, base_branch, merge_commit_sha,
         opened_at, closed_at, merged_at,
         provider_updated_at, last_delivery_id, briar_issue_links_json,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(repository_id, pull_request_number) do update set
         installation_id = excluded.installation_id,
         repository = excluded.repository,
         pull_request_id = excluded.pull_request_id,
         pull_request_node_id = excluded.pull_request_node_id,
         url = excluded.url,
         state = excluded.state,
         draft = excluded.draft,
         head_sha = excluded.head_sha,
         base_sha = excluded.base_sha,
         base_branch = excluded.base_branch,
         merge_commit_sha = excluded.merge_commit_sha,
         opened_at = excluded.opened_at,
         closed_at = excluded.closed_at,
         merged_at = excluded.merged_at,
         provider_updated_at = excluded.provider_updated_at,
         last_delivery_id = excluded.last_delivery_id,
         briar_issue_links_json = excluded.briar_issue_links_json,
         updated_at = excluded.updated_at
       where briar_github_pull_requests.state <> 'merged'
         and (
           excluded.state = 'merged'
           or briar_github_pull_requests.provider_updated_at <
             excluded.provider_updated_at
           or (
             briar_github_pull_requests.provider_updated_at =
               excluded.provider_updated_at
             and case briar_github_pull_requests.state
                   when 'open' then 1 when 'closed' then 2 when 'merged' then 3
                 end <=
                 case excluded.state
                   when 'open' then 1 when 'closed' then 2 when 'merged' then 3
                 end
           )
         )`,
    )
    .bind(
      input.repositoryId,
      input.pullRequestNumber,
      input.installationId,
      input.repository,
      input.pullRequestId,
      input.pullRequestNodeId,
      input.url,
      input.state,
      input.draft ? 1 : 0,
      input.headSha,
      input.baseSha,
      input.baseBranch,
      input.mergeCommitSha,
      input.openedAt,
      input.closedAt,
      input.mergedAt,
      input.providerUpdatedAt,
      input.deliveryId,
      stableJson(input.linkedIssues),
      input.observedAt,
      input.observedAt,
    )
    .run();
  // PR-body Briar links are deliberately not used as authorization. The
  // active worker's pull_request evidence is the durable run/PR binding;
  // repository and numeric provider identity then protect later renames.
  const links = await githubPullRequestLinksForEvent(db, input);
  const updatedRunIds = new Set<string>();
  const matchedCurrentRuns = new Map<string, string>();
  for (const link of links) {
    const run = await getHuntRunForProject(db, link.project_id, link.run_id);
    if (!run) continue;
    if (
      link.attempt === run.current_attempt &&
      link.revision === run.current_revision
    ) {
      matchedCurrentRuns.set(link.run_id, link.project_id);
    }
    const result = await db
      .prepare(
        `update briar_run_pull_requests
         set installation_id = ?, repository_id = ?, repository = ?, url = ?,
             pull_request_id = ?, pull_request_node_id = ?,
             pull_request_number = ?, state = ?, draft = ?,
             head_sha = ?, base_sha = ?, base_branch = ?, merge_commit_sha = ?,
             opened_at = ?, closed_at = ?, merged_at = ?,
             provider_updated_at = ?, last_delivery_id = ?, updated_at = ?
         where run_id = ? and project_id = ? and attempt = ? and revision = ?
           and repository_id = ? and pull_request_number = ?
           and state <> 'merged'
           and (
             ? = 'merged'
             or provider_updated_at is null
             or provider_updated_at < ?
             or (
               provider_updated_at = ?
               and case state
                     when 'unknown' then 0 when 'open' then 1
                     when 'closed' then 2 when 'merged' then 3
                   end <= ?
             )
           )`,
      )
      .bind(
        input.installationId,
        input.repositoryId,
        input.repository,
        input.url,
        input.pullRequestId,
        input.pullRequestNodeId,
        input.pullRequestNumber,
        input.state,
        input.draft ? 1 : 0,
        input.headSha,
        input.baseSha,
        input.baseBranch,
        input.mergeCommitSha,
        input.openedAt,
        input.closedAt,
        input.mergedAt,
        input.providerUpdatedAt,
        input.deliveryId,
        input.observedAt,
        link.run_id,
        link.project_id,
        link.attempt,
        link.revision,
        link.repository_id,
        link.pull_request_number,
        input.state,
        input.providerUpdatedAt,
        input.providerUpdatedAt,
        githubPullRequestStateRank[input.state],
      )
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      updatedRunIds.add(link.run_id);
    }
  }

  for (const runId of updatedRunIds) {
    const projectId = matchedCurrentRuns.get(runId);
    if (projectId) {
      await recordGithubPullRequestSyncEvent(db, projectId, runId, input);
    }
  }

  const resumeOutcomes: Array<{ runId: string; outcome: string }> = [];
  if (input.state === "merged") {
    for (const [runId, projectId] of matchedCurrentRuns) {
      const resumed = await attemptGithubMergeAutoResume(
        db,
        projectId,
        runId,
        input.actor,
      );
      resumeOutcomes.push({ runId, outcome: resumed.outcome });
    }
  }
  return {
    matchedRunCount: new Set(links.map((link) => link.run_id)).size,
    updatedRunCount: updatedRunIds.size,
    resumedRunCount: resumeOutcomes.filter(
      (result) => result.outcome === "resumed",
    ).length,
    resumeOutcomes,
  };
}
