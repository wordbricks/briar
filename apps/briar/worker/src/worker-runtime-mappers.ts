import { fromJsonString, toJsonString } from "@bufbuild/protobuf";
import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  type WorkerRuntimeAdvertisement,
  WorkerRuntimeAdvertisementSchema,
} from "@briar/contracts/gen/briar/types/v1/worker_pb";
import {
  decodeAgentProviderCapabilityCatalog,
  type AgentEffortCapability,
  type AgentProviderCapabilityCatalog,
} from "../../src/lib/agent-provider-contract";
import {
  agentProviders,
  type AgentProvider,
} from "../../src/lib/agent-provider";
import type { ProviderHealthMap } from "./workers";

export class WorkerRuntimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerRuntimeValidationError";
  }
}

export const MAX_STORED_WORKER_RUNTIME_BYTES = 1_048_576;

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
    case ProtoAgentProvider.VERTEX:
      return "vertex";
    case ProtoAgentProvider.PI:
      return "pi";
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
  capabilities: NonNullable<WorkerRuntimeAdvertisement["capabilities"]>,
): AgentProviderCapabilityCatalog => {
  if (capabilities.providerCapabilities.length !== agentProviders.length) {
    invalid(
      `Worker provider capabilities must contain exactly ${agentProviders.length} providers`,
    );
  }
  const catalog: Record<string, unknown> = {};
  const seen = new Set<AgentProvider>();
  for (const value of capabilities.providerCapabilities) {
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
        efforts: model.efforts.map(effortCapability),
      })),
      defaultEfforts: value.defaultEfforts.map(effortCapability),
      allowCustomModels: value.allowCustomModels,
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
  if (runtime.providerHealth.length !== agentProviders.length) {
    invalid(
      `Worker provider health must contain exactly ${agentProviders.length} providers`,
    );
  }
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

const computerUseCapability = (
  runtime: WorkerRuntimeAdvertisement,
  healthyProviders: ReadonlySet<AgentProvider>,
) => {
  const capability = runtime.capabilities?.computerUse;
  if (!capability) return null;
  if (capability.protocol !== 1) {
    return invalid("Computer Use protocol must be version 1");
  }
  if (capability.transport !== "connectrpc-resource-exec") {
    return invalid("Computer Use transport must be ConnectRPC Resource Exec");
  }
  if (
    !Number.isInteger(capability.maxWindows) ||
    capability.maxWindows < 1 ||
    capability.maxWindows > 99
  ) {
    return invalid("Computer Use max windows must be between 1 and 99");
  }
  if (!capability.sharedDesktop) {
    return invalid("Computer Use must use the shared desktop");
  }
  if (!/^[0-9a-f]{64}$/.test(capability.schemaDigest)) {
    return invalid("Computer Use schema digest must be a SHA-256 hex digest");
  }
  if (capability.providers.length === 0) {
    return invalid("Computer Use must advertise at least one provider");
  }
  const providers = capability.providers.map(workerAgentProviderFromProto);
  if (new Set(providers).size !== providers.length) {
    return invalid("Computer Use providers must be unique");
  }
  if (providers.some((provider) => !healthyProviders.has(provider))) {
    return invalid("Computer Use providers must also be healthy");
  }
  return {
    protocol: 1 as const,
    transport: "connectrpc-resource-exec" as const,
    providers,
    maxWindows: capability.maxWindows,
    sharedDesktop: true as const,
    humanTakeover: capability.humanTakeover,
    schemaDigest: capability.schemaDigest,
  };
};

export type WorkerRuntimeMetadata = ReturnType<
  typeof workerRuntimeMetadataFromProto
>;

export const workerRuntimeMetadataFromProto = (
  runtime: WorkerRuntimeAdvertisement | undefined,
) => {
  if (!runtime) return invalid("Worker runtime advertisement is required");
  const agentProvider = workerAgentProviderFromProto(runtime.agentProvider);
  const versions = { ...runtime.versions };
  for (const [key, value] of Object.entries(versions)) {
    if (key.length > 64 || value.length > 64) {
      invalid("Worker version keys and values must contain at most 64 characters");
    }
  }
  const capabilities = runtime.capabilities ??
    invalid("Worker capabilities are required");
  const capabilityCatalog = providerCapabilities(capabilities);
  const health = providerHealth(runtime);
  const providers = agentProviders.filter((provider) =>
    health[provider]?.healthy === true
  );
  const computerUse = computerUseCapability(runtime, new Set(providers));
  const runtimeProtoJson = toJsonString(
    WorkerRuntimeAdvertisementSchema,
    runtime,
  );
  if (
    new TextEncoder().encode(runtimeProtoJson).byteLength >
      MAX_STORED_WORKER_RUNTIME_BYTES
  ) {
    invalid("Worker runtime advertisement is too large");
  }
  return {
    proto: runtime,
    runtimeProtoJson,
    agentProvider,
    providers,
    providerHealth: health,
    providerCapabilities: capabilityCatalog,
    computerUse,
    versions,
  };
};

export const workerRuntimeMetadataFromStoredProtoJson = (value: string) =>
  workerRuntimeMetadataFromProto(
    fromJsonString(WorkerRuntimeAdvertisementSchema, value),
  );
