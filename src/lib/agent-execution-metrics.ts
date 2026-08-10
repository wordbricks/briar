import { z } from "zod";
import {
  agentProviders,
  type AgentProvider,
} from "./agent-provider-contract";

const tokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const observedAtSchema = z.string().datetime({ offset: true });

export const agentExecutionMetricsSchema = z
  .object({
    inputTokens: tokenCountSchema.nullable(),
    outputTokens: tokenCountSchema.nullable(),
    cacheReadTokens: tokenCountSchema.nullable(),
    cacheWriteTokens: tokenCountSchema.nullable(),
    reasoningOutputTokens: tokenCountSchema.nullable(),
    totalTokens: tokenCountSchema.nullable(),
    durationMs: tokenCountSchema,
  })
  .strict();

export type AgentExecutionMetrics = z.infer<typeof agentExecutionMetricsSchema>;
export type AgentExecutionTokenUsage = Omit<
  AgentExecutionMetrics,
  "durationMs"
>;
export type AgentExecutionUsageProvider = AgentProvider;

type AgentExecutionUsageObservationBase = {
  /** Briar runtime provider, separate from the provider's billing namespace. */
  provider: "codex" | "claude";
  model: string | null;
  canonicalModel: string | null;
  /** Raw provider/billing namespace such as openai, bedrock, or vertex. */
  modelProvider: string | null;
  modelSource:
    "providerReported" | "providerConfig" | "configuredFallback" | "unknown";
  scopeId: string | null;
  sessionId: string | null;
  turnId: string | null;
  /** Stable when the provider supplies enough identity to replace a replay. */
  dedupeKey: string | null;
};

export type AgentExecutionModelObservation =
  AgentExecutionUsageObservationBase & {
    kind: "model";
    source:
      | "claude.init"
      | "claude.assistant"
      | "codex.config"
      | "codex.modelDefault"
      | "codex.thread"
      | "codex.turnRequest"
      | "codex.threadSettings"
      | "codex.rerouted";
  };

export type AgentExecutionTokenObservation =
  AgentExecutionUsageObservationBase & {
    /**
     * A delta is one provider message/turn. A cumulative observation replaces
     * earlier deltas for the same session and model.
     */
    kind: "delta" | "cumulative";
    tokenUsage: AgentExecutionTokenUsage;
    source:
      | "claude.assistant.usage"
      | "claude.result.modelUsage"
      | "claude.result.usage"
      | "codex.threadTokenUsage"
      | "codex.turnUsage";
  };

export type AgentExecutionUsageObservation =
  AgentExecutionModelObservation | AgentExecutionTokenObservation;

export const agentExecutionUsageRecordSchema = z
  .object({
    usageKey: z.string().trim().min(1).max(512),
    sessionId: z.string().trim().min(1).max(512).nullable(),
    scopeId: z.string().trim().min(1).max(512).nullable(),
    turnId: z.string().trim().min(1).max(512).nullable(),
    agentProvider: z.enum(agentProviders),
    modelProvider: z.string().trim().min(1).max(256).nullable(),
    model: z.string().trim().min(1).max(512).nullable(),
    canonicalModel: z.string().trim().min(1).max(512).nullable(),
    modelSource: z.enum([
      "providerReported",
      "providerConfig",
      "configuredFallback",
      "unknown",
    ]),
    source: z.string().trim().min(1).max(128),
    uncachedInputTokens: tokenCountSchema.nullable(),
    cacheReadTokens: tokenCountSchema.nullable(),
    cacheWriteTokens: tokenCountSchema.nullable(),
    outputTokens: tokenCountSchema.nullable(),
    reasoningOutputTokens: tokenCountSchema.nullable(),
    totalTokens: tokenCountSchema.nullable(),
    observedAt: observedAtSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.uncachedInputTokens === null &&
      record.cacheReadTokens === null &&
      record.cacheWriteTokens === null &&
      record.outputTokens === null &&
      record.reasoningOutputTokens === null &&
      record.totalTokens === null
    ) {
      context.addIssue({
        code: "custom",
        message: "usage records require at least one token value",
      });
    }
    if (
      record.reasoningOutputTokens !== null &&
      (record.outputTokens === null ||
        record.reasoningOutputTokens > record.outputTokens)
    ) {
      context.addIssue({
        code: "custom",
        message: "reasoningOutputTokens must be a subset of outputTokens",
        path: ["reasoningOutputTokens"],
      });
    }
    // Total equality is intentionally not enforced because provider total
    // token semantics are not uniform.
  });

