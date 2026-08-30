import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  LinearImportService,
  type LinearStatusMapping,
} from "@briar/contracts/gen/briar/app/v1/linear_import_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import type { BriarAuth } from "./auth";
import { withConnectErrors } from "./app-connect-errors";
import {
  appLinearImportConnection,
  appLinearImportResult,
  appLinearImportStates,
} from "./app-connect-linear-import-mappers";
import { HttpError } from "./http-response";
import { LinearApiError } from "./linear";
import {
  connectLinearImportApplication,
  importLinearIssuesApplication,
  LinearImportApiKey,
  LinearImportApplicationError,
  linearImportApplicationServices,
  type LinearImportApplicationServices,
  LinearImportStatusMappings,
  LinearImportTeamIds,
  listLinearImportStatesApplication,
} from "./linear-import-application";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectLinearImportInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

export type AppConnectLinearImportServices = LinearImportApplicationServices & {
  readonly requireSession: typeof requireSession;
};

export const appConnectLinearImportServices: AppConnectLinearImportServices = {
  ...linearImportApplicationServices,
  requireSession,
};

const decodeUuid = decodeRequestSync(UuidString);
const decodeApiKey = decodeRequestSync(LinearImportApiKey);
const decodeTeamIds = decodeRequestSync(LinearImportTeamIds);
const decodeStatusMappings = decodeRequestSync(LinearImportStatusMappings);

const statusPlacement = (status: RunStatus) => {
  switch (status) {
    case RunStatus.BACKLOG: return "backlog" as const;
    case RunStatus.QUEUED: return "queued" as const;
    case RunStatus.RUNNING: return "running" as const;
    case RunStatus.BLOCKED: return "blocked" as const;
    case RunStatus.FAILED: return "failed" as const;
    case RunStatus.COMPLETED: return "completed" as const;
    case RunStatus.CANCELLED: return "cancelled" as const;
    case RunStatus.UNSPECIFIED:
      throw new ConnectError(
        "Linear status mapping is required",
        Code.InvalidArgument,
      );
    case RunStatus.PAUSED:
      throw new ConnectError(
        "Paused is not a persisted run status",
        Code.InvalidArgument,
      );
    default:
      throw new ConnectError("Unknown Linear status mapping", Code.InvalidArgument);
  }
};

const statusMapping = (mapping: LinearStatusMapping) => {
  switch (mapping.placement.case) {
    case "status":
      return {
        stateId: mapping.stateId,
        status: statusPlacement(mapping.placement.value),
        workflowStage: null,
      };
    case "workflowStageId":
      return {
        stateId: mapping.stateId,
        status: "running" as const,
        workflowStage: mapping.placement.value,
      };
    case undefined:
      throw new ConnectError(
        "Linear status mapping placement is required",
        Code.InvalidArgument,
      );
  }
};

const throwApplicationError = (error: unknown): never => {
  if (error instanceof LinearApiError) {
    if (error.status === 401 || error.status === 403) {
      throw new ConnectError(
        "Linear API key is invalid or unauthorized",
        Code.Unauthenticated,
      );
    }
    throw new ConnectError("Linear API is unavailable", Code.Unavailable);
  }
  if (!(error instanceof LinearImportApplicationError)) throw error;
  switch (error.reason) {
    case "project_not_found":
      throw new HttpError(404, error.message);
    case "development_management_required":
      throw new HttpError(403, error.message);
    case "invalid_status_mapping":
      throw new HttpError(400, error.message);
  }
};

const withApplicationErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    return throwApplicationError(error);
  }
};

export const createAppLinearImportService = (
  { request, auth, db }: AppConnectLinearImportInput,
  services: AppConnectLinearImportServices = appConnectLinearImportServices,
): ServiceImpl<typeof LinearImportService> => ({
  connectLinearImport: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const result = await withApplicationErrors(
        connectLinearImportApplication(
          {
            apiKey: decodeApiKey(input.apiKey),
            db,
            projectId: decodeUuid(input.projectId).toLowerCase(),
            userId: session.user.id,
          },
          services,
        ),
      );
      return appLinearImportConnection(result);
    }),

  listLinearImportStates: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const states = await withApplicationErrors(
        listLinearImportStatesApplication(
          {
            apiKey: decodeApiKey(input.apiKey),
            db,
            projectId: decodeUuid(input.projectId).toLowerCase(),
            teamIds: decodeTeamIds(input.teamIds),
            userId: session.user.id,
          },
          services,
        ),
      );
      return appLinearImportStates(states);
    }),

  importLinearIssues: (input) =>
    withConnectErrors(async () => {
      const session = await services.requireSession(auth, request);
      const result = await withApplicationErrors(
        importLinearIssuesApplication(
          {
            apiKey: decodeApiKey(input.apiKey),
            db,
            projectId: decodeUuid(input.projectId).toLowerCase(),
            statusMappings: decodeStatusMappings(
              input.statusMappings.map(statusMapping),
            ),
            teamIds: decodeTeamIds(input.teamIds),
            userId: session.user.id,
          },
          services,
        ),
      );
      return appLinearImportResult(result);
    }),
});

export const registerAppLinearImportService = (
  router: ConnectRouter,
  input: AppConnectLinearImportInput,
  services?: AppConnectLinearImportServices,
) => router.service(
  LinearImportService,
  createAppLinearImportService(input, services),
);
