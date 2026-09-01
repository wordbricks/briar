import {
  GitHubCommitStatusState,
  GitHubIntegrationService,
  GitHubMergeMethod,
  GitHubPullRequestState,
  ProjectGitHubService,
} from "@briar/contracts/gen/briar/app/v1/github_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import type { BriarAuth } from "./auth";

import {
  appBeginGithubInstallation,
  appCreateGithubCommitStatus,
  appCreateGithubPullRequest,
  appGetGithubPullRequest,
  appGithubIntegration,
  appMergeGithubPullRequest,
  appProjectGithubCredential,
  appProjectGithubRepository,
  appUpdateGithubPullRequest,
} from "./app-connect-github-mappers";
import {
  beginGithubInstallationApplication,
  getGithubIntegrationApplication,
} from "./github-integration-application";
import { HttpError } from "./http-response";
import {
  createProjectGithubCommitStatusApplication,
  createProjectGithubCredentialApplication,
  createProjectGithubPullRequestApplication,
  getProjectGithubPullRequestApplication,
  getProjectGithubRepositoryApplication,
  mergeProjectGithubPullRequestApplication,
  requireProjectGithubAccess,
  updateProjectGithubPullRequestApplication,
} from "./project-github-application";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import {
  scheduleInboxRealtimeFlush,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";

export type AppConnectGithubInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectGithubServices = {
  readonly beginInstallation: typeof beginGithubInstallationApplication;
  readonly createCommitStatus:
    typeof createProjectGithubCommitStatusApplication;
  readonly createCredential: typeof createProjectGithubCredentialApplication;
  readonly createPullRequest:
    typeof createProjectGithubPullRequestApplication;
  readonly getIntegration: typeof getGithubIntegrationApplication;
  readonly getPullRequest: typeof getProjectGithubPullRequestApplication;
  readonly getRepository: typeof getProjectGithubRepositoryApplication;
  readonly mergePullRequest: typeof mergeProjectGithubPullRequestApplication;
  readonly requireProjectAccess: typeof requireProjectGithubAccess;
  readonly requireSession: typeof requireSession;
  readonly updatePullRequest:
    typeof updateProjectGithubPullRequestApplication;
};

export const appConnectGithubServices: AppConnectGithubServices = {
  beginInstallation: beginGithubInstallationApplication,
  createCommitStatus: createProjectGithubCommitStatusApplication,
  createCredential: createProjectGithubCredentialApplication,
  createPullRequest: createProjectGithubPullRequestApplication,
  getIntegration: getGithubIntegrationApplication,
  getPullRequest: getProjectGithubPullRequestApplication,
  getRepository: getProjectGithubRepositoryApplication,
  mergePullRequest: mergeProjectGithubPullRequestApplication,
  requireProjectAccess: requireProjectGithubAccess,
  requireSession,
  updatePullRequest: updateProjectGithubPullRequestApplication,
};

const decodeUuid = decodeRequestSync(UuidString);

const positiveSafeNumber = (value: bigint, field: string) => {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ConnectError(
      `${field} must be a positive safe integer`,
      Code.InvalidArgument,
    );
  }
  return Number(value);
};

const updateState = (state: GitHubPullRequestState | undefined) => {
  switch (state) {
    case undefined:
      return undefined;
    case GitHubPullRequestState.OPEN:
      return "open" as const;
    case GitHubPullRequestState.CLOSED:
      return "closed" as const;
    case GitHubPullRequestState.UNSPECIFIED:
      throw new ConnectError(
        "Pull request state is required when present",
        Code.InvalidArgument,
      );
    case GitHubPullRequestState.MERGED:
      throw new ConnectError(
        "Merged is an observed state and cannot be requested",
        Code.InvalidArgument,
      );
    default:
      throw new ConnectError(
        `Unknown pull request state: ${state}`,
        Code.InvalidArgument,
      );
  }
};

