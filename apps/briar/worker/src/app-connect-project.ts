import { ProjectService } from "@briar/contracts/gen/briar/app/v1/project_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import { normalizeProjectAgentLocale } from "../../src/lib/project-agent";
import { processArchiveCleanupQueue } from "./archive";
import type { BriarAuth } from "./auth";
import { withConnectErrors } from "./app-connect-errors";
import { appProject } from "./app-connect-mappers";
import { HttpError } from "./http-response";
import {
  createProjectAgentTokenApplication,
  createProjectApplication,
  deleteProjectApplication,
  ProjectApplicationError,
  updateProjectIconApplication,
  updateProjectIssueKeyPrefixApplication,
  updateProjectTabsApplication,
} from "./project-application";
import { listProjects } from "./project-repository";
import { schedulePostCommitCleanup } from "./post-commit-cleanup";
import {
  scheduleInboxRealtimeFlush,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectProjectInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectProjectServices = {
  readonly createAgentToken: typeof createProjectAgentTokenApplication;
  readonly createProject: typeof createProjectApplication;
  readonly deleteProject: typeof deleteProjectApplication;
  readonly listProjects: typeof listProjects;
  readonly requireSession: typeof requireSession;
  readonly updateIcon: typeof updateProjectIconApplication;
  readonly updateIssueKeyPrefix: typeof updateProjectIssueKeyPrefixApplication;
  readonly updateTabs: typeof updateProjectTabsApplication;
};

export const appConnectProjectServices: AppConnectProjectServices = {
  createAgentToken: createProjectAgentTokenApplication,
  createProject: createProjectApplication,
  deleteProject: deleteProjectApplication,
  listProjects,
  requireSession,
  updateIcon: updateProjectIconApplication,
  updateIssueKeyPrefix: updateProjectIssueKeyPrefixApplication,
  updateTabs: updateProjectTabsApplication,
};

const decodeUuid = decodeRequestSync(UuidString);

const throwApplicationError = (error: unknown): never => {
  if (!(error instanceof ProjectApplicationError)) throw error;
  switch (error.reason) {
    case "project_not_found":
      throw new HttpError(404, error.message);
    case "development_management_required":
    case "project_management_required":
    case "repository_connection_permission_denied":
      throw new HttpError(403, error.message);
    case "transfer_reconciliation_required":
      throw new HttpError(
        409,
        error.message,
        "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
      );
  }
};

const withApplicationErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    return throwApplicationError(error);
  }
};

export const createAppProjectService = (
  { request, auth, db, env, context }: AppConnectProjectInput,
  services: AppConnectProjectServices = appConnectProjectServices,
): ServiceImpl<typeof ProjectService> => ({
  listProjects: async () =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const rows = await services.listProjects(db, session.user.id);
      return { projects: rows.map(appProject) };
    }),

  createProject: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const result = await withApplicationErrors(
        services.createProject({
          db,
          user: session.user,
          name: input.name,
          organizationId: input.organizationId,
          locale: normalizeProjectAgentLocale(
            request.headers.get("accept-language"),
          ),
        }),
      );
      scheduleInboxRealtimeFlush(env, db, context);
      return { project: appProject(result.project), agentToken: result.agentToken };
    }),

  deleteProject: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const result = await withApplicationErrors(
        services.deleteProject({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
        }),
      );
      void schedulePostCommitCleanup({
        context,
        operation: "project_delete",
        observedAt: result.observedAt,
        tasks: [{
          queue: "archive",
          run: () =>
            processArchiveCleanupQueue(
              db,
              env.ARCHIVES,
              env.ATTACHMENTS,
              result.observedAt,
              1_000,
            ),
        }],
      });
      scheduleProjectRealtimePublish(env, db, result.projectId, context);
      return { deleted: true };
    }),

  updateProjectIcon: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const icon = input.iconUpdate.case === "icon"
        ? input.iconUpdate.value
        : input.iconUpdate.case === "clearIcon"
        ? null
        : (() => {
          throw new ConnectError("icon update is required", Code.InvalidArgument);
        })();
      const project = await withApplicationErrors(
        services.updateIcon({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
          icon,
        }),
      );
      scheduleProjectRealtimePublish(env, db, project.id, context);
      return { project: appProject(project) };
    }),

  updateProjectIssueKeyPrefix: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const project = await withApplicationErrors(
        services.updateIssueKeyPrefix({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
          issueKeyPrefix: input.issueKeyPrefix,
        }),
      );
      scheduleProjectRealtimePublish(env, db, project.id, context);
      return { project: appProject(project) };
    }),

  updateProjectTabs: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const project = await withApplicationErrors(
        services.updateTabs({
          db,
          projectId: decodeUuid(input.projectId),
          userId: session.user.id,
          schedule: input.schedule,
        }),
      );
      scheduleProjectRealtimePublish(env, db, project.id, context);
      return { project: appProject(project) };
    }),

  createProjectAgentToken: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const projectId = decodeUuid(input.projectId);
      const agentToken = await withApplicationErrors(
        services.createAgentToken({
          db,
          projectId,
          userId: session.user.id,
        }),
      );
      scheduleProjectRealtimePublish(env, db, projectId, context);
      return { agentToken };
    }),
});

export const registerAppProjectService = (
  router: ConnectRouter,
  input: AppConnectProjectInput,
  services: AppConnectProjectServices = appConnectProjectServices,
) => {
  router.service(ProjectService, createAppProjectService(input, services));
};
