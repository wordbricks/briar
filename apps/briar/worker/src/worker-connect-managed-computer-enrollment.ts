import {
  ManagedComputerEnrollmentService,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { HttpError } from "./http-response";
import {
  decodeManagedComputerEnrollmentProof,
} from "./managed-computer-request-contract";
import {
  enrollManagedComputer,
  ManagedComputerServiceError,
} from "./managed-computer-service";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";

export type WorkerConnectManagedComputerEnrollmentInput = {
  readonly db: D1Database;
  readonly env: Env;
};

export type ManagedComputerEnrollmentServices = {
  readonly enroll: typeof enrollManagedComputer;
};

export const managedComputerEnrollmentServices: ManagedComputerEnrollmentServices = {
  enroll: enrollManagedComputer,
};

const decodeUuid = decodeRequestSync(UuidString);

const withManagedComputerEnrollmentErrors = async <A>(
  operation: () => Promise<A>,
) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ManagedComputerServiceError) {
      throw new HttpError(error.status, error.message, error.code);
    }
    throw error;
  }
};

export const createManagedComputerEnrollmentService = (
  { db, env }: WorkerConnectManagedComputerEnrollmentInput,
  services: ManagedComputerEnrollmentServices = managedComputerEnrollmentServices,
): ServiceImpl<typeof ManagedComputerEnrollmentService> => ({
  enrollManagedComputer: async (input, context) => {
    context.responseHeader.set("Cache-Control", "private, no-store");
    const managedComputerId = decodeUuid(input.managedComputerId);
    const proof = decodeManagedComputerEnrollmentProof({
      nonce: input.nonce,
      identityDocument: input.identityDocument,
      identitySignature: input.identitySignature,
      briarVersion: input.briarVersion,
    });
    const result = await withManagedComputerEnrollmentErrors(
      () => services.enroll(db, env, {
        managedComputerId,
        ...proof,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      managedComputerId,
      credential: result.credential,
      deviceId: result.deviceId,
      organizationId: result.organizationId,
    };
  },
});

export const registerManagedComputerEnrollmentService = (
  router: ConnectRouter,
  input: WorkerConnectManagedComputerEnrollmentInput,
  services: ManagedComputerEnrollmentServices = managedComputerEnrollmentServices,
) => router.service(
  ManagedComputerEnrollmentService,
  createManagedComputerEnrollmentService(input, services),
);
