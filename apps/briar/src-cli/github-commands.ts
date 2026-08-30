import { readFile } from "node:fs/promises";
import { toJsonString } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import {
  GitHubMergeResultSchema,
  GitHubPullRequestSchema,
  ProjectGitHubRepositorySchema,
  ProjectGitHubService,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import {
  githubCommitStatusStateToProto,
  githubMergeMethodToProto,
  githubPullRequestStateToProto,
  projectGithubCredentialFromProto,
} from "../src/lib/app-rpc/github-mappers";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import {
  appConnectCallOptions,
  appConnectTransport,
} from "./app-connect-client";
import {
  args,
  currentProject,
  executionToken,
  has,
  loadConfig,
  request,
  required,
  value,
} from "./command-support";

const maximumUint64 = 18_446_744_073_709_551_615n;

const positiveUint64 = (raw: string, field: string) => {
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(`${field} must be a positive integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > maximumUint64) throw new Error(`${field} is outside uint64`);
  return parsed;
};

async function projectGithubContext() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const token = executionToken(project);
  return {
    apiUrl: config.apiUrl,
    projectId: project.id,
    token,
    client: createClient(
      ProjectGitHubService,
      appConnectTransport(config.apiUrl),
    ),
    options: appConnectCallOptions(token),
  };
}

async function optionalBody() {
  const body = value("--body");
  const bodyFile = value("--body-file");
  if (body !== undefined && bodyFile !== undefined) {
    throw new Error("Use only one of --body or --body-file");
  }
  return bodyFile ? await readFile(bodyFile, "utf8") : body;
}

const pullRequestState = (raw: string) => {
  switch (raw) {
    case "open":
    case "closed":
      return githubPullRequestStateToProto(raw);
    default:
      throw new Error("--state must be open or closed");
  }
};

const mergeMethod = (raw: string) => {
  switch (raw) {
    case "merge":
    case "squash":
    case "rebase":
      return githubMergeMethodToProto(raw);
    default:
      throw new Error("--method must be merge, squash, or rebase");
  }
};

const commitStatusState = (raw: string) => {
  switch (raw) {
    case "error":
    case "failure":
    case "pending":
    case "success":
      return githubCommitStatusStateToProto(raw);
    default:
      throw new Error("--state must be error, failure, pending, or success");
  }
};

export async function githubPullRequestCreateCommand() {
  const github = await projectGithubContext();
  const response = await github.client.createGitHubPullRequest({
    projectId: github.projectId,
    title: required("--title"),
    head: required("--head"),
    base: value("--base") ?? "main",
    body: (await optionalBody()) ?? "",
    draft: has("--draft"),
  }, github.options);
  console.log(toJsonString(
    GitHubPullRequestSchema,
    requiredMessage(response.pullRequest, "createGitHubPullRequest.pullRequest"),
  ));
}

export async function githubPullRequestViewCommand() {
  const github = await projectGithubContext();
  const response = await github.client.getGitHubPullRequest({
    projectId: github.projectId,
    pullRequestNumber: positiveUint64(required("--number"), "--number"),
  }, github.options);
  console.log(toJsonString(
    GitHubPullRequestSchema,
    requiredMessage(response.pullRequest, "getGitHubPullRequest.pullRequest"),
  ));
}

export async function githubPullRequestEditCommand() {
  const github = await projectGithubContext();
  const title = value("--title");
  const body = await optionalBody();
  const base = value("--base");
  const state = value("--state");
  if (
    title === undefined &&
    body === undefined &&
    base === undefined &&
    state === undefined
  ) {
    throw new Error("Provide at least one PR field to update");
  }
  const response = await github.client.updateGitHubPullRequest({
    projectId: github.projectId,
    pullRequestNumber: positiveUint64(required("--number"), "--number"),
    title,
    body,
    base,
    state: state === undefined ? undefined : pullRequestState(state),
  }, github.options);
  console.log(toJsonString(
    GitHubPullRequestSchema,
    requiredMessage(response.pullRequest, "updateGitHubPullRequest.pullRequest"),
  ));
}

export async function githubPullRequestMergeCommand() {
  const github = await projectGithubContext();
  const response = await github.client.mergeGitHubPullRequest({
    projectId: github.projectId,
    pullRequestNumber: positiveUint64(required("--number"), "--number"),
    mergeMethod: mergeMethod(value("--method") ?? "squash"),
    expectedHeadSha: value("--head-sha"),
  }, github.options);
  console.log(toJsonString(
    GitHubMergeResultSchema,
    requiredMessage(response.merge, "mergeGitHubPullRequest.merge"),
  ));
}

export async function githubCommitStatusCommand() {
  const github = await projectGithubContext();
  await github.client.createGitHubCommitStatus({
    projectId: github.projectId,
    sha: required("--sha"),
    state: commitStatusState(required("--state")),
    context: required("--context"),
    description: value("--description"),
    targetUrl: value("--target-url"),
  }, github.options);
  console.log(JSON.stringify({ ok: true }));
}

export async function githubRepositoryCommand() {
  const github = await projectGithubContext();
  const response = await github.client.getProjectGitHubRepository(
    { projectId: github.projectId },
    github.options,
  );
  console.log(toJsonString(
    ProjectGitHubRepositorySchema,
    requiredMessage(response.repository, "getProjectGitHubRepository.repository"),
  ));
}

export async function githubGraphqlCommand() {
  const github = await projectGithubContext();
  const variablesJson = value("--variables-json") ?? "{}";
  let variables: unknown;
  try {
    variables = JSON.parse(variablesJson);
  } catch {
    throw new Error("--variables-json must be valid JSON");
  }
  if (!variables || Array.isArray(variables) || typeof variables !== "object") {
    throw new Error("--variables-json must be a JSON object");
  }
  const result = await request<unknown>(
    github.apiUrl,
    `/projects/${github.projectId}/github/graphql`,
    github.token,
    {
      method: "POST",
      body: JSON.stringify({ query: required("--query"), variables }),
    },
  );
  console.log(JSON.stringify(result));
}

const credentialInput = async () => {
  const text = await Bun.stdin.text();
  return Object.fromEntries(
    text.split("\n").flatMap((line) => {
      const separator = line.indexOf("=");
      return separator > 0
        ? [[line.slice(0, separator), line.slice(separator + 1)]]
        : [];
    }),
  );
};

export async function githubCredentialCommand() {
  const operation = args.at(-1);
  if (operation === "store" || operation === "erase") return;
  if (operation !== "get") {
    throw new Error("Git credential operation must be get, store, or erase");
  }
  const input = await credentialInput();
  if (input.protocol !== "https" || input.host !== "github.com") return;
  const github = await projectGithubContext();
  const response = await github.client.createProjectGitHubCredential(
    { projectId: github.projectId },
    github.options,
  );
  const credential = projectGithubCredentialFromProto(requiredMessage(
    response.credential,
    "createProjectGitHubCredential.credential",
  ));
  const expectedPath = `${credential.repository.fullName}.git`.toLowerCase();
  const requestedPath = input.path?.replace(/^\//u, "").toLowerCase();
  if (requestedPath && requestedPath !== expectedPath) return;
  process.stdout.write(
    `username=${credential.username}\npassword=${credential.password}\n\n`,
  );
}
