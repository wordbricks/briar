import { createClient } from "@connectrpc/connect";
import {
  GitHubIntegrationService,
  ProjectGitHubService,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import { appCallOptions, appTransport } from "./core";
import {
  githubIntegrationFromProto,
  projectGithubCredentialFromProto,
} from "./github-mappers";
import { requiredMessage, requiredTimestamp } from "./mappers";
import type { ProjectMergeActivity } from "../project-merge-activity";

const integrationClient = appTransport
  ? createClient(GitHubIntegrationService, appTransport)
  : undefined;
const projectGithubClient = appTransport
  ? createClient(ProjectGitHubService, appTransport)
  : undefined;

const requireIntegrationClient = () => {
  if (!integrationClient) throw new Error("Briar API URL이 설정되지 않았습니다.");
  return integrationClient;
};

const requireProjectGithubClient = () => {
  if (!projectGithubClient) throw new Error("Briar API URL이 설정되지 않았습니다.");
  return projectGithubClient;
};

export async function loadProjectMergeActivity(
  token: string,
  projectId: string,
  signal: AbortSignal,
): Promise<ProjectMergeActivity> {
  const response = await requireProjectGithubClient().getProjectMergeActivity(
    { projectId }, appCallOptions(token, signal),
  );
  return {
    repository: response.repository,
    generatedAt: requiredTimestamp(response.generatedAt, "mergeActivity.generatedAt"),
    pullRequests: response.pullRequests.map((pr) => ({
      number: Number(pr.number),
      title: pr.title,
      url: pr.url,
      mergedAt: requiredTimestamp(pr.mergedAt, "mergeActivity.mergedAt"),
    })),
  };
}

export async function loadGithubIntegration(
  token: string,
  organizationId: string,
) {
  return githubIntegrationFromProto(
    await requireIntegrationClient().getGitHubIntegration(
      { organizationId },
      appCallOptions(token),
    ),
  );
}

export async function createGithubInstallUrl(
  token: string,
  organizationId: string,
) {
  const response = await requireIntegrationClient().beginGitHubInstallation(
    { organizationId },
    appCallOptions(token),
  );
  return { installUrl: response.installUrl };
}

export async function createProjectGithubCredential(
  token: string,
  projectId: string,
) {
  return projectGithubCredentialFromProto(requiredMessage(
    (await requireProjectGithubClient().createProjectGitHubCredential(
      { projectId },
      appCallOptions(token),
    )).credential,
    "createProjectGitHubCredential.credential",
  ));
}

export type {
  GithubIntegration,
  GithubIntegrationRepository,
  ProjectGithubCredential,
} from "./github-mappers";
