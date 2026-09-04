import type { WorkerRuntimeAdvertisement } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import {
  agentProviders,
  type AgentProvider,
} from "../../../src/lib/agent-provider";
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

/**
 * The providers `briar_invalid_execution_worker_runtime` accepted between
 * migration 0166 and the Vertex provider migration: that view asserts the
 * advertisement carries exactly these seven and rejects anything else.
 *
 * Migration regression tests pin `applyD1Migrations` to a migration inside that
 * window, so their fixtures have to advertise this list instead of the live
 * `agentProviders`. It is written out rather than filtered from the catalog on
 * purpose: a derived list would silently follow the catalog forward and break
 * these tests again the next time a provider is added.
 */
export const providersBeforeVertexMigration = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "agy",
  "opencode",
  "openrouter",
] as const satisfies ReadonlyArray<AgentProvider>;

const protoProviderName = (provider: AgentProvider) =>
  `AGENT_PROVIDER_${provider.toUpperCase()}`;

type ProviderScopedProtoJson = {
  providerHealth: { provider: string }[];
  capabilities: { providerCapabilities: { provider: string }[] };
};

/**
 * `workerRuntimeToProto` always advertises the live catalog, so a fixture aimed
 * at a pinned migration drops the provider entries that schema does not know.
 */
export const workerRuntimeProtoJsonFixtureBeforeVertex = (
  input: WorkerRuntimeFixtureInput = {},
) => {
  const allowed = new Set(
    providersBeforeVertexMigration.map(protoProviderName),
  );
  const runtime = JSON.parse(
    workerRuntimeProtoJsonFixture(input),
  ) as ProviderScopedProtoJson;
  runtime.providerHealth = runtime.providerHealth.filter((entry) =>
    allowed.has(entry.provider)
  );
  runtime.capabilities.providerCapabilities = runtime.capabilities
    .providerCapabilities.filter((entry) => allowed.has(entry.provider));
  return JSON.stringify(runtime);
};

export const workerClaimRuntimeFixture = (
  input: WorkerRuntimeFixtureInput = {},
) => {
  const runtime = workerRuntimeMetadataFixture(input);
  return { runtime, runtimeProtoJson: runtime.runtimeProtoJson };
};
