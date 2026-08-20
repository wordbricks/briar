import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { agentProviders, type AgentProvider } from "./agent-provider";

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

/**
 * Model and effort identifiers are provider-owned capability values. Keep the
 * API validation structural so a provider can add a value without requiring a
 * Briar release.
 */
export const ModelId = Schema.Trim.check(Schema.isLengthBetween(1, 100));
export const ModelEffort = Schema.Trim.check(Schema.isLengthBetween(1, 50));
export type ModelEffort = typeof ModelEffort.Type;

export const AgentEffortCapability = Schema.Struct({
  id: Schema.mutableKey(ModelEffort),
  label: Schema.mutableKey(
    Schema.Trim.check(Schema.isLengthBetween(1, 200)),
  ),
  description: Schema.mutableKey(
    Schema.optional(
      Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(1_000))),
    ),
  ),
  isDefault: Schema.mutableKey(Schema.optional(Schema.Boolean)),
}).annotate({ parseOptions: strictSchemaOptions });
export type AgentEffortCapability = typeof AgentEffortCapability.Type;

export const AgentModelCapability = Schema.Struct({
  id: Schema.mutableKey(ModelId),
  label: Schema.mutableKey(
    Schema.Trim.check(Schema.isLengthBetween(1, 200)),
  ),
  isDefault: Schema.mutableKey(Schema.optional(Schema.Boolean)),
  defaultEffortId: Schema.mutableKey(Schema.optional(Schema.NullOr(ModelEffort))),
  efforts: Schema.mutableKey(
    Schema.optional(
      mutableArray(AgentEffortCapability).check(Schema.isMaxLength(20)),
    ),
  ),
}).annotate({ parseOptions: strictSchemaOptions });
export type AgentModelCapability = typeof AgentModelCapability.Type;

export const AgentProviderCapability = Schema.Struct({
  models: Schema.mutableKey(
    mutableArray(AgentModelCapability).check(Schema.isMaxLength(500)),
  ),
  defaultEfforts: Schema.mutableKey(
    Schema.optional(
      mutableArray(AgentEffortCapability).check(Schema.isMaxLength(20)),
    ),
  ),
  allowCustomModels: Schema.mutableKey(Schema.optional(Schema.Boolean)),
  error: Schema.mutableKey(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(2_000))),
  ),
}).annotate({ parseOptions: strictSchemaOptions });
export type AgentProviderCapability = typeof AgentProviderCapability.Type;

const PartialAgentProviderCapabilityCatalog = Schema.Struct({
  codex: Schema.mutableKey(Schema.optional(AgentProviderCapability)),
  claude: Schema.mutableKey(Schema.optional(AgentProviderCapability)),
  cursor: Schema.mutableKey(Schema.optional(AgentProviderCapability)),
  grok: Schema.mutableKey(Schema.optional(AgentProviderCapability)),
  agy: Schema.mutableKey(Schema.optional(AgentProviderCapability)),
  opencode: Schema.mutableKey(Schema.optional(AgentProviderCapability)),
  openrouter: Schema.mutableKey(Schema.optional(AgentProviderCapability)),
}).annotate({ parseOptions: strictSchemaOptions });

const FullAgentProviderCapabilityCatalog = Schema.Struct({
  codex: Schema.mutableKey(AgentProviderCapability),
  claude: Schema.mutableKey(AgentProviderCapability),
  cursor: Schema.mutableKey(AgentProviderCapability),
  grok: Schema.mutableKey(AgentProviderCapability),
  agy: Schema.mutableKey(AgentProviderCapability),
  opencode: Schema.mutableKey(AgentProviderCapability),
  openrouter: Schema.mutableKey(AgentProviderCapability),
}).annotate({ parseOptions: strictSchemaOptions });

export type AgentProviderCapabilityCatalog =
  typeof FullAgentProviderCapabilityCatalog.Type;

export const AgentProviderCapabilityCatalog =
  PartialAgentProviderCapabilityCatalog.pipe(
    Schema.decodeTo(
      FullAgentProviderCapabilityCatalog,
      SchemaTransformation.transform({
        decode: (partial): AgentProviderCapabilityCatalog => ({
          ...emptyAgentProviderCapabilityCatalog(),
          ...partial,
        }),
        encode: (catalog) => catalog,
      }),
    ),
  );

export const decodeAgentProviderCapabilityCatalog = Schema.decodeUnknownSync(
  AgentProviderCapabilityCatalog,
  strictSchemaOptions,
);
export const decodeAgentProviderCapabilityCatalogOption =
  Schema.decodeUnknownOption(
    AgentProviderCapabilityCatalog,
    strictSchemaOptions,
  );

const emptyAgentProviderCapability = (
  provider: AgentProvider,
): AgentProviderCapability => ({
  models: [],
  defaultEfforts: [],
  allowCustomModels:
    provider === "claude" ||
    provider === "cursor" ||
    provider === "opencode" ||
    provider === "openrouter",
  error: null,
});

export function emptyAgentProviderCapabilityCatalog(): AgentProviderCapabilityCatalog {
  return {
    codex: emptyAgentProviderCapability("codex"),
    claude: emptyAgentProviderCapability("claude"),
    cursor: emptyAgentProviderCapability("cursor"),
    grok: emptyAgentProviderCapability("grok"),
    agy: emptyAgentProviderCapability("agy"),
    opencode: emptyAgentProviderCapability("opencode"),
    openrouter: emptyAgentProviderCapability("openrouter"),
  };
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
    merged[provider].allowCustomModels = entries.some(
      (entry) => entry.allowCustomModels,
    );
    merged[provider].error = entries.length > 0 &&
        entries.every((entry) => entry.error)
      ? entries.map((entry) => entry.error).filter(Boolean).join("; ").slice(
        0,
        2_000,
      )
      : null;
    const defaultEfforts = new Map<string, AgentEffortCapability>();
    const models = new Map<string, AgentModelCapability>();
    for (const entry of entries) {
      for (const candidate of entry.defaultEfforts ?? []) {
        defaultEfforts.set(candidate.id, candidate);
      }
      for (const candidate of entry.models) {
        const existing = models.get(candidate.id);
        if (!existing) {
          models.set(candidate.id, {
            ...candidate,
            efforts: [...(candidate.efforts ?? [])],
          });
          continue;
        }
        const efforts = new Map(
          (existing.efforts ?? []).map((item) => [item.id, item]),
        );
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
