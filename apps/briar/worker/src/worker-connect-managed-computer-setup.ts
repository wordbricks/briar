import { create } from "@bufbuild/protobuf";
import {
  ManagedComputerSetupSessionSchema,
  ManagedComputerSetupSessionStatus,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import {
  ManagedComputerSetupService,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";

import { isManagedComputerSetupToken } from "../../src/lib/managed-computer-setup-codec";
import { appFleetTimestamp } from "./app-connect-fleet-mappers";
import { appProjectGithubCredentialMessage } from "./app-connect-github-mappers";
import { appDashboardWorker, appProjectSettings } from "./app-connect-mappers";
import { HttpError } from "./http-response";
import {
  bindManagedComputerSetupApplication,
  getManagedComputerSetupContextApplication,
} from "./managed-computer-setup-application";
import { ManagedComputerServiceError } from "./managed-computer-service";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { workerJson } from "./worker-json";
import { requireWorkerCredential } from "./worker-route-auth";
import {
  workerRuntimeMetadataFromProto,
  WorkerRuntimeValidationError,
} from "./worker-runtime-mappers";

export type WorkerConnectManagedComputerSetupInput = {
  readonly request: Request;
  readonly db: D1Database;
  readonly env: Env;
};

export type ManagedComputerSetupServices = {
  readonly bindSetup: typeof bindManagedComputerSetupApplication;
  readonly getSetupContext: typeof getManagedComputerSetupContextApplication;
  readonly requireWorkerCredential: typeof requireWorkerCredential;
};

export const managedComputerSetupServices: ManagedComputerSetupServices = {
  bindSetup: bindManagedComputerSetupApplication,
  getSetupContext: getManagedComputerSetupContextApplication,
  requireWorkerCredential,
};

const decodeUuid = decodeRequestSync(UuidString);
const setupToken = (value: string) => {
  if (!isManagedComputerSetupToken(value)) {
    throw new HttpError(400, "Managed computer setup token is invalid");
  }
  return value;
};

const withManagedComputerSetupErrors = async <A>(
  operation: () => Promise<A>,
) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkerRuntimeValidationError) {
      throw new HttpError(400, error.message);
    }
    if (error instanceof ManagedComputerServiceError) {
      throw new HttpError(error.status, error.message, error.code);
    }
    throw error;
  }
};

export const createManagedComputerSetupService = (
  { request, db, env }: WorkerConnectManagedComputerSetupInput,
  services: ManagedComputerSetupServices = managedComputerSetupServices,
): ServiceImpl<typeof ManagedComputerSetupService> => ({
  getManagedComputerSetupContext: async (input, context) => {
    context.responseHeader.set("Cache-Control", "private, no-store");
    const principal = await services.requireWorkerCredential(db, request);
    const managedComputerId = decodeUuid(input.managedComputerId);
    const result = await withManagedComputerSetupErrors(
      () => services.getSetupContext({
        db,
        env,
        principal,
        managedComputerId,
        setupToken: setupToken(input.setupToken),
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      session: create(ManagedComputerSetupSessionSchema, {
        id: result.session.id,
        managedComputerId,
        organizationId: principal.organizationId,
        projectId: result.session.projectId,
        status: ManagedComputerSetupSessionStatus.PENDING,
        expiresAt: appFleetTimestamp(result.session.expiresAt),
      }),
      project: result.project,
      settings: appProjectSettings(result.settings),
      repositoryCredential: result.repositoryCredential
        ? appProjectGithubCredentialMessage(result.repositoryCredential)
        : undefined,
    };
  },

  bindManagedComputerSetup: async (input, context) => {
    context.responseHeader.set("Cache-Control", "private, no-store");
    const principal = await services.requireWorkerCredential(db, request);
    const observedAt = new Date().toISOString();
    const managedComputerId = decodeUuid(input.managedComputerId);
    const result = await withManagedComputerSetupErrors(
      () => services.bindSetup({
        db,
        principal,
        managedComputerId,
        setupToken: setupToken(input.setupToken),
        runtime: workerRuntimeMetadataFromProto(input.runtime),
        observedAt,
      }),
    );
    return {
      managedComputerId,
      organizationId: principal.organizationId,
      projectId: result.session.project_id,
      deviceId: principal.deviceId,
      worker: appDashboardWorker(workerJson(result.worker, observedAt)),
      duplicate: result.duplicate,
    };
  },
});

export const registerManagedComputerSetupService = (
  router: ConnectRouter,
  input: WorkerConnectManagedComputerSetupInput,
) => router.service(
  ManagedComputerSetupService,
  createManagedComputerSetupService(input),
);
