import { create } from "@bufbuild/protobuf";
import { WorkerRuntimeAdvertisementSchema } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import { agentProviders, type AgentProvider } from "./agent-provider";
import type { AgentProviderCapabilityCatalog } from "./agent-provider-contract";
import { protoAgentProvider } from "./agent-provider-proto";

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
  readonly dmMemoryLearning?: boolean | {
    readonly protocol: 2;
    readonly transports: ReadonlyArray<"agent" | "openrouter">;
    readonly providers: ReadonlyArray<AgentProvider>;
  };
  readonly computerUse?: {
    readonly protocol: 1;
    readonly transport: "connectrpc-resource-exec";
    readonly providers: ReadonlyArray<AgentProvider>;
    readonly maxWindows: number;
    readonly sharedDesktop: true;
    readonly humanTakeover: true;
    readonly schemaDigest: string;
  };
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
      dmMemoryLearningRequests: input.dmMemoryLearning ? 1 : undefined,
      dmMemoryLearning: input.dmMemoryLearning
        ? typeof input.dmMemoryLearning === "boolean"
          ? { protocol: 1, transport: "openrouter" }
          : {
              protocol: input.dmMemoryLearning.protocol,
              transports: [...input.dmMemoryLearning.transports],
              providers: input.dmMemoryLearning.providers.map(
                (provider) => protoAgentProvider[provider],
              ),
            }
        : undefined,
      computerUse: input.computerUse
        ? {
            protocol: input.computerUse.protocol,
            transport: input.computerUse.transport,
            providers: input.computerUse.providers.map(
              (provider) => protoAgentProvider[provider],
            ),
            maxWindows: input.computerUse.maxWindows,
            sharedDesktop: input.computerUse.sharedDesktop,
            humanTakeover: input.computerUse.humanTakeover,
            schemaDigest: input.computerUse.schemaDigest,
          }
        : undefined,
    },
    versions: { ...input.versions },
  });
