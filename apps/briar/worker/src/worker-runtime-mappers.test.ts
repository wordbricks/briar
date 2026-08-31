import { describe, expect, it } from "vitest";
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

  it("rejects incomplete or duplicate runtime catalogs", () => {
    const runtime = workerRuntimeFixture();
    if (!runtime.capabilities) throw new Error("Fixture omitted capabilities");
    runtime.capabilities.providerCapabilities.pop();

    expect(() => workerRuntimeMetadataFromProto(runtime)).toThrow(
      new WorkerRuntimeValidationError(
        "Worker provider capabilities must contain exactly 7 providers",
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
});
