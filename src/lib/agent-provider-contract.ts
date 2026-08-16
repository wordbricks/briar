import { z } from "zod";

export const agentProviders = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "agy",
  "opencode",
] as const;
export type AgentProvider = (typeof agentProviders)[number];

export function agentProviderBinaryName(provider: AgentProvider) {
  return provider === "cursor" ? "cursor-agent" : provider;
}

/**
 * Model and effort identifiers are provider-owned capability values. Keep the
 * API validation structural so a provider can add a value without requiring a
 * Briar release.
 */
export const modelIdSchema = z.string().trim().min(1).max(100);
export const modelEffortSchema = z.string().trim().min(1).max(50);
export type ModelEffort = string;

export type AgentEffortCapability = {
  id: string;
  label: string;
  description?: string | null;
  isDefault?: boolean;
};

export type AgentModelCapability = {
  id: string;
  label: string;
  isDefault?: boolean;
  defaultEffortId?: string | null;
  efforts?: AgentEffortCapability[];
};

export type AgentProviderCapability = {
  models: AgentModelCapability[];
  /** Efforts used when the provider accepts a custom/default model. */
  defaultEfforts?: AgentEffortCapability[];
  allowCustomModels?: boolean;
  error: string | null;
};

export type AgentProviderCapabilityCatalog = Record<
  AgentProvider,
  AgentProviderCapability
>;

export const agentEffortCapabilitySchema = z
  .object({
    id: modelEffortSchema,
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1_000).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const agentModelCapabilitySchema = z
  .object({
    id: modelIdSchema,
    label: z.string().trim().min(1).max(200),
    isDefault: z.boolean().optional(),
    defaultEffortId: modelEffortSchema.nullable().optional(),
    efforts: z.array(agentEffortCapabilitySchema).max(20),
  })
  .strict();

export const agentProviderCapabilitySchema = z
  .object({
    models: z.array(agentModelCapabilitySchema).max(500),
    defaultEfforts: z.array(agentEffortCapabilitySchema).max(20),
    allowCustomModels: z.boolean(),
    error: z.string().trim().max(2_000).nullable(),
  })
  .strict();

export const agentProviderCapabilityCatalogSchema = z
  .partialRecord(z.enum(agentProviders), agentProviderCapabilitySchema)
  .transform((value): AgentProviderCapabilityCatalog => {
    const catalog = emptyAgentProviderCapabilityCatalog();
    for (const provider of agentProviders) {
      if (value[provider]) catalog[provider] = value[provider];
    }
    return catalog;
  });

export const agentProviderLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  agy: "Antigravity",
  opencode: "OpenCode",
};

export function emptyAgentProviderCapabilityCatalog(): AgentProviderCapabilityCatalog {
  return Object.fromEntries(
    agentProviders.map((provider) => [
      provider,
      {
        models: [],
        defaultEfforts: [],
        allowCustomModels:
          provider === "claude" || provider === "cursor" || provider === "opencode",
        error: null,
      },
    ]),
  ) as unknown as AgentProviderCapabilityCatalog;
}

export function agentProviderSupportsSelection(
  capability: AgentProviderCapability,
  model: string | null,
  effort: string | null,
) {
  const reportedModel = model
    ? capability.models.find((candidate) => candidate.id === model)
    : capability.models.find((candidate) => candidate.isDefault);
  if (model && !reportedModel && !capability.allowCustomModels) return false;
  if (!effort) return true;
  const efforts = reportedModel?.efforts?.length
    ? reportedModel.efforts
    : (capability.defaultEfforts ?? []);
  return efforts.some((candidate) => candidate.id === effort);
}

export function mergeAgentProviderCapabilityCatalogs(
  catalogs: AgentProviderCapabilityCatalog[],
) {
  const merged = emptyAgentProviderCapabilityCatalog();
  for (const provider of agentProviders) {
    const entries = catalogs.map((catalog) => catalog[provider]);
    merged[provider].allowCustomModels = entries.some((entry) => entry.allowCustomModels);
    merged[provider].error = entries.length > 0 && entries.every((entry) => entry.error)
      ? entries.map((entry) => entry.error).filter(Boolean).join("; ").slice(0, 2_000)
      : null;
    const defaultEfforts = new Map<string, AgentEffortCapability>();
    const models = new Map<string, AgentModelCapability>();
    for (const entry of entries) {
      for (const candidate of entry.defaultEfforts ?? []) defaultEfforts.set(candidate.id, candidate);
      for (const candidate of entry.models) {
        const existing = models.get(candidate.id);
        if (!existing) {
          models.set(candidate.id, { ...candidate, efforts: [...(candidate.efforts ?? [])] });
          continue;
        }
        const efforts = new Map((existing.efforts ?? []).map((item) => [item.id, item]));
        for (const item of candidate.efforts ?? []) efforts.set(item.id, item);
        existing.efforts = [...efforts.values()];
        existing.isDefault ||= candidate.isDefault;
        existing.defaultEffortId ??= candidate.defaultEffortId;
      }
    }
    merged[provider].defaultEfforts = [...defaultEfforts.values()];
    merged[provider].models = [...models.values()];
  }
  return merged;
}
