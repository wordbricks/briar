import {
  GitHubCommitStatusState as ProtoCommitStatusState,
  GitHubMergeMethod as ProtoMergeMethod,
  GitHubPullRequestState as ProtoPullRequestState,
  type GetGitHubIntegrationResponse,
  type GitHubMergeResult as GitHubMergeResultMessage,
  type GitHubPullRequest as GitHubPullRequestMessage,
  type ProjectGitHubCredential as ProjectGitHubCredentialMessage,
  type ProjectGitHubRepository as ProjectGitHubRepositoryMessage,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import {
  requiredTimestamp,
  safeNumber,
} from "./mappers";

export type GithubIntegrationRepository = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
};

export type GithubIntegration = {
  configured: boolean;
  canManage: boolean;
  connected: boolean;
  installationId: string | null;
  accountLogin: string | null;
  accountAvatarUrl: string | null;
  repositories: GithubIntegrationRepository[];
  connectedAt: string | null;
};

export type ProjectGithubCredential = {
  project: { id: string; organizationId: string };
  repository: { id: number; fullName: string; cloneUrl: string };
  username: string;
  password: string;
  expiresAt: string;
};

export type ProjectGithubRepository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  allowSquashMerge: boolean;
  allowRebaseMerge: boolean;
  allowMergeCommit: boolean;
};

export type GithubPullRequest = {
  repositoryId: number;
  repository: string;
  pullRequestId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  merged: boolean;
  body: string;
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
};

export type GithubMergeResult = {
  sha: string;
  merged: boolean;
  message: string;
};

const positiveSafeNumber = (value: bigint, field: string) => {
  const result = safeNumber(value, field);
  if (result < 1) throw new Error(`${field} must be positive`);
  return result;
};

export const githubIntegrationFromProto = (
  response: GetGitHubIntegrationResponse,
): GithubIntegration => {
  if (
    response.connected &&
    (response.installationId === undefined ||
      response.accountLogin === undefined ||
      response.connectedAt === undefined)
  ) {
    throw new Error("Connected GitHub integration identity is incomplete");
  }
  return {
    configured: response.configured,
    canManage: response.canManage,
    connected: response.connected,
    installationId: response.installationId?.toString() ?? null,
    accountLogin: response.accountLogin ?? null,
    accountAvatarUrl: response.accountAvatarUrl ?? null,
    repositories: response.repositories.map((repository) => ({
      id: repository.id.toString(),
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
    })),
    connectedAt: response.connectedAt
      ? requiredTimestamp(response.connectedAt, "githubIntegration.connectedAt")
      : null,
  };
};

export const projectGithubCredentialFromProto = (
  value: ProjectGitHubCredentialMessage,
): ProjectGithubCredential => ({
  project: { id: value.projectId, organizationId: value.organizationId },
  repository: {
    id: positiveSafeNumber(value.repositoryId, "githubCredential.repositoryId"),
    fullName: value.repository,
    cloneUrl: value.cloneUrl,
  },
  username: value.username,
  password: value.password,
  expiresAt: requiredTimestamp(value.expiresAt, "githubCredential.expiresAt"),
});

export const projectGithubRepositoryFromProto = (
  value: ProjectGitHubRepositoryMessage,
): ProjectGithubRepository => ({
  id: positiveSafeNumber(value.id, "githubRepository.id"),
  fullName: value.fullName,
  defaultBranch: value.defaultBranch,
  allowSquashMerge: value.allowSquashMerge,
  allowRebaseMerge: value.allowRebaseMerge,
  allowMergeCommit: value.allowMergeCommit,
});

const githubPullRequestStateFromProto = (
  value: ProtoPullRequestState,
): GithubPullRequest["state"] => {
  switch (value) {
    case ProtoPullRequestState.OPEN:
      return "open";
    case ProtoPullRequestState.CLOSED:
      return "closed";
    case ProtoPullRequestState.MERGED:
      return "merged";
    case ProtoPullRequestState.UNSPECIFIED:
      throw new Error("GitHub pull request state is missing");
    default:
      throw new Error(`Unknown GitHub pull request state: ${value}`);
  }
};

export const githubPullRequestFromProto = (
  value: GitHubPullRequestMessage,
): GithubPullRequest => {
  const state = githubPullRequestStateFromProto(value.state);
  if (value.merged !== (state === "merged")) {
    throw new Error("GitHub pull request merge state is inconsistent");
  }
  return {
    repositoryId: positiveSafeNumber(value.repositoryId, "githubPullRequest.repositoryId"),
    repository: value.repository,
    pullRequestId: positiveSafeNumber(value.pullRequestId, "githubPullRequest.id"),
    pullRequestNodeId: value.pullRequestNodeId,
    pullRequestNumber: positiveSafeNumber(
      value.pullRequestNumber,
      "githubPullRequest.number",
    ),
    url: value.url,
    state,
    draft: value.draft,
    merged: value.merged,
    body: value.body,
    headSha: value.headSha,
    headRef: value.headRef,
    baseSha: value.baseSha,
    baseRef: value.baseRef,
  };
};

export const githubMergeResultFromProto = (
  value: GitHubMergeResultMessage,
): GithubMergeResult => ({
  sha: value.sha,
  merged: value.merged,
  message: value.message,
});

export const githubPullRequestStateToProto = (
  value: "open" | "closed",
) => value === "open" ? ProtoPullRequestState.OPEN : ProtoPullRequestState.CLOSED;

export const githubMergeMethodToProto = (
  value: "merge" | "squash" | "rebase",
) => {
  switch (value) {
    case "merge":
      return ProtoMergeMethod.MERGE;
    case "squash":
      return ProtoMergeMethod.SQUASH;
    case "rebase":
      return ProtoMergeMethod.REBASE;
  }
};

export const githubCommitStatusStateToProto = (
  value: "error" | "failure" | "pending" | "success",
) => {
  switch (value) {
    case "error":
      return ProtoCommitStatusState.ERROR;
    case "failure":
      return ProtoCommitStatusState.FAILURE;
    case "pending":
      return ProtoCommitStatusState.PENDING;
    case "success":
      return ProtoCommitStatusState.SUCCESS;
  }
};
