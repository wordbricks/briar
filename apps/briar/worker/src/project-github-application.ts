import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import {
  createGithubInstallationToken,
  createProjectGithubCommitStatus,
  createProjectGithubPullRequest,
  getProjectGithubPullRequest,
  getProjectGithubRepository,
  GithubAppApiError,
  mergeProjectGithubPullRequest,
  type ProjectGithubIdentity,
  updateProjectGithubPullRequest,
} from "./github-app-api";
import {
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
} from "./github-connection-repository";
import { HttpError } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { getProject } from "./project-command-repository";
import { getProjectSettings } from "./project-settings-repository";
import { decodeRequestSync } from "./request-schema";
import {
  defaulted,
  strictSchema,
  trimmedText,
  UrlString,
} from "./schema-codecs";
import {
  requireAgentProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";

const GitRef = Schema.Trim.check(
  Schema.isLengthBetween(1, 255),
  Schema.isPattern(
    /^(?![./])(?!.*\.\.)(?!.*(?:\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]+$/u,
  ),
);

const PullRequestCreate = strictSchema(Schema.Struct({
  title: trimmedText(1, 256),
  head: GitRef,
  base: GitRef,
  body: Schema.String.check(Schema.isMaxLength(65_536)),
  draft: defaulted(Schema.Boolean, false),
}));

const PullRequestUpdate = strictSchema(Schema.Struct({
  title: Schema.optional(trimmedText(1, 256)),
  body: Schema.optional(Schema.String.check(Schema.isMaxLength(65_536))),
  base: Schema.optional(GitRef),
  state: Schema.optional(Schema.Literals(["open", "closed"])),
}).check(
  Schema.makeFilter((input) =>
    Object.values(input).every((value) => value === undefined)
      ? "At least one pull request field is required"
      : undefined
  ),
));

const PullRequestMerge = strictSchema(Schema.Struct({
  mergeMethod: Schema.Literals(["merge", "squash", "rebase"]),
  expectedHeadSha: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{40,64}$/u)),
  ),
}));

const CommitStatus = strictSchema(Schema.Struct({
  sha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40,64}$/u)),
  state: Schema.Literals(["error", "failure", "pending", "success"]),
  context: trimmedText(1, 100),
  description: Schema.optional(trimmedText(1, 140)),
  targetUrl: Schema.optional(UrlString),
}));

const decodePullRequestCreate = decodeRequestSync(PullRequestCreate);
const decodePullRequestUpdate = decodeRequestSync(PullRequestUpdate);
const decodePullRequestMerge = decodeRequestSync(PullRequestMerge);
const decodeCommitStatus = decodeRequestSync(CommitStatus);

export type ProjectGithubAccess = {
  readonly id: string;
  readonly organization_id: string;
};

export async function requireProjectGithubAccess(input: {
  auth: BriarAuth;
  db: D1Database;
  request: Request;
  projectId: string;
}): Promise<ProjectGithubAccess> {
  const session = await input.auth.api.getSession({
    headers: input.request.headers,
  });
  if (session?.user) {
    const project = await getProject(
      input.db,
      input.projectId,
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:execute")) {
      throw new HttpError(403, "Issue execution permission required");
    }
    return project;
  }

  const authorization = input.request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer briar_worker_")) {
    await requireWorkerProjectBinding(
      input.db,
      input.request,
      input.projectId,
    );
  } else if (authorization.startsWith("Bearer briar_agent_")) {
    const projectId = await requireAgentProject(input.db, input.request);
    if (projectId !== input.projectId) {
      throw new HttpError(403, "Agent is not enabled for this project");
    }
  } else {
    throw new HttpError(401, "Unauthorized");
  }
  const project = await input.db
    .prepare(`select id, organization_id from briar_projects where id = ?`)
    .bind(input.projectId)
    .first<ProjectGithubAccess>();
  if (!project) throw new HttpError(404, "Project not found");
  return project;
}

