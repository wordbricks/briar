import { create } from "@bufbuild/protobuf";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { WorkerRuntimeAdvertisementSchema } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import { describe, expect, it } from "vitest";
import { workerRuntimeMetadataFromProto } from "./worker-runtime-mappers";

describe("Worker runtime protobuf mapping", () => {
  it("keeps the configured provider when no provider is currently healthy", () => {
    const runtime = workerRuntimeMetadataFromProto(
      create(WorkerRuntimeAdvertisementSchema, {
        agentProvider: AgentProvider.CODEX,
        providers: [],
        providerHealth: [],
        versions: { briar: "1.2.116" },
      }),
    );

    expect(runtime.agentProvider).toBe("codex");
    expect(runtime.providers).toEqual([]);
    expect(runtime.capabilities.providers).toEqual([]);
  });
});
