import { createClient, createConnectRouter, ConnectError } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  ApplicationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import {
  ManagedComputerEnrollmentService,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { describe, expect, it, vi } from "vitest";
import { connectErrorInterceptor } from "./app-connect-errors";
import { ManagedComputerServiceError } from "./managed-computer-service";
import { requireConnectHandlerForRequest } from "./test-helpers/connect";
import {
  registerManagedComputerEnrollmentService,
  type ManagedComputerEnrollmentServices,
} from "./worker-connect-managed-computer-enrollment";

const managedComputerId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const nonce = "n".repeat(43);
const identitySignature = "a".repeat(64);

const enrollmentClient = (services: ManagedComputerEnrollmentServices) => {
  const transport = createConnectTransport({
    baseUrl: "https://api.example.test",
    useBinaryFormat: true,
    fetch: async (input, init) => {
      // Connect-ES deliberately requests `redirect: "error"`, while workerd's
      // Fetch implementation only accepts `follow` or `manual`. The in-memory
      // handler cannot redirect, so `manual` preserves the intended semantics.
      const request = new Request(input, { ...init, redirect: "manual" });
      const router = createConnectRouter({
        connect: true,
        grpc: false,
        grpcWeb: false,
        interceptors: [connectErrorInterceptor],
      });
      registerManagedComputerEnrollmentService(router, {
        db: {} as D1Database,
        env: {} as Env,
      }, services);
      return createFetchHandler(
        requireConnectHandlerForRequest(router.handlers, request),
      )(request);
    },
  });
  return createClient(ManagedComputerEnrollmentService, transport);
};

const request = {
  managedComputerId,
  nonce,
  identityDocument: "{}",
  identitySignature,
  briarVersion: "1.2.173",
};

describe("ManagedComputerEnrollmentService", () => {
  it("uses the generated request and response across the Connect boundary", async () => {
    const enroll = vi.fn<ManagedComputerEnrollmentServices["enroll"]>()
      .mockResolvedValue({
        credential: `briar_worker_${"c".repeat(43)}`,
        deviceId: `managed-${managedComputerId}`,
        organizationId,
      });

    const response = await enrollmentClient({ enroll })
      .enrollManagedComputer(request);

    expect(response).toMatchObject({
      managedComputerId,
      credential: `briar_worker_${"c".repeat(43)}`,
      deviceId: `managed-${managedComputerId}`,
      organizationId,
    });
    expect(enroll).toHaveBeenCalledOnce();
    expect(enroll.mock.calls[0]?.[2]).toMatchObject({
      ...request,
      observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    });
  });

  it("preserves the application error code as a generated detail", async () => {
    const enroll = vi.fn<ManagedComputerEnrollmentServices["enroll"]>()
      .mockRejectedValue(new ManagedComputerServiceError(
        409,
        "MANAGED_COMPUTER_SSM_NOT_READY",
        "Managed computer is not ready",
      ));

    const error = await enrollmentClient({ enroll })
      .enrollManagedComputer(request)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).findDetails(
      ApplicationErrorDetailSchema,
    )).toMatchObject([{
      code: "MANAGED_COMPUTER_SSM_NOT_READY",
    }]);
  });
});
