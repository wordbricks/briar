import type { WorkerRuntimeAdvertisement } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import { agentProviders } from "../../../src/lib/agent-provider";
import {
  emptyAgentProviderCapabilityCatalog,
  type AgentProviderCapabilityCatalog,
} from "../../../src/lib/agent-provider-contract";
import {
  workerRuntimeToProto,
  type WorkerRuntimeInput,
} from "../../../src/lib/worker-runtime-proto";
import { workerRuntimeMetadataFromProto } from "../worker-runtime-mappers";

type WorkerRuntimeFixtureInput = {
  readonly agentProvider?: WorkerRuntimeInput["agentProvider"];
  readonly providers?: ReadonlyArray<WorkerRuntimeInput["agentProvider"]>;
  readonly providerHealth?: Partial<WorkerRuntimeInput["providerHealth"]>;
  readonly providerCapabilities?: AgentProviderCapabilityCatalog;
  readonly dmMemoryLearning?: WorkerRuntimeInput["dmMemoryLearning"];
  readonly computerUse?: WorkerRuntimeInput["computerUse"];
};

export const workerRuntimeFixture = (
  input: WorkerRuntimeFixtureInput = {},
): WorkerRuntimeAdvertisement => {
  const providers = input.providers ?? ["codex"];
  const available = new Set(providers);
  const providerHealth = Object.fromEntries(
    agentProviders.map((provider) => [
      provider,
      {
        installed: available.has(provider),
        authenticated: available.has(provider),
        healthy: available.has(provider),
        reason: available.has(provider) ? null : "not_installed",
        usageExhausted: false,
        maxUsedPercent: null,
        ...input.providerHealth?.[provider],
      },
    ]),
  ) as WorkerRuntimeInput["providerHealth"];
  return workerRuntimeToProto({
    agentProvider: input.agentProvider ?? "codex",
    providerHealth,
    providerCapabilities: input.providerCapabilities ??
      emptyAgentProviderCapabilityCatalog(),
    versions: { briar: "1.2.173" },
    worktrees: true,
    remoteUpdates: { supported: true, protocol: 1 },
    workflowRequirements: [],
    dmMemoryLearning: input.dmMemoryLearning,
    computerUse: input.computerUse,
  });
};

export const workerRuntimeMetadataFixture = (
  input: WorkerRuntimeFixtureInput = {},
) => workerRuntimeMetadataFromProto(workerRuntimeFixture(input));

export const workerRuntimeProtoJsonFixture = (
  input: WorkerRuntimeFixtureInput = {},
) => workerRuntimeMetadataFixture(input).runtimeProtoJson;

export const workerClaimRuntimeFixture = (
  input: WorkerRuntimeFixtureInput = {},
) => {
  const runtime = workerRuntimeMetadataFixture(input);
  return { runtime, runtimeProtoJson: runtime.runtimeProtoJson };
};
