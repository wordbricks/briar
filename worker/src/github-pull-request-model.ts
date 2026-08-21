export type GithubPullRequestState = "unknown" | "open" | "closed" | "merged";

export type RunPullRequestRow = {
  project_id: string;
  run_id: string;
  attempt: number;
  revision: number;
  revision_started_at: string;
  url: string;
  installation_id: number | null;
  repository_id: number;
  repository: string;
  pull_request_id: number;
  pull_request_node_id: string;
  pull_request_number: number;
  state: GithubPullRequestState;
  draft: number | null;
  head_sha: string | null;
  base_sha: string | null;
  base_branch: string | null;
  merge_commit_sha: string | null;
  opened_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  provider_updated_at: string | null;
  last_delivery_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GithubPullRequestSyncInput = {
  deliveryId: string;
  installationId: number | null;
  repositoryId: number;
  repository: string;
  pullRequestId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
  url: string;
  state: Exclude<GithubPullRequestState, "unknown">;
  draft: boolean;
  headSha: string;
  baseSha: string;
  baseBranch: string;
  mergeCommitSha: string | null;
  openedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  providerUpdatedAt: string;
  linkedIssues: Array<{ projectId: string; runId: string }>;
  actor: string;
  observedAt: string;
  /** Restricts a connected installation to runs in its Briar organization. */
  organizationId?: string | null;
};
