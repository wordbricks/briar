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
  readonly providers?: WorkerRuntimeInput["providers"];
  readonly providerCapabilities?: AgentProviderCapabilityCatalog;
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
      },
    ]),
  ) as WorkerRuntimeInput["providerHealth"];
  return workerRuntimeToProto({
    agentProvider: input.agentProvider ?? "codex",
    providers,
    providerHealth,
    providerCapabilities: input.providerCapabilities ??
      emptyAgentProviderCapabilityCatalog(),
    versions: { briar: "1.2.173" },
    worktrees: true,
    remoteUpdates: { supported: true, protocol: 1 },
    workflowRequirements: [],
  });
};

export const workerCapabilitiesFixture = (
  input: WorkerRuntimeFixtureInput = {},
) => workerRuntimeMetadataFromProto(workerRuntimeFixture(input)).capabilities;

export const workerClaimRuntimeFixture = (
  input: WorkerRuntimeFixtureInput = {},
) => {
  const runtime = workerRuntimeMetadataFromProto(workerRuntimeFixture(input));
  return {
    providers: runtime.providers,
    workerAgentProvider: runtime.agentProvider,
    workerCapabilitiesJson: JSON.stringify(runtime.capabilities),
  };
};