const mergeMethod = (method: GitHubMergeMethod) => {
  switch (method) {
    case GitHubMergeMethod.MERGE:
      return "merge" as const;
    case GitHubMergeMethod.SQUASH:
      return "squash" as const;
    case GitHubMergeMethod.REBASE:
      return "rebase" as const;
    case GitHubMergeMethod.UNSPECIFIED:
      throw new ConnectError("Merge method is required", Code.InvalidArgument);
    default:
      throw new ConnectError(
        `Unknown merge method: ${method}`,
        Code.InvalidArgument,
      );
  }
};

const commitStatusState = (state: GitHubCommitStatusState) => {
  switch (state) {
    case GitHubCommitStatusState.ERROR:
      return "error" as const;
    case GitHubCommitStatusState.FAILURE:
      return "failure" as const;
    case GitHubCommitStatusState.PENDING:
      return "pending" as const;
    case GitHubCommitStatusState.SUCCESS:
      return "success" as const;
    case GitHubCommitStatusState.UNSPECIFIED:
      throw new ConnectError(
        "Commit status state is required",
        Code.InvalidArgument,
      );
    default:
      throw new ConnectError(
        `Unknown commit status state: ${state}`,
        Code.InvalidArgument,
      );
  }
};

const projectAccess = async (
  input: AppConnectGithubInput,
  services: AppConnectGithubServices,
  projectId: string,
) => {
  const canonicalProjectId = decodeUuid(projectId).toLowerCase();
  const project = await services.requireProjectAccess({
    auth: input.auth,
    db: input.db,
    request: input.request,
    projectId: canonicalProjectId,
  });
  return { canonicalProjectId, project };
};

const preventAuthenticatedResponseCaching = (headers: Headers) => {
  headers.set("Cache-Control", "private, no-store");
};

const withGithubProviderErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    if (
      !(error instanceof HttpError) ||
      error.code !== "GITHUB_APP_OPERATION_FAILED"
    ) {
      throw error;
    }
    if (error.status === 429) {
      throw new ConnectError(error.message, Code.ResourceExhausted);
    }
    if (error.status === 404) {
      throw new ConnectError(error.message, Code.NotFound);
    }
    if (error.status === 400) {
      throw new ConnectError(error.message, Code.InvalidArgument);
    }
    if (error.status === 401 || error.status === 403 || error.status >= 500) {
      throw new ConnectError(error.message, Code.Unavailable);
    }
    if (error.status >= 400 && error.status < 500) {
      throw new ConnectError(error.message, Code.FailedPrecondition);
    }
    throw new ConnectError("GitHub operation failed", Code.Internal);
  }
};

export const createAppGithubIntegrationService = (
  input: AppConnectGithubInput,
  services: AppConnectGithubServices = appConnectGithubServices,
): ServiceImpl<typeof GitHubIntegrationService> => ({
  getGitHubIntegration: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const session = await services.requireSession(input.auth, input.request);
    return appGithubIntegration(await services.getIntegration({
      db: input.db,
      env: input.env,
      organizationId: decodeUuid(request.organizationId).toLowerCase(),
      userId: session.user.id,
    }));
  },

  beginGitHubInstallation: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const session = await services.requireSession(input.auth, input.request);
    const result = await services.beginInstallation({
      db: input.db,
      env: input.env,
      organizationId: decodeUuid(request.organizationId).toLowerCase(),
      userId: session.user.id,
    });
    scheduleInboxRealtimeFlush(input.env, input.db, input.context);
    return appBeginGithubInstallation(result);
  },
});