export async function projectGithubIdentity(
  db: D1Database,
  project: ProjectGithubAccess,
): Promise<ProjectGithubIdentity> {
  const [settings, connection] = await Promise.all([
    getProjectSettings(db, project.id),
    getGithubConnectionForOrganization(db, project.organization_id),
  ]);
  if (!settings?.github_repository || settings.github_repository_id === null) {
    throw new HttpError(409, "Connect a GitHub repository to this project");
  }
  if (!connection) {
    throw new HttpError(409, "Connect the organization GitHub App first");
  }
  const repositories = await listGithubConnectionRepositories(
    db,
    connection.installation_id,
  );
  const repository = repositories.find((candidate) =>
    candidate.repository_id === settings.github_repository_id &&
    candidate.full_name.toLowerCase() === settings.github_repository!.toLowerCase()
  );
  if (!repository) {
    throw new HttpError(
      409,
      "The project repository is not included in the GitHub App installation",
      "GITHUB_REPOSITORY_IDENTITY_MISMATCH",
    );
  }
  return {
    installationId: connection.installation_id,
    repositoryId: repository.repository_id,
    repository: repository.full_name,
  };
}

export const githubAppApiOperation = async <A>(operation: () => Promise<A>) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GithubAppApiError) {
      throw new HttpError(
        error.status >= 400 && error.status < 600 ? error.status : 502,
        error.message,
        "GITHUB_APP_OPERATION_FAILED",
      );
    }
    throw error;
  }
};

type ProjectGithubApplicationInput = {
  readonly db: D1Database;
  readonly env: Env;
  readonly project: ProjectGithubAccess;
};

export async function createProjectGithubCredentialApplication(
  input: ProjectGithubApplicationInput,
) {
  const identity = await projectGithubIdentity(input.db, input.project);
  const credential = await githubAppApiOperation(() =>
    createGithubInstallationToken(input.env, identity)
  );
  return {
    projectId: input.project.id,
    organizationId: input.project.organization_id,
    repositoryId: identity.repositoryId,
    repository: identity.repository,
    cloneUrl: `https://github.com/${identity.repository}.git`,
    username: "x-access-token" as const,
    password: credential.token,
    expiresAt: credential.expiresAt,
  };
}

export async function getProjectGithubRepositoryApplication(
  input: ProjectGithubApplicationInput,
) {
  const identity = await projectGithubIdentity(input.db, input.project);
  return githubAppApiOperation(() =>
    getProjectGithubRepository(input.env, identity)
  );
}

export async function createProjectGithubPullRequestApplication(
  input: ProjectGithubApplicationInput & { request: unknown },
) {
  const request = decodePullRequestCreate(input.request);
  const identity = await projectGithubIdentity(input.db, input.project);
  return githubAppApiOperation(() =>
    createProjectGithubPullRequest(input.env, identity, request)
  );
}

export async function getProjectGithubPullRequestApplication(
  input: ProjectGithubApplicationInput & { pullRequestNumber: number },
) {
  const identity = await projectGithubIdentity(input.db, input.project);
  return githubAppApiOperation(() =>
    getProjectGithubPullRequest(
      input.env,
      identity,
      input.pullRequestNumber,
    )
  );
}

export async function updateProjectGithubPullRequestApplication(
  input: ProjectGithubApplicationInput & {
    pullRequestNumber: number;
    request: unknown;
  },
) {
  const request = decodePullRequestUpdate(input.request);
  const identity = await projectGithubIdentity(input.db, input.project);
  return githubAppApiOperation(() =>
    updateProjectGithubPullRequest(
      input.env,
      identity,
      input.pullRequestNumber,
      request,
    )
  );
}

export async function mergeProjectGithubPullRequestApplication(
  input: ProjectGithubApplicationInput & {
    pullRequestNumber: number;
    request: unknown;
  },
) {
  const request = decodePullRequestMerge(input.request);
  const identity = await projectGithubIdentity(input.db, input.project);
  return githubAppApiOperation(() =>
    mergeProjectGithubPullRequest(
      input.env,
      identity,
      input.pullRequestNumber,
      request,
    )
  );
}

export async function createProjectGithubCommitStatusApplication(
  input: ProjectGithubApplicationInput & { request: unknown },
) {
  const request = decodeCommitStatus(input.request);
  const identity = await projectGithubIdentity(input.db, input.project);
  await githubAppApiOperation(() =>
    createProjectGithubCommitStatus(input.env, identity, request)
  );
  return { created: true as const };
}
