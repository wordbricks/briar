import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import type { WorkerRuntimeAdvertisement } from "@briar/contracts/gen/briar/types/v1/worker_pb";
import {
  decodeAgentProviderCapabilityCatalog,
  emptyAgentProviderCapabilityCatalog,
  type AgentEffortCapability,
  type AgentProviderCapabilityCatalog,
} from "../../src/lib/agent-provider-contract";
import type { AgentProvider } from "../../src/lib/agent-provider";
import type { ProviderHealthMap } from "./workers";

export class WorkerRuntimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerRuntimeValidationError";
  }
}

const invalid = (message: string): never => {
  throw new WorkerRuntimeValidationError(message);
};

export const workerAgentProviderFromProto = (
  provider: ProtoAgentProvider,
): AgentProvider => {
  switch (provider) {
    case ProtoAgentProvider.CODEX:
      return "codex";
    case ProtoAgentProvider.CLAUDE:
      return "claude";
    case ProtoAgentProvider.CURSOR:
      return "cursor";
    case ProtoAgentProvider.GROK:
      return "grok";
    case ProtoAgentProvider.AGY:
      return "agy";
    case ProtoAgentProvider.OPENCODE:
      return "opencode";
    case ProtoAgentProvider.OPENROUTER:
      return "openrouter";
    case ProtoAgentProvider.UNSPECIFIED:
      return invalid("Agent provider is required");
    default:
      return invalid(`Unknown agent provider: ${provider}`);
  }
};

const effortCapability = (value: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}): AgentEffortCapability => ({
  id: value.id,
  label: value.label,
  ...(value.description !== undefined
    ? { description: value.description }
    : {}),
  ...(value.isDefault !== undefined ? { isDefault: value.isDefault } : {}),
});

const providerCapabilities = (
  runtime: WorkerRuntimeAdvertisement,
): AgentProviderCapabilityCatalog => {
  const catalog = emptyAgentProviderCapabilityCatalog();
  const seen = new Set<AgentProvider>();
  for (const value of runtime.capabilities?.providerCapabilities ?? []) {
    const provider = workerAgentProviderFromProto(value.provider);
    if (seen.has(provider)) {
      invalid(`Provider capability is duplicated: ${provider}`);
    }
    seen.add(provider);
    catalog[provider] = {
      models: value.models.map((model) => ({
        id: model.id,
        label: model.label,
        ...(model.isDefault !== undefined
          ? { isDefault: model.isDefault }
          : {}),
        ...(model.defaultEffortId !== undefined
          ? { defaultEffortId: model.defaultEffortId }
          : {}),
        ...(model.efforts.length > 0
          ? { efforts: model.efforts.map(effortCapability) }
          : {}),
      })),
      ...(value.defaultEfforts.length > 0
        ? { defaultEfforts: value.defaultEfforts.map(effortCapability) }
        : {}),
      ...(value.allowCustomModels !== undefined
        ? { allowCustomModels: value.allowCustomModels }
        : {}),
      error: value.error ?? null,
    };
  }
  try {
    return decodeAgentProviderCapabilityCatalog(catalog);
  } catch {
    return invalid("Worker provider capabilities are invalid");
  }
};

const providerHealth = (
  runtime: WorkerRuntimeAdvertisement,
): ProviderHealthMap => {
  const result: ProviderHealthMap = {};
  for (const value of runtime.providerHealth) {
    const provider = workerAgentProviderFromProto(value.provider);
    if (result[provider] !== undefined) {
      invalid(`Provider health is duplicated: ${provider}`);
    }
    if (value.reason !== undefined && value.reason.trim().length > 64) {
      invalid("Provider health reason must contain at most 64 characters");
    }
    if (
      value.maxUsedPercent !== undefined &&
      (!Number.isFinite(value.maxUsedPercent) ||
        value.maxUsedPercent < 0 ||
        value.maxUsedPercent > 100)
    ) {
      invalid("Provider usage must be between 0 and 100 percent");
    }
    result[provider] = {
      installed: value.installed,
      authenticated: value.authenticated,
      healthy: value.healthy,
      reason: value.reason ?? null,
      usageExhausted: value.usageExhausted,
      maxUsedPercent: value.maxUsedPercent ?? null,
    };
  }
  return result;
};

export type WorkerRuntimeMetadata = ReturnType<
  typeof workerRuntimeMetadataFromProto
>;

export const workerRuntimeMetadataFromProto = (
  runtime: WorkerRuntimeAdvertisement | undefined,
) => {
  if (!runtime) return invalid("Worker runtime advertisement is required");
  const agentProvider = workerAgentProviderFromProto(runtime.agentProvider);
  const providers = runtime.providers.map(workerAgentProviderFromProto);
  if (new Set(providers).size !== providers.length) {
    invalid("Worker providers must be unique");
  }
  if (providers.length > 7) invalid("Worker has too many providers");
  if (!providers.includes(agentProvider)) {
    invalid("Primary agent provider must be advertised as available");
  }
  const versions = { ...runtime.versions };
  for (const [key, value] of Object.entries(versions)) {
    if (key.length > 64 || value.length > 64) {
      invalid("Worker version keys and values must contain at most 64 characters");
    }
  }
  const capabilities = runtime.capabilities;
  const capabilityCatalog = providerCapabilities(runtime);
  const health = providerHealth(runtime);
  const capabilityJson = {
    providers,
    providerHealth: health,
    providerCapabilities: capabilityCatalog,
    worktrees: capabilities?.worktrees ?? false,
    workflowRequirements: (capabilities?.workflowRequirements ?? []).map(
      (requirement) => ({
        id: requirement.id,
        healthy: requirement.healthy,
        detail: requirement.detail ?? null,
      }),
    ),
    ...(capabilities?.remoteUpdates
      ? {
          remoteUpdates: {
            supported: capabilities.remoteUpdates.supported,
            ...(capabilities.remoteUpdates.protocol !== undefined
              ? { protocol: capabilities.remoteUpdates.protocol }
              : {}),
          },
        }
      : {}),
    ...(capabilities?.organizationAgentContextProtocol !== undefined
      ? {
          organizationAgentContext: {
            protocol: capabilities.organizationAgentContextProtocol,
          },
        }
      : {}),
  };
  return {
    agentProvider,
    providers,
    providerHealth: health,
    providerCapabilities: capabilityCatalog,
    versions,
    capabilities: capabilityJson,
  };
};