export type AgentExecutionUsageRecord = z.infer<
  typeof agentExecutionUsageRecordSchema
>;

export type AgentExecutionCollectedTokenObservation =
  AgentExecutionTokenObservation & {
    dedupeKey: string;
    observedAt: string;
  };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const tokenValue = (
  record: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return value;
    }
  }
  return null;
};

const runnerPayload = (payload: unknown) => {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root.raw) ?? root;
};

const normalizedTokenUsage = (
  provider: "codex" | "claude",
  usage: Record<string, unknown>,
): AgentExecutionTokenUsage | null => {
  const inputTokens = tokenValue(usage, "input_tokens", "inputTokens");
  const outputTokens = tokenValue(usage, "output_tokens", "outputTokens");
  const cacheReadTokens = tokenValue(
    usage,
    "cached_input_tokens",
    "cachedInputTokens",
    "cache_read_input_tokens",
    "cacheReadInputTokens",
    "cacheReadTokens",
  );
  const cacheWriteTokens = tokenValue(
    usage,
    "cache_write_input_tokens",
    "cacheWriteInputTokens",
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
    "cacheWriteTokens",
  );
  const reasoningOutputTokens = tokenValue(
    usage,
    "reasoning_output_tokens",
    "reasoningOutputTokens",
  );
  const explicitTotal = tokenValue(usage, "total_tokens", "totalTokens");
  if (
    inputTokens === null &&
    outputTokens === null &&
    cacheReadTokens === null &&
    cacheWriteTokens === null &&
    reasoningOutputTokens === null &&
    explicitTotal === null
  ) {
    return null;
  }
  const derivedTotal =
    provider === "claude"
      ? (inputTokens ?? 0) +
        (outputTokens ?? 0) +
        (cacheReadTokens ?? 0) +
        (cacheWriteTokens ?? 0)
      : (inputTokens ?? 0) + (outputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningOutputTokens,
    totalTokens: explicitTotal ?? derivedTotal,
  };
};

const dedupeKey = (...parts: Array<string | null>) =>
  parts.every((part) => part !== null) ? parts.join(":") : null;

const claudeIdentity = (message: Record<string, unknown>) => ({
  sessionId: nonEmptyString(message.session_id),
  turnId: null,
});

