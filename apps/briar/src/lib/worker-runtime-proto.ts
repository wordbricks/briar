import { create } from "@bufbuild/protobuf";
import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { WorkerRuntimeAdvertisementSchema } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import { agentProviders, type AgentProvider } from "./agent-provider";
import type { AgentProviderCapabilityCatalog } from "./agent-provider-contract";

const protoAgentProvider = {
  codex: ProtoAgentProvider.CODEX,
  claude: ProtoAgentProvider.CLAUDE,
  cursor: ProtoAgentProvider.CURSOR,
  grok: ProtoAgentProvider.GROK,
  agy: ProtoAgentProvider.AGY,
  opencode: ProtoAgentProvider.OPENCODE,
  openrouter: ProtoAgentProvider.OPENROUTER,
} as const satisfies Record<AgentProvider, ProtoAgentProvider>;

export type WorkerRuntimeInput = {
  readonly agentProvider: AgentProvider;
  readonly providerHealth: Readonly<Record<AgentProvider, {
    readonly installed: boolean;
    readonly authenticated: boolean;
    readonly healthy: boolean;
    readonly reason?: string | null;
    readonly usageExhausted?: boolean;
    readonly maxUsedPercent?: number | null;
  }>>;
  readonly providerCapabilities: AgentProviderCapabilityCatalog;
  readonly versions: Readonly<Record<string, string>>;
  readonly worktrees: boolean;
  readonly remoteUpdates?: {
    readonly supported: boolean;
    readonly protocol?: number;
  };
  readonly workflowRequirements?: ReadonlyArray<{
    readonly id: string;
    readonly healthy: boolean;
    readonly detail: string | null;
  }>;
};

export const workerRuntimeToProto = (input: WorkerRuntimeInput) =>
  create(WorkerRuntimeAdvertisementSchema, {
    agentProvider: protoAgentProvider[input.agentProvider],
    providerHealth: agentProviders.map((provider) => ({
      provider: protoAgentProvider[provider],
      installed: input.providerHealth[provider].installed,
      authenticated: input.providerHealth[provider].authenticated,
      healthy: input.providerHealth[provider].healthy,
      reason: input.providerHealth[provider].reason ?? undefined,
      usageExhausted: input.providerHealth[provider].usageExhausted ?? false,
      maxUsedPercent: input.providerHealth[provider].maxUsedPercent ?? undefined,
    })),
    capabilities: {
      providerCapabilities: agentProviders.map((provider) => {
        const capability = input.providerCapabilities[provider];
        return {
          provider: protoAgentProvider[provider],
          models: capability.models.map((model) => ({
            id: model.id,
            label: model.label,
            isDefault: model.isDefault,
            defaultEffortId: model.defaultEffortId ?? undefined,
            efforts: (model.efforts ?? []).map((effort) => ({
              id: effort.id,
              label: effort.label,
              description: effort.description ?? undefined,
              isDefault: effort.isDefault,
            })),
          })),
          defaultEfforts: (capability.defaultEfforts ?? []).map((effort) => ({
            id: effort.id,
            label: effort.label,
            description: effort.description ?? undefined,
            isDefault: effort.isDefault,
          })),
          allowCustomModels: capability.allowCustomModels,
          error: capability.error ?? undefined,
        };
      }),
      remoteUpdates: input.remoteUpdates,
      worktrees: input.worktrees,
      workflowRequirements: input.workflowRequirements?.map((requirement) => ({
        id: requirement.id,
        healthy: requirement.healthy,
        detail: requirement.detail ?? undefined,
      })) ?? [],
      dmMemoryProtocol: 1,
    },
    versions: { ...input.versions },
  });
