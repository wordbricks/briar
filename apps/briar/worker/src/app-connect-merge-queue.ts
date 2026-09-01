import { create } from "@bufbuild/protobuf";
import {
  GetMergeQueueProfileResponseSchema,
  MergeQueueService,
  UpdateMergeQueueProfileResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/merge_queue_pb";
import { Code, ConnectError, type ConnectRouter, type ServiceImpl } from "@connectrpc/connect";
import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";

import { appMergeQueueProfile, appMergeQueueStatus } from "./app-connect-merge-queue-mappers";
import { HttpError } from "./http-response";
import {
  getMergeQueueProfileApplication,
  getMergeQueueStatusApplication,
  MergeQueueApplicationError,
  mergeQueueApplicationServices,
  type MergeQueueApplicationServices,
  updateMergeQueueProfileApplication,
} from "./merge-queue-application";
import { decodeRequestSync } from "./request-schema";
import { WorkflowStageId } from "./run-request-contract";
import { integerBetween, UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectMergeQueueInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

const decodeUuid = decodeRequestSync(UuidString);
const decodeWorkflowStageId = decodeRequestSync(WorkflowStageId);
const decodeMaxBatchSize = decodeRequestSync(integerBetween(2, 5));
const decodeDurationSeconds = decodeRequestSync(
  Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
);
const decodeDurationNanos = decodeRequestSync(integerBetween(0, 999_999_999));

const quietWindowMs = (
  duration: { readonly seconds: bigint; readonly nanos: number } | undefined,
) => {
  if (duration === undefined) return undefined;
  const seconds = decodeDurationSeconds(duration.seconds);
  const nanos = decodeDurationNanos(duration.nanos);
  if (nanos % 1_000_000 !== 0) {
    throw new ConnectError("Quiet window must use whole milliseconds", Code.InvalidArgument);
  }
  const milliseconds = seconds * 1_000n + BigInt(nanos / 1_000_000);
  if (milliseconds < 1_000n || milliseconds > 300_000n) {
    throw new ConnectError("Quiet window must be between 1 and 300 seconds", Code.InvalidArgument);
  }
  return Number(milliseconds);
};

const throwApplicationError = (error: unknown): never => {
  if (!(error instanceof MergeQueueApplicationError)) throw error;
  switch (error.reason) {
    case "project_not_found":
      throw new HttpError(404, error.message);
    case "development_management_required":
      throw new HttpError(403, error.message);
    case "readiness_stage_required":
      throw new HttpError(400, error.message);
    case "active_batch":
    case "github_app_not_connected":
    case "github_repository_not_installed":
    case "lane_owned":
    case "repository_not_configured":
    case "validation_commands_required":
    case "workflow_boundary_conflict":
      throw new HttpError(409, error.message);
  }
};

const withApplicationErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    return throwApplicationError(error);
  }
};

export const createAppMergeQueueService = (
  { request, auth, db }: AppConnectMergeQueueInput,
  services: MergeQueueApplicationServices = mergeQueueApplicationServices,
): ServiceImpl<typeof MergeQueueService> => ({
  getMergeQueueProfile: async (input) => {
    const session = await requireSession(auth, request);
    const profile = await withApplicationErrors(
      getMergeQueueProfileApplication(
        {
          db,
          projectId: decodeUuid(input.projectId).toLowerCase(),
          userId: session.user.id,
        },
        services,
      ),
    );
    return create(GetMergeQueueProfileResponseSchema, {
      profile: profile ? appMergeQueueProfile(profile) : undefined,
    });
  },

  updateMergeQueueProfile: async (input) => {
    const session = await requireSession(auth, request);
    const profile = await withApplicationErrors(
      updateMergeQueueProfileApplication(
        {
          command: {
            enabled: input.enabled,
            maxBatchSize:
              input.maxBatchSize === undefined
                ? undefined
                : decodeMaxBatchSize(input.maxBatchSize),
            quietWindowMs: quietWindowMs(input.quietWindow),
            readinessStageId:
              input.readinessStageId === undefined
                ? undefined
                : decodeWorkflowStageId(input.readinessStageId),
          },
          db,
          observedAt: new Date().toISOString(),
          projectId: decodeUuid(input.projectId).toLowerCase(),
          userId: session.user.id,
        },
        services,
      ),
    );
    return create(UpdateMergeQueueProfileResponseSchema, {
      profile: appMergeQueueProfile(profile),
    });
  },

  getMergeQueueStatus: async (input) => {
    const session = await requireSession(auth, request);
    const status = await withApplicationErrors(
      getMergeQueueStatusApplication(
        {
          db,
          generatedAt: new Date().toISOString(),
          projectId: decodeUuid(input.projectId).toLowerCase(),
          userId: session.user.id,
        },
        services,
      ),
    );
    return appMergeQueueStatus(status);
  },
});

export const registerAppMergeQueueService = (
  router: ConnectRouter,
  input: AppConnectMergeQueueInput,
  services?: MergeQueueApplicationServices,
) => router.service(MergeQueueService, createAppMergeQueueService(input, services));
