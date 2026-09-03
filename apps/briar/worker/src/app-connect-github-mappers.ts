import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  BeginGitHubInstallationResponseSchema,
  CreateGitHubCommitStatusResponseSchema,
  CreateGitHubPullRequestResponseSchema,
  CreateProjectGitHubCredentialResponseSchema,
  GetGitHubIntegrationResponseSchema,
  GetGitHubPullRequestResponseSchema,
  GetProjectGitHubRepositoryResponseSchema,
  GetProjectMergeActivityResponseSchema,
  GitHubInstallationRepositorySchema,
  GitHubMergeResultSchema,
  GitHubPullRequestSchema,
  GitHubPullRequestState,
  MergeGitHubPullRequestResponseSchema,
  ProjectGitHubCredentialSchema,
  ProjectGitHubRepositorySchema,
  UpdateGitHubPullRequestResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import {
  GitHubPullRequestIdentitySchema,
} from "@briar/contracts/gen/briar/types/v1/github_identity_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ProjectMergeActivity } from "../../src/lib/project-merge-activity";

export const appProjectMergeActivity = (activity: ProjectMergeActivity) =>
  create(GetProjectMergeActivityResponseSchema, {
    repository: activity.repository,
    generatedAt: timestampFromDate(new Date(activity.generatedAt)),
    pullRequests: activity.pullRequests.map((pr) => ({
      number: BigInt(pr.number),
      title: pr.title,
      url: pr.url,
      mergedAt: timestampFromDate(new Date(pr.mergedAt)),
    })),
  });

type IntegrationResult = Awaited<
  ReturnType<
    typeof import("./github-integration-application").getGithubIntegrationApplication
  >
>;
type BeginInstallationResult = Awaited<
  ReturnType<
    typeof import("./github-integration-application").beginGithubInstallationApplication
  >
>;
type CredentialResult = Awaited<
  ReturnType<
    typeof import("./team-github-application").createTeamGithubCredentialApplication
  >
>;
type RepositoryResult = Awaited<
  ReturnType<
    typeof import("./team-github-application").getTeamGithubRepositoryApplication
  >
>;
type PullRequestResult = Awaited<
  ReturnType<
    typeof import("./team-github-application").getTeamGithubPullRequestApplication
  >
>;
type MergeResult = Awaited<
  ReturnType<
    typeof import("./team-github-application").mergeTeamGithubPullRequestApplication
  >
>;

const internal = (message: string): never => {
  throw new ConnectError(message, Code.Internal);
};

const positiveUint64 = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return internal(`Invalid trusted ${field}`);
  }
  return BigInt(value);
};

const requiredTimestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return internal(`Invalid trusted ${field} timestamp`);
  }
  return timestampFromDate(date);
};

export const appGithubIntegration = (result: IntegrationResult) =>
  create(GetGitHubIntegrationResponseSchema, {
    configured: result.configured,
    canManage: result.canManage,
    connected: result.connected,
    installationId: result.connected
      ? positiveUint64(result.installationId, "GitHub installation id")
      : undefined,
    accountLogin: result.connected ? result.accountLogin : undefined,
    accountAvatarUrl: result.connected ? result.accountAvatarUrl : undefined,
    repositories: result.connected
      ? result.repositories.map((repository) =>
        create(GitHubInstallationRepositorySchema, {
          id: positiveUint64(repository.id, "GitHub repository id"),
          owner: repository.owner,
          name: repository.name,
          fullName: repository.fullName,
        })
      )
      : [],
    connectedAt: result.connected
      ? requiredTimestamp(result.connectedAt, "GitHub connection")
      : undefined,
  });

export const appBeginGithubInstallation = (
  result: BeginInstallationResult,
) =>
  create(BeginGitHubInstallationResponseSchema, {
    installUrl: result.installUrl,
  });

export const appProjectGithubCredentialMessage = (result: CredentialResult) =>
  create(ProjectGitHubCredentialSchema, {
    projectId: result.projectId,
    organizationId: result.organizationId,
    repositoryId: positiveUint64(
      result.repositoryId,
      "GitHub credential repository id",
    ),
    repository: result.repository,
    cloneUrl: result.cloneUrl,
    username: result.username,
    // This request-only secret must never be copied into logs or errors.
    password: result.password,
    expiresAt: requiredTimestamp(
      result.expiresAt,
      "GitHub credential expiration",
    ),
  });

export const appProjectGithubCredential = (result: CredentialResult) =>
  create(CreateProjectGitHubCredentialResponseSchema, {
    credential: appProjectGithubCredentialMessage(result),
  });

export const appProjectGithubRepository = (result: RepositoryResult) =>
  create(GetProjectGitHubRepositoryResponseSchema, {
    repository: create(ProjectGitHubRepositorySchema, {
      id: positiveUint64(result.id, "GitHub repository id"),
      fullName: result.full_name,
      defaultBranch: result.default_branch,
      allowSquashMerge: result.allow_squash_merge,
      allowRebaseMerge: result.allow_rebase_merge,
      allowMergeCommit: result.allow_merge_commit,
    }),
  });

const pullRequestState = {
  open: GitHubPullRequestState.OPEN,
  closed: GitHubPullRequestState.CLOSED,
  merged: GitHubPullRequestState.MERGED,
} as const satisfies Record<
  PullRequestResult["state"],
  GitHubPullRequestState
>;

const appPullRequest = (result: PullRequestResult) =>
  create(GitHubPullRequestSchema, {
    identity: create(GitHubPullRequestIdentitySchema, {
      repositoryId: positiveUint64(
        result.repositoryId,
        "GitHub pull request repository id",
      ),
      pullRequestId: positiveUint64(
        result.pullRequestId,
        "GitHub pull request id",
      ),
      pullRequestNodeId: result.pullRequestNodeId,
      pullRequestNumber: positiveUint64(
        result.pullRequestNumber,
        "GitHub pull request number",
      ),
    }),
    repository: result.repository,
    url: result.url,
    state: pullRequestState[result.state],
    draft: result.draft,
    merged: result.merged,
    body: result.body,
    headSha: result.headSha,
    headRef: result.headRef,
    baseSha: result.baseSha,
    baseRef: result.baseRef,
  });

export const appCreateGithubPullRequest = (result: PullRequestResult) =>
  create(CreateGitHubPullRequestResponseSchema, {
    pullRequest: appPullRequest(result),
  });

export const appGetGithubPullRequest = (result: PullRequestResult) =>
  create(GetGitHubPullRequestResponseSchema, {
    pullRequest: appPullRequest(result),
  });

export const appUpdateGithubPullRequest = (result: PullRequestResult) =>
  create(UpdateGitHubPullRequestResponseSchema, {
    pullRequest: appPullRequest(result),
  });

export const appMergeGithubPullRequest = (result: MergeResult) =>
  create(MergeGitHubPullRequestResponseSchema, {
    merge: create(GitHubMergeResultSchema, result),
  });

export const appCreateGithubCommitStatus = () =>
  create(CreateGitHubCommitStatusResponseSchema, {});