export function claudeExecutionUsageObservationsFromPayload(
  payload: unknown,
): AgentExecutionUsageObservation[] {
  const message = runnerPayload(payload);
  if (!message) return [];
  const type = nonEmptyString(message.type);
  const identity = claudeIdentity(message);

  if (type === "system" && message.subtype === "init") {
    const model = nonEmptyString(message.model);
    return model
      ? [
          {
            kind: "model",
            provider: "claude",
            model,
            canonicalModel: null,
            modelProvider: null,
            modelSource: "providerReported",
            source: "claude.init",
            scopeId: identity.sessionId,
            ...identity,
            dedupeKey: dedupeKey(
              "claude",
              "session",
              identity.sessionId,
              "model",
            ),
          },
        ]
      : [];
  }

  if (type === "assistant") {
    const assistant = asRecord(message.message);
    const model = nonEmptyString(assistant?.model);
    if (!model) return [];
    const messageId =
      nonEmptyString(assistant?.id) ?? nonEmptyString(message.uuid);
    const usage = asRecord(assistant?.usage);
    const tokenUsage = usage ? normalizedTokenUsage("claude", usage) : null;
    return tokenUsage
      ? [
          {
            kind: "delta",
            provider: "claude",
            model,
            canonicalModel: null,
            modelProvider: null,
            modelSource: "providerReported",
            tokenUsage,
            source: "claude.assistant.usage",
            scopeId: messageId,
            ...identity,
            dedupeKey: dedupeKey("claude", "message", messageId, "usage"),
          },
        ]
      : [
          {
            kind: "model",
            provider: "claude",
            model,
            canonicalModel: null,
            modelProvider: null,
            modelSource: "providerReported",
            source: "claude.assistant",
            scopeId: messageId,
            ...identity,
            dedupeKey: dedupeKey("claude", "message", messageId, "model"),
          },
        ];
  }

  if (type !== "result") return [];

  // A resumed `query()` keeps the same session id but emits a new result UUID.
  // Result usage covers that query invocation, so the UUID prevents a later
  // continuation from replacing an earlier invocation in the collector.
  const resultScopeId = nonEmptyString(message.uuid) ?? identity.sessionId;
  const modelUsage = asRecord(message.modelUsage);
  if (modelUsage) {
    const observations = Object.entries(modelUsage).flatMap(
      ([reportedModel, value]): AgentExecutionUsageObservation[] => {
        const usageRecord = asRecord(value);
        const model = nonEmptyString(reportedModel);
        if (!usageRecord || !model) return [];
        const tokenUsage = normalizedTokenUsage("claude", usageRecord);
        if (!tokenUsage) return [];
        return [
          {
            kind: "cumulative",
            provider: "claude",
            model,
            canonicalModel: nonEmptyString(usageRecord.canonicalModel),
            modelProvider: nonEmptyString(usageRecord.provider),
            modelSource: "providerReported",
            tokenUsage,
            source: "claude.result.modelUsage",
            scopeId: resultScopeId,
            ...identity,
            dedupeKey: dedupeKey(
              "claude",
              "session",
              resultScopeId,
              "model",
              model,
              "usage",
            ),
          },
        ];
      },
    );
    if (observations.length > 0) return observations;
  }

  const usage = asRecord(message.usage);
  const tokenUsage = usage ? normalizedTokenUsage("claude", usage) : null;
  return tokenUsage
    ? [
        {
          kind: "cumulative",
          provider: "claude",
          model: null,
          canonicalModel: null,
          modelProvider: null,
          modelSource: "unknown",
          tokenUsage,
          source: "claude.result.usage",
          scopeId: resultScopeId,
          ...identity,
          dedupeKey: dedupeKey("claude", "session", resultScopeId, "usage"),
        },
      ]
    : [];
}

const codexIdentity = (params: Record<string, unknown> | null) => ({
  sessionId: nonEmptyString(params?.threadId),
  turnId: nonEmptyString(params?.turnId),
});

