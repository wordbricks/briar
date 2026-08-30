import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createConnectRouter,
} from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import {
  ProjectService,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/project_pb";
import {
  ProjectRole,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/common_pb";
import type { BriarAuth } from "./auth";
import { withCorsHeaders, HttpError } from "./http-response";
import { projectJson } from "./project-json";
import { listProjects } from "./project-repository";
import { requireSession } from "./session-auth";

export type MobileConnectRouteInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

export type MobileConnectServices = {
  readonly requireSession: typeof requireSession;
  readonly listProjects: typeof listProjects;
};

const mobileConnectServices: MobileConnectServices = {
  requireSession,
  listProjects,
};

const projectRole = {
  owner: ProjectRole.OWNER,
  "co-owner": ProjectRole.CO_OWNER,
  developer: ProjectRole.DEVELOPER,
  editor: ProjectRole.EDITOR,
  viewer: ProjectRole.VIEWER,
} as const satisfies Record<
  ReturnType<typeof projectJson>["role"],
  ProjectRole
>;

const connectCodeFromHttpStatus = (status: number): Code => {
  switch (status) {
    case 400:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
      return Code.FailedPrecondition;
    case 413:
    case 429:
      return Code.ResourceExhausted;
    case 501:
      return Code.Unimplemented;
    case 503:
      return Code.Unavailable;
    default:
      return Code.Internal;
  }
};

const toConnectError = (error: unknown): ConnectError => {
  if (error instanceof ConnectError) return error;
  if (error instanceof HttpError) {
    return new ConnectError(
      error.message,
      connectCodeFromHttpStatus(error.status),
      undefined,
      undefined,
      error,
    );
  }
  return new ConnectError(
    "Internal server error",
    Code.Internal,
    undefined,
    undefined,
    error,
  );
};

const createProjectService = (
  { request, auth, db }: MobileConnectRouteInput,
  services: MobileConnectServices,
) => ({
  listProjects: async () => {
    try {
      const session = await services.requireSession(auth, request);
      const rows = await services.listProjects(db, session.user.id);
      return {
        projects: rows.map((row) => {
          const project = projectJson(row);
          const createdAt = new Date(project.createdAt);
          if (Number.isNaN(createdAt.getTime())) {
            throw new ConnectError(
              "Project has an invalid creation timestamp",
              Code.Internal,
            );
          }
          return {
            id: project.id,
            name: project.name,
            issueKeyPrefix: project.issueKeyPrefix,
            scheduleTabEnabled: project.scheduleTabEnabled,
            icon: project.icon ?? undefined,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            role: projectRole[project.role],
            createdAt: timestampFromDate(createdAt),
          };
        }),
      };
    } catch (error) {
      throw toConnectError(error);
    }
  },
});

/** Serve a generated Connect RPC when the request targets a registered method. */
export async function handleMobileConnectRequest(
  input: MobileConnectRouteInput,
  services: MobileConnectServices = mobileConnectServices,
): Promise<Response | undefined> {
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
  });
  router.service(ProjectService, createProjectService(input, services));

  const pathname = new URL(input.request.url).pathname;
  const handler = router.handlers.find(
    (candidate) => candidate.requestPath === pathname,
  );
  if (!handler) return undefined;

  const response = await createFetchHandler(handler)(input.request);
  return withCorsHeaders(response);
}
