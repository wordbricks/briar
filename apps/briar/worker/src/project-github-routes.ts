import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import {
  createGithubInstallationToken,
  createProjectGithubCommitStatus,
  createProjectGithubPullRequest,
  getProjectGithubRepository,
  getProjectGithubPullRequest,
  GithubAppApiError,
  mergeProjectGithubPullRequest,
  projectGithubGraphql,
  type ProjectGithubIdentity,
  updateProjectGithubPullRequest,
} from "./github-app-api";
import {
  getGithubConnectionForOrganization,
  listGithubConnectionRepositories,
} from "./github-connection-repository";
import { HttpError, json, privateNoStoreJson } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { getProject } from "./project-command-repository";
import {
  bindProjectGithubRepositoryIdentity,
  getProjectSettings,
} from "./project-settings-repository";
import { readJson } from "./request-readers";
import { decodeRequestSync } from "./request-schema";
import {
  defaulted,
  PositiveSafeInteger,
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
  Schema.isPattern(/^(?![./])(?!.*\.\.)(?!.*(?:\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]+$/u),
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
}));

const PullRequestMerge = strictSchema(Schema.Struct({
  mergeMethod: defaulted(
    Schema.Literals(["merge", "squash", "rebase"]),
    "squash",
  ),
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

const GraphqlRequest = strictSchema(Schema.Struct({
  query: Schema.String.check(Schema.isLengthBetween(1, 50_000)),
  variables: Schema.Record(
    Schema.String,
    Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
  ),
}));

const decodePullRequestCreate = decodeRequestSync(PullRequestCreate);
const decodePullRequestUpdate = decodeRequestSync(PullRequestUpdate);
const decodePullRequestMerge = decodeRequestSync(PullRequestMerge);
const decodeCommitStatus = decodeRequestSync(CommitStatus);
const decodeGraphqlRequest = decodeRequestSync(GraphqlRequest);
const decodePullRequestNumber = Schema.decodeUnknownSync(PositiveSafeInteger);

async function requireProjectGithubAccess(input: {
  auth: BriarAuth;
  db: D1Database;
  request: Request;
  projectId: string;
}) {
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
    .first<{ id: string; organization_id: string }>();
  if (!project) throw new HttpError(404, "Project not found");
  return project;
}

export async function projectGithubIdentity(
  db: D1Database,
  project: { id: string; organization_id: string },
): Promise<ProjectGithubIdentity> {
  const [settings, connection] = await Promise.all([
    getProjectSettings(db, project.id),
    getGithubConnectionForOrganization(db, project.organization_id),
  ]);
  if (!settings?.github_repository) {
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
    settings.github_repository_id
      ? candidate.repository_id === settings.github_repository_id &&
        candidate.full_name.toLowerCase() ===
          settings.github_repository!.toLowerCase()
      : candidate.full_name.toLowerCase() ===
        settings.github_repository!.toLowerCase()
  );
  if (!repository) {
    throw new HttpError(
      409,
      "The project repository is not included in the GitHub App installation",
      "GITHUB_REPOSITORY_IDENTITY_MISMATCH",
    );
  }
  if (!settings.github_repository_id) {
    const bound = await bindProjectGithubRepositoryIdentity(db, project.id, {
      repositoryId: repository.repository_id,
      repository: repository.full_name,
    });
    if (!bound) {
      throw new HttpError(
        409,
        "The project repository changed while GitHub access was being prepared",
        "GITHUB_REPOSITORY_IDENTITY_CHANGED",
      );
    }
  }
  return {
    installationId: connection.installation_id,
    repositoryId: repository.repository_id,
    repository: repository.full_name,
  };
}

const githubError = (error: unknown): never => {
  if (error instanceof GithubAppApiError) {
    throw new HttpError(
      error.status >= 400 && error.status < 600 ? error.status : 502,
      error.message,
      "GITHUB_APP_OPERATION_FAILED",
    );
  }
  throw error;
};

export async function handleProjectGithubRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
}): Promise<Response | undefined> {
  const { request, url, auth, db, env } = input;
  const match = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/github\/(credentials|repository|graphql|pull-requests|statuses)(?:\/([1-9][0-9]*))?(?:\/(merge))?$/u,
  );
  if (!match) return undefined;
  const project = await requireProjectGithubAccess({
    auth,
    db,
    request,
    projectId: match[1],
  });
  const identity = await projectGithubIdentity(db, project);

  try {
    if (match[2] === "credentials" && request.method === "POST") {
      const credential = await createGithubInstallationToken(env, identity);
      return privateNoStoreJson({
        project: {
          id: project.id,
          organizationId: project.organization_id,
        },
        repository: {
          id: identity.repositoryId,
          fullName: identity.repository,
          cloneUrl: `https://github.com/${identity.repository}.git`,
        },
        username: "x-access-token",
        password: credential.token,
        expiresAt: credential.expiresAt,
      });
    }
    if (match[2] === "repository" && request.method === "GET") {
      return privateNoStoreJson({
        repository: await getProjectGithubRepository(env, identity),
      });
    }
    if (match[2] === "graphql" && request.method === "POST") {
      return privateNoStoreJson(await projectGithubGraphql(
        env,
        identity,
        decodeGraphqlRequest(await readJson(request)),
      ));
    }
    if (match[2] === "pull-requests" && !match[3] && request.method === "POST") {
      return json({ pullRequest: await createProjectGithubPullRequest(
        env,
        identity,
        decodePullRequestCreate(await readJson(request)),
      ) });
    }
    if (match[2] === "pull-requests" && match[3]) {
      const number = decodePullRequestNumber(Number(match[3]));
      if (request.method === "GET" && !match[4]) {
        return privateNoStoreJson({
          pullRequest: await getProjectGithubPullRequest(env, identity, number),
        });
      }
      if (request.method === "PATCH" && !match[4]) {
        return json({ pullRequest: await updateProjectGithubPullRequest(
          env,
          identity,
          number,
          decodePullRequestUpdate(await readJson(request)),
        ) });
      }
      if (request.method === "PUT" && match[4] === "merge") {
        return json({ merge: await mergeProjectGithubPullRequest(
          env,
          identity,
          number,
          decodePullRequestMerge(await readJson(request)),
        ) });
      }
    }
    if (match[2] === "statuses" && request.method === "POST") {
      await createProjectGithubCommitStatus(
        env,
        identity,
        decodeCommitStatus(await readJson(request)),
      );
      return json({ ok: true });
    }
  } catch (error) {
    return githubError(error);
  }
  throw new HttpError(405, "Method not allowed");
}