export function codexExecutionUsageObservationsFromPayload(
  payload: unknown,
): AgentExecutionUsageObservation[] {
  const message = runnerPayload(payload);
  if (!message) return [];
  const method = nonEmptyString(message.method);
  const params = asRecord(message.params);
  const identity = codexIdentity(params);

  if (method === "turn/start") {
    const model = nonEmptyString(params?.model);
    return model
      ? [
          {
            kind: "model",
            provider: "codex",
            model,
            canonicalModel: null,
            modelProvider: null,
            modelSource: "configuredFallback",
            source: "codex.turnRequest",
            scopeId: identity.sessionId,
            ...identity,
            dedupeKey: dedupeKey(
              "codex",
              "thread",
              identity.sessionId,
              "turn-request",
              "model",
            ),
          },
        ]
      : [];
  }

  if (method === "model/rerouted") {
    const model = nonEmptyString(params?.toModel);
    return model
      ? [
          {
            kind: "model",
            provider: "codex",
            model,
            canonicalModel: null,
            modelProvider: null,
            modelSource: "providerReported",
            source: "codex.rerouted",
            scopeId: identity.turnId ?? identity.sessionId,
            ...identity,
            dedupeKey: dedupeKey("codex", "turn", identity.turnId, "model"),
          },
        ]
      : [];
  }

  if (method === "thread/settings/updated") {
    const settings =
      asRecord(params?.threadSettings) ?? asRecord(params?.settings);
    const model = nonEmptyString(settings?.model);
    return model
      ? [
          {
            kind: "model",
            provider: "codex",
            model,
            canonicalModel: null,
            modelProvider: nonEmptyString(settings?.modelProvider),
            modelSource: "providerReported",
            source: "codex.threadSettings",
            scopeId: identity.sessionId,
            ...identity,
            dedupeKey: dedupeKey(
              "codex",
              "thread",
              identity.sessionId,
              "model",
            ),
          },
        ]
      : [];
  }

  if (method === "thread/tokenUsage/updated") {
    const tokenUsageSnapshot = asRecord(params?.tokenUsage);
    const usage = asRecord(tokenUsageSnapshot?.last);
    const tokenUsage = usage ? normalizedTokenUsage("codex", usage) : null;
    return tokenUsage
      ? [
          {
            kind: "delta",
            provider: "codex",
            model: null,
            canonicalModel: null,
            modelProvider: null,
            modelSource: "unknown",
            tokenUsage,
            source: "codex.threadTokenUsage",
            scopeId: identity.turnId ?? identity.sessionId,
            ...identity,
            dedupeKey: dedupeKey("codex", "turn", identity.turnId, "usage"),
          },
        ]
      : [];
  }

  const result = asRecord(message.result);
  const config = asRecord(result?.config);
  const configModel = nonEmptyString(config?.model);
  if (config && configModel) {
    return [
      {
        kind: "model",
        provider: "codex",
        model: configModel,
        canonicalModel: null,
        modelProvider:
          nonEmptyString(config.model_provider) ??
          nonEmptyString(config.modelProvider),
        modelSource: "providerConfig",
        source: "codex.config",
        scopeId: "config",
        sessionId: null,
        turnId: null,
        dedupeKey: "codex:config:model",
      },
    ];
  }

  const defaultModel = Array.isArray(result?.data)
    ? result.data
        .map(asRecord)
        .find((candidate) => candidate?.isDefault === true)
    : null;
  const defaultModelName =
    nonEmptyString(defaultModel?.model) ?? nonEmptyString(defaultModel?.id);
  if (defaultModelName) {
    return [
      {
        kind: "model",
        provider: "codex",
        model: defaultModelName,
        canonicalModel: null,
        modelProvider: null,
        modelSource: "providerConfig",
        source: "codex.modelDefault",
        scopeId: "default",
        sessionId: null,
        turnId: null,
        dedupeKey: "codex:default:model",
      },
    ];
  }

  const thread = asRecord(result?.thread);
  const resultModel = nonEmptyString(result?.model);
  const resultModelProvider = nonEmptyString(result?.modelProvider);
  const threadId = nonEmptyString(thread?.id);
  if (thread && (resultModel || resultModelProvider)) {
    return [
      {
        kind: "model",
        provider: "codex",
        model: resultModel,
        canonicalModel: null,
        modelProvider: resultModelProvider,
        modelSource: resultModel ? "providerReported" : "unknown",
        source: "codex.thread",
        scopeId: threadId,
        sessionId: threadId,
        turnId: null,
        dedupeKey: dedupeKey("codex", "thread", threadId, "model"),
      },
    ];
  }

  // Compatibility with App Server versions that attached turn usage directly
  // to turn/completed rather than publishing thread/tokenUsage/updated.
  const turn = asRecord(params?.turn);
  const directUsage =
    asRecord(turn?.usage) ??
    asRecord(params?.usage) ??
    (message.type === "turn.completed" ? asRecord(message.usage) : null);
  const tokenUsage = directUsage
    ? normalizedTokenUsage("codex", directUsage)
    : null;
  const directTurnId = nonEmptyString(turn?.id) ?? identity.turnId;
  return tokenUsage
    ? [
        {
          kind: "delta",
          provider: "codex",
          model: null,
          canonicalModel: null,
          modelProvider: null,
          modelSource: "unknown",
          tokenUsage,
          source: "codex.turnUsage",
          scopeId: directTurnId ?? identity.sessionId,
          sessionId: identity.sessionId,
          turnId: directTurnId,
          dedupeKey: dedupeKey("codex", "turn", directTurnId, "usage"),
        },
      ]
    : [];
}

