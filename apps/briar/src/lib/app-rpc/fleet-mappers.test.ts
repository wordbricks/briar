import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  DashboardWorker_Readiness,
  DashboardWorker_State,
  DashboardWorkerSchema,
  WorkerIcon_Kind,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  CreateManagedComputerSetupSessionResponseSchema,
  GetManagedComputerProductResponseSchema,
  GetManagedComputerSetupStatusResponseSchema,
  ManagedComputerCurrency,
  ManagedComputerProductSchema,
  ManagedComputerSetupSessionSchema,
  ManagedComputerSetupSessionStatus,
  ManagedComputerSetupStatusSessionSchema,
  ManagedComputerSpecificationSchema,
  ManagedComputerSocketTicketSchema,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { WorkerCapabilitiesSchema } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import { describe, expect, it } from "vitest";
import {
  executionWorkerIconUpdateFromDomain,
  managedComputerProductFromProto,
  managedComputerSetupSessionTicketFromProto,
  managedComputerSetupStatusFromProto,
} from "./fleet-mappers";

const instant = (value: string) => timestampFromDate(new Date(value));

describe("Fleet protobuf mapping", () => {
  it("constructs the icon oneof and enforces product literal invariants", () => {
    const icon = executionWorkerIconUpdateFromDomain({
      type: "emoji",
      value: "🌿",
    });
    expect(icon.case).toBe("icon");
    if (icon.case !== "icon") throw new Error("Expected an icon update");
    expect(icon.value).toMatchObject({
      kind: WorkerIcon_Kind.EMOJI,
      value: "🌿",
    });
    expect(executionWorkerIconUpdateFromDomain(null).case).toBe("clearIcon");

    const response = create(GetManagedComputerProductResponseSchema, {
      product: create(ManagedComputerProductSchema, {
        currency: ManagedComputerCurrency.USD,
        monthlyPriceCents: 2_500,
        quantity: 1,
        specification: create(ManagedComputerSpecificationSchema, {
          instanceType: "c7g.medium",
          vcpu: 1,
          memoryGib: 2,
          volumeGib: 32,
          maxConcurrentRuns: 1,
        }),
      }),
    });
    expect(managedComputerProductFromProto(response).product).toMatchObject({
      currency: "USD",
      quantity: 1,
      modelApiCostsIncluded: false,
      specification: { maxConcurrentRuns: 1 },
    });
    response.product!.quantity = 2;
    expect(() => managedComputerProductFromProto(response)).toThrow(
      "Unexpected managed computer quantity",
    );
  });

  it("shares strict setup and worker snapshot semantics with the CLI", () => {
    const expiresAt = instant("2026-08-31T12:00:00.000Z");
    const setup = create(CreateManagedComputerSetupSessionResponseSchema, {
      session: create(ManagedComputerSetupSessionSchema, {
        id: "setup-1",
        managedComputerId: "computer-1",
        organizationId: "organization-1",
        projectId: "project-1",
        status: ManagedComputerSetupSessionStatus.PENDING,
        expiresAt,
      }),
      socket: create(ManagedComputerSocketTicketSchema, {
        url: "wss://example.test/setup",
        protocol: "briar.setup.v1",
      }),
    });
    expect(managedComputerSetupSessionTicketFromProto(setup)).toMatchObject({
      session: {
        status: "pending",
        expiresAt: "2026-08-31T12:00:00.000Z",
      },
      socket: { protocol: "briar.setup.v1" },
    });
    expect(() =>
      managedComputerSetupSessionTicketFromProto(
        create(CreateManagedComputerSetupSessionResponseSchema, {
          session: setup.session,
        }),
      ),
    ).toThrow("managedComputerSetupSessionTicket.socket is missing");

    const status = create(GetManagedComputerSetupStatusResponseSchema, {
      session: create(ManagedComputerSetupStatusSessionSchema, {
        id: "setup-1",
        projectId: "project-1",
        status: ManagedComputerSetupSessionStatus.EXPIRED,
        expiresAt,
      }),
      worker: create(DashboardWorkerSchema, {
        id: "binding-1",
        deviceId: "worker-1",
        ownerUserId: "owner-1",
        label: "Mac mini",
        agentProvider: AgentProvider.CODEX,
        providers: [AgentProvider.CODEX],
        capabilities: create(WorkerCapabilitiesSchema),
        state: DashboardWorker_State.ONLINE,
        readiness: DashboardWorker_Readiness.AVAILABLE,
        acceptingWork: true,
        maxConcurrentSessions: 1,
        availableSessions: 1,
        lastHeartbeatAt: expiresAt,
        createdAt: expiresAt,
      }),
    });
    expect(managedComputerSetupStatusFromProto(status)).toMatchObject({
      session: { status: "expired", consumedAt: null },
      worker: {
        state: "online",
        readiness: "available",
        agentProvider: "codex",
      },
    });
    status.worker!.capabilities = undefined;
    expect(() => managedComputerSetupStatusFromProto(status)).toThrow(
      "worker.capabilities is missing",
    );
  });
});
