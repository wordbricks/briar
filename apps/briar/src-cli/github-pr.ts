import * as Schema from "effect/Schema";
import { request } from "./command-support";

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

const GithubPullRequestInspectionResponse = Schema.Struct({
  pullRequest: Schema.Struct({
    repositoryId: Schema.Int.check(Schema.isGreaterThan(0)),
    repository: Schema.String,
    pullRequestId: Schema.Int.check(Schema.isGreaterThan(0)),
    pullRequestNodeId: Schema.String.check(Schema.isMinLength(1)),
    pullRequestNumber: Schema.Int.check(Schema.isGreaterThan(0)),
    body: Schema.String,
  }).annotate({ parseOptions: { onExcessProperty: "preserve" } }),
}).annotate({ parseOptions: { onExcessProperty: "preserve" } });

const decodeInspectionResponse = Schema.decodeUnknownSync(
  GithubPullRequestInspectionResponse,
  { errors: "all" },
);

export type GithubApiRequest = (
  path: string,
  init?: RequestInit,
) => Promise<unknown>;

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
  value: typeof GithubPullRequestInspectionResponse.Type["pullRequest"],
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

export async function ensureBriarIssueLinkInGithubPullRequest(
  input: {
    apiUrl: string;
    projectId: string;
    token: string;
    pullRequestUrl: string;
    issueUrl: string;
  },
  send: GithubApiRequest = (path, init) =>
    request(input.apiUrl, path, input.token, init),
) {
  const target = githubPullRequestTarget(input.pullRequestUrl);
  if (!target) return { updated: false, reason: "not_github" as const };

  const endpoint = `/projects/${encodeURIComponent(input.projectId)}/github/pull-requests/${target.number}`;
  const current = decodeInspectionResponse(await send(endpoint));
  const inspection = validateGithubPullRequestInspection(
    current.pullRequest,
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

  await send(endpoint, {
    method: "PATCH",
    body: JSON.stringify({ body }),
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
