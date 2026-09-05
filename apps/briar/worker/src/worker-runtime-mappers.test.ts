import { describe, expect, it } from "vitest";
import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { emptyAgentProviderCapabilityCatalog } from "../../src/lib/agent-provider-contract";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";
import {
  MAX_STORED_WORKER_RUNTIME_BYTES,
  workerRuntimeMetadataFromProto,
  workerRuntimeMetadataFromStoredProtoJson,
  WorkerRuntimeValidationError,
} from "./worker-runtime-mappers";

describe("Worker runtime protobuf mapping", () => {
  it("round-trips canonical ProtoJSON and derives healthy providers", () => {
    const metadata = workerRuntimeMetadataFromProto(
      workerRuntimeFixture({
        providers: [],
      }),
    );

    expect(metadata.agentProvider).toBe("codex");
    expect(metadata.providers).toEqual([]);
    expect(
      workerRuntimeMetadataFromStoredProtoJson(metadata.runtimeProtoJson),
    ).toMatchObject({
      agentProvider: "codex",
      providers: [],
      versions: { briar: "1.2.173" },
    });

    const withUnknownField = {
      ...(JSON.parse(metadata.runtimeProtoJson) as Record<string, unknown>),
      legacyProviders: ["codex"],
    };
    expect(() =>
      workerRuntimeMetadataFromStoredProtoJson(JSON.stringify(withUnknownField))
    ).toThrow();
  });

  it("reads an advertisement that predates a newly added provider", () => {
    // A Worker that registered before `pi` shipped stored an eight-provider
    // advertisement, and an offline one can never re-advertise. Reading it has
    // to keep working, with the provider it predates reported unavailable.
    const runtime = workerRuntimeFixture({ providers: ["codex"] });
    if (!runtime.capabilities) throw new Error("Fixture omitted capabilities");
    runtime.capabilities.providerCapabilities = runtime.capabilities
      .providerCapabilities.filter((entry) =>
        entry.provider !== ProtoAgentProvider.PI
      );
    runtime.providerHealth = runtime.providerHealth.filter((entry) =>
      entry.provider !== ProtoAgentProvider.PI
    );

    const metadata = workerRuntimeMetadataFromProto(runtime);

    expect(metadata.providers).toEqual(["codex"]);
    expect(metadata.providerHealth.pi).toBeUndefined();
    expect(metadata.providerCapabilities.pi).toEqual(
      emptyAgentProviderCapabilityCatalog().pi,
    );
    expect(
      workerRuntimeMetadataFromStoredProtoJson(metadata.runtimeProtoJson)
        .providers,
    ).toEqual(["codex"]);
  });

  it("rejects duplicate runtime catalog entries", () => {
    const duplicateCapabilities = workerRuntimeFixture();
    if (!duplicateCapabilities.capabilities) {
      throw new Error("Fixture omitted capabilities");
    }
    duplicateCapabilities.capabilities.providerCapabilities[6] =
      duplicateCapabilities.capabilities.providerCapabilities[0];
    expect(() => workerRuntimeMetadataFromProto(duplicateCapabilities)).toThrow(
      new WorkerRuntimeValidationError(
        "Provider capability is duplicated: codex",
      ),
    );

    const duplicateHealth = workerRuntimeFixture();
    duplicateHealth.providerHealth[6] = duplicateHealth.providerHealth[0];
    expect(() => workerRuntimeMetadataFromProto(duplicateHealth)).toThrow(
      new WorkerRuntimeValidationError(
        "Provider health is duplicated: codex",
      ),
    );
  });

  it("rejects a runtime that exceeds the persisted D1 budget", () => {
    const runtime = workerRuntimeFixture();
    for (let index = 0; index < 20_000; index += 1) {
      runtime.versions[`v${index}`] = "x".repeat(64);
    }

    expect(() => workerRuntimeMetadataFromProto(runtime)).toThrow(
      new WorkerRuntimeValidationError(
        "Worker runtime advertisement is too large",
      ),
    );
    expect(MAX_STORED_WORKER_RUNTIME_BYTES).toBe(1_048_576);
  });

  it("accepts and round-trips a valid Computer Use capability", () => {
    const metadata = workerRuntimeMetadataFromProto(workerRuntimeFixture({
      providers: ["grok"],
      computerUse: {
        protocol: 1,
        transport: "connectrpc-resource-exec",
        providers: ["grok"],
        maxWindows: 99,
        sharedDesktop: true,
        humanTakeover: true,
        schemaDigest: "a".repeat(64),
      },
    }));

    expect(metadata.computerUse).toEqual({
      protocol: 1,
      transport: "connectrpc-resource-exec",
      providers: ["grok"],
      maxWindows: 99,
      sharedDesktop: true,
      humanTakeover: true,
      schemaDigest: "a".repeat(64),
    });
    expect(
      workerRuntimeMetadataFromStoredProtoJson(metadata.runtimeProtoJson)
        .computerUse,
    ).toEqual(metadata.computerUse);
  });

  it("rejects Computer Use claims that are not backed by a healthy provider", () => {
    expect(() => workerRuntimeMetadataFromProto(workerRuntimeFixture({
      providers: ["codex"],
      computerUse: {
        protocol: 1,
        transport: "connectrpc-resource-exec",
        providers: ["grok"],
        maxWindows: 99,
        sharedDesktop: true,
        humanTakeover: true,
        schemaDigest: "a".repeat(64),
      },
    }))).toThrow(
      new WorkerRuntimeValidationError(
        "Computer Use providers must also be healthy",
      ),
    );
  });
});