export function agentExecutionUsageObservationsFromPayload(
  provider: AgentExecutionUsageProvider,
  payload: unknown,
): AgentExecutionUsageObservation[] {
  if (provider === "claude") {
    return claudeExecutionUsageObservationsFromPayload(payload);
  }
  if (provider === "codex") {
    return codexExecutionUsageObservationsFromPayload(payload);
  }
  // OpenCode and Grok get native adapters in the provider-support PR. Do not
  // guess at their payload shapes through the Claude/Codex field names.
  return [];
}

const aggregateTokenUsage = (
  observations: AgentExecutionUsageObservation[],
): AgentExecutionTokenUsage | null => {
  const usage = observations.flatMap((observation) =>
    observation.kind === "model" ? [] : [observation.tokenUsage],
  );
  if (usage.length === 0) return null;
  const total = (key: keyof AgentExecutionTokenUsage) => {
    const values = usage.flatMap((item) =>
      item[key] === null ? [] : [item[key]],
    );
    return values.length > 0
      ? values.reduce((sum, value) => sum + value, 0)
      : null;
  };
  return {
    inputTokens: total("inputTokens"),
    outputTokens: total("outputTokens"),
    cacheReadTokens: total("cacheReadTokens"),
    cacheWriteTokens: total("cacheWriteTokens"),
    reasoningOutputTokens: total("reasoningOutputTokens"),
    totalTokens: total("totalTokens"),
  };
};

export type AgentExecutionUsageCollector = {
  observe: (payload: unknown, observedAt?: string) => void;
  finish: () => AgentExecutionCollectedTokenObservation[];
};

/**
 * Correlates provider model events with token events and hides replay/replacement
 * semantics from persistence. The collector is scoped to one Briar attempt.
 */
export function createAgentExecutionUsageCollector(
  provider: AgentExecutionUsageProvider,
  options: { configuredModel?: string | null } = {},
): AgentExecutionUsageCollector {
  let currentModel = nonEmptyString(options.configuredModel);
  let currentModelSource: AgentExecutionUsageObservationBase["modelSource"] =
    currentModel ? "configuredFallback" : "unknown";
  let currentCanonicalModel: string | null = null;
  let currentModelProvider: string | null = null;
  let sequence = 0;
  const collected = new Map<
    string,
    AgentExecutionCollectedTokenObservation
  >();
  const claudeQueryDeltaKeys = new Set<string>();
  let claudeQueryHasCumulativeUsage = false;

  const observe = (
    payload: unknown,
    observedAt = new Date().toISOString(),
  ) => {
    const normalizedObservedAt = observedAtSchema.parse(observedAt);
    const observations = agentExecutionUsageObservationsFromPayload(
      provider,
      payload,
    );
    observations.forEach((observation) => {
      if (observation.kind === "model") {
        if (
          observation.provider === "claude" &&
          observation.source === "claude.init"
        ) {
          claudeQueryDeltaKeys.clear();
          claudeQueryHasCumulativeUsage = false;
        }
        if (observation.model) currentModel = observation.model;
        if (observation.modelSource !== "unknown") {
          currentModelSource = observation.modelSource;
        }
        currentCanonicalModel = observation.canonicalModel;
        currentModelProvider =
          observation.modelProvider ?? currentModelProvider;
        if (
          observation.provider === "codex" &&
          observation.source === "codex.rerouted" &&
          observation.model &&
          observation.turnId
        ) {
          for (const [key, existing] of collected) {
            if (
              existing.provider === "codex" &&
              existing.turnId === observation.turnId
            ) {
              collected.set(key, {
                ...existing,
                model: observation.model,
                modelSource: observation.modelSource,
                modelProvider:
                  observation.modelProvider ?? existing.modelProvider,
              });
            }
          }
        }
        return observation;
      }

      const enriched: AgentExecutionTokenObservation = {
        ...observation,
        model: observation.model ?? currentModel,
        canonicalModel: observation.canonicalModel ?? currentCanonicalModel,
        modelProvider: observation.modelProvider ?? currentModelProvider,
        modelSource:
          observation.modelSource === "unknown"
            ? currentModelSource
            : observation.modelSource,
      };
      if (observation.model) currentModel = observation.model;
      if (observation.modelSource !== "unknown") {
        currentModelSource = observation.modelSource;
      }
      if (observation.canonicalModel) {
        currentCanonicalModel = observation.canonicalModel;
      }
      if (observation.modelProvider) {
        currentModelProvider = observation.modelProvider;
      }

      if (enriched.provider === "claude" && enriched.kind === "cumulative") {
        for (const key of claudeQueryDeltaKeys) collected.delete(key);
        claudeQueryDeltaKeys.clear();
        claudeQueryHasCumulativeUsage = true;
      }
      if (enriched.provider === "claude" && enriched.kind === "delta") {
        if (claudeQueryHasCumulativeUsage) return enriched;
      }

      const key = enriched.dedupeKey ?? `${provider}:observation:${sequence++}`;
      collected.set(key, {
        ...enriched,
        dedupeKey: key,
        // Provider replays replace an existing record without moving its
        // occurrence into the time window of the retry.
        observedAt: collected.get(key)?.observedAt ?? normalizedObservedAt,
      });
      if (enriched.provider === "claude" && enriched.kind === "delta") {
        claudeQueryDeltaKeys.add(key);
      }
      return enriched;
    });
  };

  return { observe, finish: () => [...collected.values()] };
}

