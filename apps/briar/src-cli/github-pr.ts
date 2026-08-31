import { ProjectGitHubService } from "@briar/contracts/gen/briar/app/v1/github_pb";
import { githubPullRequestFromProto } from "../src/lib/app-rpc/github-mappers";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import { createAuthenticatedConnectClient } from "./connect-client";

type GithubPullRequestTarget = {
  owner: string;
  repository: string;
  number: string;
};

export type GithubPullRequestIdentity = {
  repositoryId: number;
  repository: string;
  pullRequestId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
};

type GithubPullRequestInspection = GithubPullRequestIdentity & {
  body: string;
};

export type GithubPullRequestApi = {
  getPullRequest(input: {
    projectId: string;
    pullRequestNumber: bigint;
  }): Promise<GithubPullRequestInspection>;
  updatePullRequest(input: {
    projectId: string;
    pullRequestNumber: bigint;
    body: string;
  }): Promise<void>;
};

export function briarIssueUrl(
  apiUrl: string,
  projectId: string,
  runId: string,
) {
  const url = new URL(apiUrl);
  url.pathname = `/open/issues/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function githubPullRequestTarget(
  value: string,
): GithubPullRequestTarget | null {
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
    ? { owner: match[1], repository: match[2], number: match[3] }
    : null;
}

export function appendBriarIssueLink(body: string, issueUrl: string) {
  if (body.includes(issueUrl)) return body;
  const existing = body.trimEnd();
  return `${existing}${existing ? "\n\n" : ""}[Briar issue](${issueUrl})\n`;
}

function validateGithubPullRequestInspection(
  value: GithubPullRequestInspection,
  target: GithubPullRequestTarget,
) {
  const repository = value.repository.trim().toLowerCase();
  const expectedRepository =
    `${target.owner}/${target.repository}`.toLowerCase();
  if (
    repository !== expectedRepository ||
    value.pullRequestNumber !== Number(target.number)
  ) {
    throw new Error("GitHub PR metadata response did not match the requested PR");
  }
  return {
    body: value.body,
    repositoryId: value.repositoryId,
    repository,
    pullRequestId: value.pullRequestId,
    pullRequestNodeId: value.pullRequestNodeId.trim(),
    pullRequestNumber: value.pullRequestNumber,
  };
}

const connectGithubPullRequestApi = (
  apiUrl: string,
  token: string,
): GithubPullRequestApi => {
  const client = createAuthenticatedConnectClient(
    ProjectGitHubService,
    apiUrl,
    token,
  );
  return {
    getPullRequest: async (input) => githubPullRequestFromProto(requiredMessage(
      (await client.getGitHubPullRequest(input)).pullRequest,
      "getGitHubPullRequest.pullRequest",
    )),
    updatePullRequest: async (input) => {
      await client.updateGitHubPullRequest(input);
    },
  };
};

export async function ensureBriarIssueLinkInGithubPullRequest(
  input: {
    apiUrl: string;
    projectId: string;
    token: string;
    pullRequestUrl: string;
    issueUrl: string;
  },
  api: GithubPullRequestApi = connectGithubPullRequestApi(
    input.apiUrl,
    input.token,
  ),
) {
  const target = githubPullRequestTarget(input.pullRequestUrl);
  if (!target) return { updated: false, reason: "not_github" as const };

  const pullRequestNumber = BigInt(target.number);
  const inspection = validateGithubPullRequestInspection(
    await api.getPullRequest({
      projectId: input.projectId,
      pullRequestNumber,
    }),
    target,
  );

  const body = appendBriarIssueLink(inspection.body, input.issueUrl);
  if (body === inspection.body) {
    return {
      updated: false,
      reason: "already_linked" as const,
      identity: {
        repositoryId: inspection.repositoryId,
        repository: inspection.repository,
        pullRequestId: inspection.pullRequestId,
        pullRequestNodeId: inspection.pullRequestNodeId,
        pullRequestNumber: inspection.pullRequestNumber,
      },
    };
  }

  await api.updatePullRequest({
    projectId: input.projectId,
    pullRequestNumber,
    body,
  });
  return {
    updated: true,
    reason: "linked" as const,
    identity: {
      repositoryId: inspection.repositoryId,
      repository: inspection.repository,
      pullRequestId: inspection.pullRequestId,
      pullRequestNodeId: inspection.pullRequestNodeId,
      pullRequestNumber: inspection.pullRequestNumber,
    },
  };
}