export const createAppProjectGithubService = (
  input: AppConnectGithubInput,
  services: AppConnectGithubServices = appConnectGithubServices,
): ServiceImpl<typeof ProjectGitHubService> => ({
  createProjectGitHubCredential: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const { project } = await projectAccess(input, services, request.projectId);
    const result = await withGithubProviderErrors(
      services.createCredential({
        db: input.db,
        env: input.env,
        project,
      }),
    );
    scheduleProjectRealtimePublish(
      input.env,
      input.db,
      project.id,
      input.context,
    );
    return appProjectGithubCredential(result);
  },

  getProjectGitHubRepository: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const { project } = await projectAccess(input, services, request.projectId);
    return appProjectGithubRepository(await withGithubProviderErrors(
      services.getRepository({
        db: input.db,
        env: input.env,
        project,
      }),
    ));
  },

  createGitHubPullRequest: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const { project } = await projectAccess(input, services, request.projectId);
    const result = await withGithubProviderErrors(
      services.createPullRequest({
        db: input.db,
        env: input.env,
        project,
        request: {
          title: request.title,
          head: request.head,
          base: request.base,
          body: request.body,
          draft: request.draft,
        },
      }),
    );
    scheduleProjectRealtimePublish(
      input.env,
      input.db,
      project.id,
      input.context,
    );
    return appCreateGithubPullRequest(result);
  },

  getGitHubPullRequest: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const { project } = await projectAccess(input, services, request.projectId);
    return appGetGithubPullRequest(await withGithubProviderErrors(
      services.getPullRequest({
        db: input.db,
        env: input.env,
        project,
        pullRequestNumber: positiveSafeNumber(
          request.pullRequestNumber,
          "Pull request number",
        ),
      }),
    ));
  },

  updateGitHubPullRequest: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const { project } = await projectAccess(input, services, request.projectId);
    const result = await withGithubProviderErrors(
      services.updatePullRequest({
        db: input.db,
        env: input.env,
        project,
        pullRequestNumber: positiveSafeNumber(
          request.pullRequestNumber,
          "Pull request number",
        ),
        request: {
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.body === undefined ? {} : { body: request.body }),
          ...(request.base === undefined ? {} : { base: request.base }),
          ...(request.state === undefined
            ? {}
            : { state: updateState(request.state) }),
        },
      }),
    );
    scheduleProjectRealtimePublish(
      input.env,
      input.db,
      project.id,
      input.context,
    );
    return appUpdateGithubPullRequest(result);
  },

  mergeGitHubPullRequest: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const { project } = await projectAccess(input, services, request.projectId);
    const result = await withGithubProviderErrors(
      services.mergePullRequest({
        db: input.db,
        env: input.env,
        project,
        pullRequestNumber: positiveSafeNumber(
          request.pullRequestNumber,
          "Pull request number",
        ),
        request: {
          mergeMethod: mergeMethod(request.mergeMethod),
          ...(request.expectedHeadSha === undefined
            ? {}
            : { expectedHeadSha: request.expectedHeadSha }),
        },
      }),
    );
    scheduleProjectRealtimePublish(
      input.env,
      input.db,
      project.id,
      input.context,
    );
    return appMergeGithubPullRequest(result);
  },

  createGitHubCommitStatus: async (request, context) => {
    preventAuthenticatedResponseCaching(context.responseHeader);
    const { project } = await projectAccess(input, services, request.projectId);
    await withGithubProviderErrors(services.createCommitStatus({
      db: input.db,
      env: input.env,
      project,
      request: {
        sha: request.sha,
        state: commitStatusState(request.state),
        context: request.context,
        ...(request.description === undefined
          ? {}
          : { description: request.description }),
        ...(request.targetUrl === undefined
          ? {}
          : { targetUrl: request.targetUrl }),
      },
    }));
    scheduleProjectRealtimePublish(
      input.env,
      input.db,
      project.id,
      input.context,
    );
    return appCreateGithubCommitStatus();
  },
});

export function registerAppGithubServices(
  router: ConnectRouter,
  input: AppConnectGithubInput,
  services: AppConnectGithubServices = appConnectGithubServices,
) {
  router.service(
    GitHubIntegrationService,
    createAppGithubIntegrationService(input, services),
  );
  router.service(
    ProjectGitHubService,
    createAppProjectGithubService(input, services),
  );
}