/**
 * Convert normalized provider observations into the immutable ingestion
 * contract. Codex includes cached input in inputTokens, while Claude reports
 * cache reads and writes as separate buckets.
 */
export function agentExecutionUsageRecordsFromObservations(
  observations: AgentExecutionCollectedTokenObservation[],
): AgentExecutionUsageRecord[] {
  return observations.map((observation) => {
    const usage = observation.tokenUsage;
    const uncachedInputTokens = usage.inputTokens === null
      ? null
      : observation.provider === "codex"
        ? Math.max(
            0,
            usage.inputTokens -
              (usage.cacheReadTokens ?? 0) -
              (usage.cacheWriteTokens ?? 0),
          )
        : usage.inputTokens;
    return {
      usageKey: observation.dedupeKey,
      sessionId: observation.sessionId,
      scopeId: observation.scopeId,
      turnId: observation.turnId,
      agentProvider: observation.provider,
      modelProvider: observation.modelProvider,
      model: observation.model,
      canonicalModel: observation.canonicalModel,
      modelSource: observation.modelSource,
      source: observation.source,
      uncachedInputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningOutputTokens: usage.reasoningOutputTokens,
      totalTokens: usage.totalTokens,
      observedAt: observation.observedAt,
    } satisfies AgentExecutionUsageRecord;
  });
}

export function agentExecutionTokenUsageFromObservations(
  observations: AgentExecutionTokenObservation[],
): AgentExecutionTokenUsage | null {
  return aggregateTokenUsage(observations);
}

/**
 * Compatibility wrapper for the pre-ledger execution metrics path. New usage
 * ingestion should retain every observation so per-model totals are not lost.
 */
export function agentExecutionTokenUsageFromPayload(
  provider: AgentExecutionUsageProvider,
  payload: unknown,
): AgentExecutionTokenUsage | null {
  return aggregateTokenUsage(
    agentExecutionUsageObservationsFromPayload(provider, payload),
  );
}

export const agentExecutionMetrics = (
  durationMs: number,
  usage: AgentExecutionTokenUsage | null,
): AgentExecutionMetrics => ({
  inputTokens: usage?.inputTokens ?? null,
  outputTokens: usage?.outputTokens ?? null,
  cacheReadTokens: usage?.cacheReadTokens ?? null,
  cacheWriteTokens: usage?.cacheWriteTokens ?? null,
  reasoningOutputTokens: usage?.reasoningOutputTokens ?? null,
  totalTokens: usage?.totalTokens ?? null,
  durationMs: Math.max(0, Math.round(durationMs)),
});

export function formatExecutionDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export const formatExecutionTokens = (tokens: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    notation: tokens >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(tokens);
