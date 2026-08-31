import { describe, expect, it } from "vitest";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";
import {
  workerRuntimeMetadataFromProto,
  WorkerRuntimeValidationError,
} from "./worker-runtime-mappers";

describe("Worker runtime protobuf mapping", () => {
  it("keeps the configured provider when no provider is currently healthy", () => {
    const runtime = workerRuntimeMetadataFromProto(
      workerRuntimeFixture({
        providers: [],
      }),
    );

    expect(runtime.agentProvider).toBe("codex");
    expect(runtime.providers).toEqual([]);
    expect(runtime.capabilities.providers).toEqual([]);
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
});
