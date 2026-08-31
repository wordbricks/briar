import { create } from "@bufbuild/protobuf";
import { type HandlerContext } from "@connectrpc/connect";
import {
  BindManagedComputerSetupRequestSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./http-response";
import type { requireWorkerCredential } from "./worker-route-auth";
import {
  createManagedComputerSetupService,
  type ManagedComputerSetupServices,
} from "./worker-connect-managed-computer-setup";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";

const managedComputerId = "11111111-1111-4111-8111-111111111111";
const setupToken = `briar_setup_${"a".repeat(43)}`;
const principal = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  deviceId: `managed-${managedComputerId}`,
} as Awaited<ReturnType<typeof requireWorkerCredential>>;

describe("ManagedComputerSetupService validation", () => {
  it("maps unknown generated runtime enums to InvalidArgument without caching", async () => {
    const bindSetup = vi.fn<ManagedComputerSetupServices["bindSetup"]>();
    const services = {
      bindSetup,
      getSetupContext: vi.fn<ManagedComputerSetupServices["getSetupContext"]>(),
      requireWorkerCredential: vi.fn(async () => principal),
    };
    const service = createManagedComputerSetupService({
      request: new Request("https://briar.example"),
      db: {} as D1Database,
      env: {} as Env,
    }, services);
    const context = {
      responseHeader: new Headers(),
    } as HandlerContext;
    const runtime = workerRuntimeFixture();
    runtime.agentProvider = 999 as AgentProvider;
    const request = create(BindManagedComputerSetupRequestSchema, {
      managedComputerId,
      setupToken,
      runtime,
    });

    const error = await Promise.resolve(
      service.bindManagedComputerSetup(request, context),
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect(context.responseHeader.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(bindSetup).not.toHaveBeenCalled();
  });
});
