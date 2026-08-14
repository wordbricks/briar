import { z } from "zod";
import { agentProviders, type AgentProvider } from "./agent-provider-contract";
import {
  AGENT_EXECUTION_USD_TICKS_PER_DOLLAR,
  type AgentExecutionCostRecord,
} from "./agent-execution-cost";

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
  provider: AgentProvider;
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
      | "agy.init"
      | "codex.config"
      | "codex.modelDefault"
      | "codex.thread"
      | "codex.turnRequest"
      | "codex.threadSettings"
      | "codex.rerouted"
      | "opencode.assistant"
      | "grok.session"
      | "grok.sessionNew"
      | "grok.sessionLoad"
      | "grok.modelSet";
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
      | "agy.result.usage"
      | "codex.threadTokenUsage"
      | "codex.turnUsage"
      | "opencode.step.usage"
      | "opencode.assistant.usage"
      | "grok.turnCompleted.modelUsage"
      | "grok.turnCompleted.usage"
      | "grok.prompt.metaModelUsage"
      | "grok.prompt.metaUsage"
      | "grok.prompt.usage";
  };

export type AgentExecutionUsageObservation =
  AgentExecutionModelObservation | AgentExecutionTokenObservation;

export type AgentExecutionCostObservation =
  AgentExecutionUsageObservationBase & {
    kind: "cost";
    amountUsdTicks: number;
    usageKey: string | null;
    source:
      | "claude.result.modelUsage.costUSD"
      | "claude.result.total_cost_usd"
      | "opencode.step.cost"
      | "opencode.assistant.cost"
      | "grok.usageUpdate.cost"
      | "grok.prompt.costUsdTicks"
      | "grok.prompt.metaCostUsdTicks"
      | "grok.prompt.metaModelUsage.costUsdTicks"
      | "grok.turnCompleted.costUsdTicks"
      | "grok.turnCompleted.modelUsage.costUsdTicks";
  };

export type AgentExecutionCollectedCostObservation =
  AgentExecutionCostObservation & {
    dedupeKey: string;
    observedAt: string;
  };

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

const tokenSum = (...values: Array<number | null>): number | null => {
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
};

const usdAmountToTicks = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const ticks = Math.round(value * AGENT_EXECUTION_USD_TICKS_PER_DOLLAR);
  return Number.isSafeInteger(ticks) && ticks >= 0 ? ticks : null;
};

const exactUsdTicks = (record: Record<string, unknown>): number | null =>
  tokenValue(record, "costUsdTicks", "cost_usd_ticks");

const runnerPayload = (payload: unknown) => {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root.raw) ?? root;
};

const normalizedTokenUsage = (
  provider: "codex" | "claude" | "agy",
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
    "cache_read_tokens",
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
    "thinking_tokens",
    "thinkingTokens",
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

type CodexTokenUsageSnapshot = {
  last: AgentExecutionTokenUsage;
  total: AgentExecutionTokenUsage | null;
};

const codexTokenUsageSnapshotFromPayload = (
  payload: unknown,
): CodexTokenUsageSnapshot | null => {
  const message = runnerPayload(payload);
  if (
    !message ||
    nonEmptyString(message.method) !== "thread/tokenUsage/updated"
  ) {
    return null;
  }
  const params = asRecord(message.params);
  const snapshot = asRecord(params?.tokenUsage);
  const rawLast = asRecord(snapshot?.last);
  const last = rawLast ? normalizedTokenUsage("codex", rawLast) : null;
  if (!last) return null;
  const rawTotal = asRecord(snapshot?.total);
  return {
    last,
    total: rawTotal ? normalizedTokenUsage("codex", rawTotal) : null,
  };
};

const tokenCountDifference = (
  total: number | null,
  baseline: number | null,
  fallback: number | null | undefined = null,
) =>
  total !== null && baseline !== null && total >= baseline
    ? total - baseline
    : (fallback ?? null);

const tokenUsageDifference = (
  total: AgentExecutionTokenUsage,
  baseline: AgentExecutionTokenUsage,
  fallback?: AgentExecutionTokenUsage,
): AgentExecutionTokenUsage => ({
  inputTokens: tokenCountDifference(
    total.inputTokens,
    baseline.inputTokens,
    fallback?.inputTokens,
  ),
  outputTokens: tokenCountDifference(
    total.outputTokens,
    baseline.outputTokens,
    fallback?.outputTokens,
  ),
  cacheReadTokens: tokenCountDifference(
    total.cacheReadTokens,
    baseline.cacheReadTokens,
    fallback?.cacheReadTokens,
  ),
  cacheWriteTokens: tokenCountDifference(
    total.cacheWriteTokens,
    baseline.cacheWriteTokens,
    fallback?.cacheWriteTokens,
  ),
  reasoningOutputTokens: tokenCountDifference(
    total.reasoningOutputTokens,
    baseline.reasoningOutputTokens,
    fallback?.reasoningOutputTokens,
  ),
  totalTokens: tokenCountDifference(
    total.totalTokens,
    baseline.totalTokens,
    fallback?.totalTokens,
  ),
});

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

export function agyExecutionUsageObservationsFromPayload(
  payload: unknown,
): AgentExecutionUsageObservation[] {
  const message = runnerPayload(payload);
  if (!message) return [];
  const event = nonEmptyString(message.event) ?? nonEmptyString(message.type);
  if (event === "init") {
    const init = asRecord(message.init);
    const sessionId = nonEmptyString(message.conversation_id);
    const model = nonEmptyString(init?.model);
    return model
      ? [
          {
            kind: "model",
            provider: "agy",
            model,
            canonicalModel: null,
            modelProvider: "google",
            modelSource: "providerReported",
            source: "agy.init",
            scopeId: sessionId,
            sessionId,
            turnId: null,
            dedupeKey: dedupeKey("agy", "session", sessionId, "model"),
          },
        ]
      : [];
  }
  if (event !== "result") return [];
  const result = asRecord(message.result);
  const sessionId = nonEmptyString(result?.conversation_id);
  const usage = asRecord(result?.usage);
  const tokenUsage = usage ? normalizedTokenUsage("agy", usage) : null;
  return tokenUsage
    ? [
        {
          kind: "delta",
          provider: "agy",
          model: null,
          canonicalModel: null,
          modelProvider: "google",
          modelSource: "unknown",
          tokenUsage,
          source: "agy.result.usage",
          scopeId: sessionId,
          sessionId,
          turnId: null,
          // A runner may attach the same raw result to multiple normalized
          // terminal events. The collector is scoped to one Briar attempt, so
          // the session result key safely collapses those copies.
          dedupeKey: dedupeKey("agy", "session", sessionId, "result", "usage"),
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
    const tokenUsage = codexTokenUsageSnapshotFromPayload(payload)?.last ?? null;
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

const openCodeTokenUsage = (
  tokens: Record<string, unknown>,
): AgentExecutionTokenUsage | null => {
  const cache = asRecord(tokens.cache);
  const inputTokens = tokenValue(tokens, "input");
  const rawOutputTokens = tokenValue(tokens, "output");
  const reasoningOutputTokens = tokenValue(tokens, "reasoning");
  const cacheReadTokens = cache ? tokenValue(cache, "read") : null;
  const cacheWriteTokens = cache ? tokenValue(cache, "write") : null;
  const explicitTotal = tokenValue(tokens, "total");
  if (
    inputTokens === null &&
    rawOutputTokens === null &&
    reasoningOutputTokens === null &&
    cacheReadTokens === null &&
    cacheWriteTokens === null &&
    explicitTotal === null
  ) {
    return null;
  }

  // OpenCode stores uncached input and reasoning as disjoint buckets. Briar's
  // canonical contract keeps reasoning as a subset of output instead.
  const outputTokens =
    rawOutputTokens === null && reasoningOutputTokens === null
      ? null
      : tokenSum(rawOutputTokens, reasoningOutputTokens);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningOutputTokens,
    totalTokens:
      explicitTotal ??
      tokenSum(
        inputTokens,
        rawOutputTokens,
        reasoningOutputTokens,
        cacheReadTokens,
        cacheWriteTokens,
      ),
  };
};

const openCodeAssistantObservations = (
  assistant: Record<string, unknown>,
  includeUsage: boolean,
): AgentExecutionUsageObservation[] => {
  if (assistant.role !== "assistant") return [];
  const messageId = nonEmptyString(assistant.id);
  const sessionId = nonEmptyString(assistant.sessionID);
  const turnId = nonEmptyString(assistant.parentID);
  const model = nonEmptyString(assistant.modelID);
  const modelProvider = nonEmptyString(assistant.providerID);
  const observations: AgentExecutionUsageObservation[] = [];

  if (model) {
    observations.push({
      kind: "model",
      provider: "opencode",
      model,
      canonicalModel: null,
      modelProvider,
      modelSource: "providerReported",
      source: "opencode.assistant",
      scopeId: messageId,
      sessionId,
      turnId,
      dedupeKey: dedupeKey("opencode", "message", messageId, "model"),
    });
  }

  const tokens = includeUsage ? asRecord(assistant.tokens) : null;
  const tokenUsage = tokens ? openCodeTokenUsage(tokens) : null;
  if (tokenUsage) {
    observations.push({
      kind: "delta",
      provider: "opencode",
      model,
      canonicalModel: null,
      modelProvider,
      modelSource: model ? "providerReported" : "unknown",
      tokenUsage,
      source: "opencode.assistant.usage",
      scopeId: messageId,
      sessionId,
      turnId,
      dedupeKey: dedupeKey("opencode", "message", messageId, "usage"),
    });
  }
  return observations;
};

const openCodeStepObservation = (
  part: Record<string, unknown>,
): AgentExecutionTokenObservation | null => {
  if (part.type !== "step-finish") return null;
  const tokens = asRecord(part.tokens);
  const tokenUsage = tokens ? openCodeTokenUsage(tokens) : null;
  if (!tokenUsage) return null;
  const partId = nonEmptyString(part.id);
  const messageId = nonEmptyString(part.messageID);
  const sessionId = nonEmptyString(part.sessionID);
  return {
    kind: "delta",
    provider: "opencode",
    model: null,
    canonicalModel: null,
    modelProvider: null,
    modelSource: "unknown",
    tokenUsage,
    source: "opencode.step.usage",
    scopeId: messageId,
    sessionId,
    turnId: null,
    dedupeKey: dedupeKey("opencode", "part", partId, "usage"),
  };
};

export function openCodeExecutionUsageObservationsFromPayload(
  payload: unknown,
): AgentExecutionUsageObservation[] {
  const message = runnerPayload(payload);
  if (!message) return [];

  const properties = asRecord(message.properties);
  const eventAssistant =
    message.type === "message.updated" ? asRecord(properties?.info) : null;
  const responseAssistant = asRecord(message.info);
  const directAssistant = message.role === "assistant" ? message : null;
  const assistant = eventAssistant ?? responseAssistant ?? directAssistant;

  const parts: Record<string, unknown>[] = [];
  if (message.type === "message.part.updated") {
    const part = asRecord(properties?.part);
    if (part) parts.push(part);
  } else if (message.type === "step-finish") {
    parts.push(message);
  }
  if (Array.isArray(message.parts)) {
    parts.push(
      ...message.parts.flatMap((part) => {
        const record = asRecord(part);
        return record ? [record] : [];
      }),
    );
  }

  const stepObservations = parts.flatMap((part) => {
    const observation = openCodeStepObservation(part);
    return observation ? [observation] : [];
  });
  const assistantId = nonEmptyString(assistant?.id);
  const hasAssistantStep = stepObservations.some(
    (observation) =>
      assistantId === null || observation.scopeId === assistantId,
  );
  return [
    ...(assistant
      ? openCodeAssistantObservations(assistant, !hasAssistantStep)
      : []),
    ...stepObservations,
  ];
}

const grokTokenUsage = (
  usage: Record<string, unknown>,
  thoughtTokensAreSeparate: boolean,
): AgentExecutionTokenUsage | null => {
  const inputTokens = tokenValue(usage, "inputTokens", "input_tokens");
  const rawOutputTokens = tokenValue(usage, "outputTokens", "output_tokens");
  const proprietaryReasoningTokens = tokenValue(
    usage,
    "reasoningTokens",
    "reasoningOutputTokens",
    "reasoning_output_tokens",
  );
  const thoughtTokens = tokenValue(usage, "thoughtTokens", "thought_tokens");
  const reasoningOutputTokens = proprietaryReasoningTokens ?? thoughtTokens;
  const cacheReadTokens = tokenValue(
    usage,
    "cachedReadTokens",
    "cacheReadTokens",
    "cached_read_tokens",
  );
  const cacheWriteTokens = tokenValue(
    usage,
    "cacheCreationTokens",
    "cachedWriteTokens",
    "cacheWriteTokens",
    "cached_write_tokens",
  );
  const explicitTotal = tokenValue(usage, "totalTokens", "total_tokens");
  if (
    inputTokens === null &&
    rawOutputTokens === null &&
    reasoningOutputTokens === null &&
    cacheReadTokens === null &&
    cacheWriteTokens === null &&
    explicitTotal === null
  ) {
    return null;
  }

  // xAI's private turn_completed payload includes reasoning in output. The
  // standard ACP PromptResponse names a separate thoughtTokens bucket, which
  // must be folded into Briar's canonical output bucket.
  const outputTokens = thoughtTokensAreSeparate
    ? rawOutputTokens === null && thoughtTokens === null
      ? null
      : tokenSum(rawOutputTokens, thoughtTokens)
    : rawOutputTokens === null && reasoningOutputTokens === null
      ? null
      : Math.max(rawOutputTokens ?? 0, reasoningOutputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningOutputTokens,
    // Grok input includes cache reads/writes, while reasoning is already in
    // output for the private payload (and folded into it above for ACP).
    totalTokens: explicitTotal ?? tokenSum(inputTokens, outputTokens),
  };
};

const grokPromptIdentifier = (
  ...records: Array<Record<string, unknown> | null>
): string | null => {
  for (const record of records) {
    if (!record) continue;
    const value =
      nonEmptyString(record.userMessageId) ??
      nonEmptyString(record.messageId) ??
      nonEmptyString(record.prompt_id) ??
      nonEmptyString(record.promptId) ??
      nonEmptyString(record.requestId) ??
      nonEmptyString(record.eventId);
    if (value) return value;
  }
  return null;
};

const grokPromptAggregateObservations = (input: {
  usage: Record<string, unknown>;
  sessionId: string | null;
  promptId: string | null;
  fallbackModel?: string | null;
  modelUsageSource:
    "grok.turnCompleted.modelUsage" | "grok.prompt.metaModelUsage";
  usageSource: "grok.turnCompleted.usage" | "grok.prompt.metaUsage";
}): AgentExecutionUsageObservation[] => {
  const modelUsage = asRecord(input.usage.modelUsage);
  if (modelUsage) {
    const observations = Object.entries(modelUsage).flatMap(
      ([reportedModel, value]): AgentExecutionUsageObservation[] => {
        const model = nonEmptyString(reportedModel);
        const usageRecord = asRecord(value);
        const tokenUsage = usageRecord
          ? grokTokenUsage(usageRecord, false)
          : null;
        if (!model || !tokenUsage) return [];
        return [
          {
            kind: "delta",
            provider: "grok",
            model,
            canonicalModel: null,
            modelProvider: "xai",
            modelSource: "providerReported",
            tokenUsage,
            source: input.modelUsageSource,
            scopeId: input.promptId,
            sessionId: input.sessionId,
            turnId: input.promptId,
            dedupeKey: dedupeKey(
              "grok",
              "session",
              input.sessionId,
              "prompt",
              input.promptId,
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

  const tokenUsage = grokTokenUsage(input.usage, false);
  return tokenUsage
    ? [
        {
          kind: "delta",
          provider: "grok",
          model: input.fallbackModel ?? null,
          canonicalModel: null,
          modelProvider: "xai",
          modelSource: input.fallbackModel ? "providerReported" : "unknown",
          tokenUsage,
          source: input.usageSource,
          scopeId: input.promptId,
          sessionId: input.sessionId,
          turnId: input.promptId,
          dedupeKey: dedupeKey(
            "grok",
            "session",
            input.sessionId,
            "prompt",
            input.promptId,
            "usage",
          ),
        },
      ]
    : [];
};

const grokTurnCompletedObservations = (
  message: Record<string, unknown>,
): AgentExecutionUsageObservation[] | null => {
  const params = asRecord(message.params) ?? message;
  const update = asRecord(params.update);
  if (update?.sessionUpdate !== "turn_completed") return null;
  const paramsMeta = asRecord(params._meta);
  const updateMeta = asRecord(update._meta);
  if (paramsMeta?.isReplay === true || updateMeta?.isReplay === true) {
    return [];
  }

  const usage = asRecord(update.usage);
  if (!usage) return [];
  const sessionId = nonEmptyString(params.sessionId);
  const promptId = grokPromptIdentifier(update, paramsMeta, updateMeta);
  return grokPromptAggregateObservations({
    usage,
    sessionId,
    promptId,
    modelUsageSource: "grok.turnCompleted.modelUsage",
    usageSource: "grok.turnCompleted.usage",
  });
};

const grokPromptResultObservations = (
  message: Record<string, unknown>,
): AgentExecutionUsageObservation[] | null => {
  const method = nonEmptyString(message.method);
  const directPromptResponse =
    method === null && nonEmptyString(message.stopReason) !== null;
  if (method !== "session/prompt" && !directPromptResponse) return null;
  const params = asRecord(message.params);
  const result =
    method === "session/prompt" ? asRecord(message.result) : message;
  if (!result) return [];
  const paramsMeta = asRecord(params?._meta);
  const resultMeta = asRecord(result._meta);
  // The client-generated prompt/request id is also echoed by xAI's private
  // turn_completed notification. Prefer it over an agent-assigned userMessageId
  // so the private aggregate can replace this standards fallback.
  const promptId = grokPromptIdentifier(paramsMeta, params, resultMeta, result);
  const sessionId =
    nonEmptyString(params?.sessionId) ?? nonEmptyString(result.sessionId);
  const resultModel =
    nonEmptyString(resultMeta?.modelId) ?? nonEmptyString(result.model);
  const metaUsage = asRecord(resultMeta?.usage);
  if (metaUsage) {
    return grokPromptAggregateObservations({
      usage: metaUsage,
      sessionId,
      promptId,
      fallbackModel: resultModel,
      modelUsageSource: "grok.prompt.metaModelUsage",
      usageSource: "grok.prompt.metaUsage",
    });
  }

  const usage = asRecord(result.usage);
  const tokenUsage = usage ? grokTokenUsage(usage, true) : null;
  if (!tokenUsage) return [];
  return [
    {
      kind: "delta",
      provider: "grok",
      model: resultModel,
      canonicalModel: null,
      modelProvider: "xai",
      modelSource: resultModel ? "providerReported" : "unknown",
      tokenUsage,
      source: "grok.prompt.usage",
      scopeId: promptId,
      sessionId,
      turnId: promptId,
      dedupeKey: dedupeKey(
        "grok",
        "session",
        sessionId,
        "prompt",
        promptId,
        "usage",
      ),
    },
  ];
};

const grokModelObservation = (
  message: Record<string, unknown>,
): AgentExecutionModelObservation | null => {
  const method = nonEmptyString(message.method);
  const params = asRecord(message.params);
  const result = asRecord(message.result);
  const resultModels = asRecord(result?.models);
  const resultMeta = asRecord(result?._meta);
  const metaModelState = asRecord(resultMeta?.modelState);
  const sessionId =
    nonEmptyString(result?.sessionId) ??
    nonEmptyString(params?.sessionId) ??
    nonEmptyString(message.sessionId);

  let model: string | null = null;
  let source: AgentExecutionModelObservation["source"] = "grok.session";
  if (method === "session/set_model") {
    model = nonEmptyString(params?.modelId);
    source = "grok.modelSet";
  } else if (method === "session/new") {
    model =
      nonEmptyString(resultModels?.currentModelId) ??
      nonEmptyString(metaModelState?.currentModelId);
    source = "grok.sessionNew";
  } else if (method === "session/load") {
    model =
      nonEmptyString(resultModels?.currentModelId) ??
      nonEmptyString(metaModelState?.currentModelId);
    source = "grok.sessionLoad";
  } else if (
    method === "initialize" ||
    message.type === "session" ||
    resultModels !== null ||
    metaModelState !== null
  ) {
    model =
      nonEmptyString(resultModels?.currentModelId) ??
      nonEmptyString(metaModelState?.currentModelId) ??
      nonEmptyString(message.currentModelId) ??
      nonEmptyString(message.model);
  }
  const isSessionLifecycle =
    source === "grok.sessionNew" || source === "grok.sessionLoad";
  if (!model && (!isSessionLifecycle || !sessionId)) return null;
  const scopeId = sessionId ?? (method === "initialize" ? "initialize" : null);
  return {
    kind: "model",
    provider: "grok",
    model,
    canonicalModel: null,
    modelProvider: "xai",
    modelSource: !model
      ? "unknown"
      : source === "grok.modelSet"
        ? "providerConfig"
        : "providerReported",
    source,
    scopeId,
    sessionId,
    turnId: null,
    dedupeKey: sessionId
      ? dedupeKey("grok", "session", sessionId, "model")
      : method === "initialize"
        ? "grok:initialize:model"
        : null,
  };
};

export function grokExecutionUsageObservationsFromPayload(
  payload: unknown,
): AgentExecutionUsageObservation[] {
  const message = runnerPayload(payload);
  if (!message) return [];

  const turnCompleted = grokTurnCompletedObservations(message);
  if (turnCompleted !== null) return turnCompleted;
  const promptResult = grokPromptResultObservations(message);
  if (promptResult !== null) return promptResult;
  const model = grokModelObservation(message);
  return model ? [model] : [];
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
  if (provider === "agy") {
    return agyExecutionUsageObservationsFromPayload(payload);
  }
  if (provider === "opencode") {
    return openCodeExecutionUsageObservationsFromPayload(payload);
  }
  if (provider === "grok") {
    return grokExecutionUsageObservationsFromPayload(payload);
  }
  return [];
}

export function claudeExecutionCostObservationsFromPayload(
  payload: unknown,
): AgentExecutionCostObservation[] {
  const message = runnerPayload(payload);
  if (!message || message.type !== "result") return [];
  const sessionId = nonEmptyString(message.session_id);
  const scopeId = nonEmptyString(message.uuid) ?? sessionId;
  const modelUsage = asRecord(message.modelUsage);
  if (modelUsage) {
    const entries = Object.entries(modelUsage).flatMap(
      ([reportedModel, value]) => {
        const model = nonEmptyString(reportedModel);
        const usage = asRecord(value);
        return model && usage ? [{ model, usage }] : [];
      },
    );
    const complete =
      entries.length > 0 &&
      entries.every(
        ({ usage }) =>
          usdAmountToTicks(usage.costUSD ?? usage.costUsd) !== null,
      );
    if (complete) {
      return entries.map(({ model, usage }) => {
        const usageKey = normalizedTokenUsage("claude", usage)
          ? dedupeKey(
              "claude",
              "session",
              scopeId,
              "model",
              model,
              "usage",
            )
          : null;
        return {
          kind: "cost",
          provider: "claude",
          model,
          canonicalModel: nonEmptyString(usage.canonicalModel),
          modelProvider: nonEmptyString(usage.provider),
          modelSource: "providerReported",
          amountUsdTicks: usdAmountToTicks(usage.costUSD ?? usage.costUsd)!,
          usageKey,
          source: "claude.result.modelUsage.costUSD",
          scopeId,
          sessionId,
          turnId: null,
          dedupeKey: dedupeKey(
            "claude",
            "session",
            scopeId,
            "model",
            model,
            "cost",
          ),
        } satisfies AgentExecutionCostObservation;
      });
    }
  }

  const amountUsdTicks = usdAmountToTicks(
    message.total_cost_usd ?? message.totalCostUsd,
  );
  if (amountUsdTicks === null) return [];
  const usage = asRecord(message.usage);
  const hasModelUsageTokens = modelUsage
    ? Object.values(modelUsage).some((value) => {
        const modelUsageRecord = asRecord(value);
        return Boolean(
          modelUsageRecord &&
            normalizedTokenUsage("claude", modelUsageRecord),
        );
      })
    : false;
  const usageKey =
    !hasModelUsageTokens && usage && normalizedTokenUsage("claude", usage)
    ? dedupeKey("claude", "session", scopeId, "usage")
    : null;
  return [
    {
      kind: "cost",
      provider: "claude",
      model: null,
      canonicalModel: null,
      modelProvider: null,
      modelSource: "unknown",
      amountUsdTicks,
      usageKey,
      source: "claude.result.total_cost_usd",
      scopeId,
      sessionId,
      turnId: null,
      dedupeKey: dedupeKey("claude", "session", scopeId, "cost"),
    },
  ];
}

const openCodeAssistantCostObservation = (
  assistant: Record<string, unknown>,
): AgentExecutionCostObservation | null => {
  if (assistant.role !== "assistant") return null;
  const amountUsdTicks = usdAmountToTicks(assistant.cost);
  if (amountUsdTicks === null) return null;
  const messageId = nonEmptyString(assistant.id);
  const sessionId = nonEmptyString(assistant.sessionID);
  const turnId = nonEmptyString(assistant.parentID);
  const model = nonEmptyString(assistant.modelID);
  const tokens = asRecord(assistant.tokens);
  return {
    kind: "cost",
    provider: "opencode",
    model,
    canonicalModel: null,
    modelProvider: nonEmptyString(assistant.providerID),
    modelSource: model ? "providerReported" : "unknown",
    amountUsdTicks,
    usageKey:
      tokens && openCodeTokenUsage(tokens)
        ? dedupeKey("opencode", "message", messageId, "usage")
        : null,
    source: "opencode.assistant.cost",
    scopeId: messageId,
    sessionId,
    turnId,
    dedupeKey: dedupeKey("opencode", "message", messageId, "cost"),
  };
};

const openCodeStepCostObservation = (
  part: Record<string, unknown>,
): AgentExecutionCostObservation | null => {
  if (part.type !== "step-finish") return null;
  const amountUsdTicks = usdAmountToTicks(part.cost);
  if (amountUsdTicks === null) return null;
  const partId = nonEmptyString(part.id);
  const messageId = nonEmptyString(part.messageID);
  const sessionId = nonEmptyString(part.sessionID);
  const tokens = asRecord(part.tokens);
  return {
    kind: "cost",
    provider: "opencode",
    model: null,
    canonicalModel: null,
    modelProvider: null,
    modelSource: "unknown",
    amountUsdTicks,
    usageKey:
      tokens && openCodeTokenUsage(tokens)
        ? dedupeKey("opencode", "part", partId, "usage")
        : null,
    source: "opencode.step.cost",
    scopeId: messageId,
    sessionId,
    turnId: null,
    dedupeKey: dedupeKey("opencode", "part", partId, "cost"),
  };
};

export function openCodeExecutionCostObservationsFromPayload(
  payload: unknown,
): AgentExecutionCostObservation[] {
  const message = runnerPayload(payload);
  if (!message) return [];
  const properties = asRecord(message.properties);
  const eventAssistant =
    message.type === "message.updated" ? asRecord(properties?.info) : null;
  const responseAssistant = asRecord(message.info);
  const directAssistant = message.role === "assistant" ? message : null;
  const assistant = eventAssistant ?? responseAssistant ?? directAssistant;

  const parts: Record<string, unknown>[] = [];
  if (message.type === "message.part.updated") {
    const part = asRecord(properties?.part);
    if (part) parts.push(part);
  } else if (message.type === "step-finish") {
    parts.push(message);
  }
  if (Array.isArray(message.parts)) {
    parts.push(
      ...message.parts.flatMap((part) => {
        const record = asRecord(part);
        return record ? [record] : [];
      }),
    );
  }

  const stepCosts = parts.flatMap((part) => {
    const observation = openCodeStepCostObservation(part);
    return observation ? [observation] : [];
  });
  const assistantId = nonEmptyString(assistant?.id);
  const hasAssistantStepCost = stepCosts.some(
    (observation) =>
      assistantId === null || observation.scopeId === assistantId,
  );
  const assistantCost = assistant && !hasAssistantStepCost
    ? openCodeAssistantCostObservation(assistant)
    : null;
  return [...(assistantCost ? [assistantCost] : []), ...stepCosts];
}

const grokUsageCostIsIncomplete = (usage: Record<string, unknown>) =>
  usage.usageIsIncomplete === true ||
  usage.usage_is_incomplete === true ||
  usage.costIsPartial === true ||
  usage.cost_is_partial === true;

const grokPromptCostObservations = (input: {
  usage: Record<string, unknown>;
  sessionId: string | null;
  promptId: string | null;
  modelSource:
    | "grok.turnCompleted.modelUsage.costUsdTicks"
    | "grok.prompt.metaModelUsage.costUsdTicks";
  aggregateSource:
    | "grok.turnCompleted.costUsdTicks"
    | "grok.prompt.metaCostUsdTicks";
}): AgentExecutionCostObservation[] => {
  if (grokUsageCostIsIncomplete(input.usage)) return [];
  const modelUsage = asRecord(input.usage.modelUsage);
  if (modelUsage) {
    const entries = Object.entries(modelUsage).flatMap(
      ([reportedModel, value]) => {
        const model = nonEmptyString(reportedModel);
        const usage = asRecord(value);
        return model && usage ? [{ model, usage }] : [];
      },
    );
    const complete =
      entries.length > 0 &&
      entries.every(
        ({ usage }) =>
          !grokUsageCostIsIncomplete(usage) && exactUsdTicks(usage) !== null,
      );
    if (complete) {
      return entries.map(({ model, usage }) => {
        const tokenUsage = grokTokenUsage(usage, false);
        const usageKey = tokenUsage
          ? dedupeKey(
              "grok",
              "session",
              input.sessionId,
              "prompt",
              input.promptId,
              "model",
              model,
              "usage",
            )
          : null;
        return {
          kind: "cost",
          provider: "grok",
          model,
          canonicalModel: null,
          modelProvider: "xai",
          modelSource: "providerReported",
          amountUsdTicks: exactUsdTicks(usage)!,
          usageKey,
          source: input.modelSource,
          scopeId: input.promptId,
          sessionId: input.sessionId,
          turnId: input.promptId,
          dedupeKey: dedupeKey(
            "grok",
            "session",
            input.sessionId,
            "prompt",
            input.promptId,
            "model",
            model,
            "cost",
          ),
        } satisfies AgentExecutionCostObservation;
      });
    }
  }

  const amountUsdTicks = exactUsdTicks(input.usage);
  if (amountUsdTicks === null) return [];
  const tokenUsage = grokTokenUsage(input.usage, false);
  const hasModelUsageTokens = modelUsage
    ? Object.values(modelUsage).some((value) => {
        const modelUsageRecord = asRecord(value);
        return Boolean(
          modelUsageRecord && grokTokenUsage(modelUsageRecord, false),
        );
      })
    : false;
  return [
    {
      kind: "cost",
      provider: "grok",
      model: null,
      canonicalModel: null,
      modelProvider: "xai",
      modelSource: "unknown",
      amountUsdTicks,
      usageKey: tokenUsage && !hasModelUsageTokens
        ? dedupeKey(
            "grok",
            "session",
            input.sessionId,
            "prompt",
            input.promptId,
            "usage",
          )
        : null,
      source: input.aggregateSource,
      scopeId: input.promptId,
      sessionId: input.sessionId,
      turnId: input.promptId,
      dedupeKey: dedupeKey(
        "grok",
        "session",
        input.sessionId,
        "prompt",
        input.promptId,
        "cost",
      ),
    },
  ];
};

export function grokExecutionCostObservationsFromPayload(
  payload: unknown,
): AgentExecutionCostObservation[] {
  const message = runnerPayload(payload);
  if (!message) return [];

  const params = asRecord(message.params) ?? message;
  const update = asRecord(params.update);
  if (update?.sessionUpdate === "turn_completed") {
    const paramsMeta = asRecord(params._meta);
    const updateMeta = asRecord(update._meta);
    if (paramsMeta?.isReplay === true || updateMeta?.isReplay === true) {
      return [];
    }
    const usage = asRecord(update.usage);
    if (!usage) return [];
    return grokPromptCostObservations({
      usage,
      sessionId: nonEmptyString(params.sessionId),
      promptId: grokPromptIdentifier(update, paramsMeta, updateMeta),
      modelSource: "grok.turnCompleted.modelUsage.costUsdTicks",
      aggregateSource: "grok.turnCompleted.costUsdTicks",
    });
  }

  const method = nonEmptyString(message.method);
  const directPromptResponse =
    method === null && nonEmptyString(message.stopReason) !== null;
  if (method !== "session/prompt" && !directPromptResponse) return [];
  const promptParams = asRecord(message.params);
  const result =
    method === "session/prompt" ? asRecord(message.result) : message;
  if (!result) return [];
  const paramsMeta = asRecord(promptParams?._meta);
  const resultMeta = asRecord(result._meta);
  const promptId = grokPromptIdentifier(
    paramsMeta,
    promptParams,
    resultMeta,
    result,
  );
  const sessionId =
    nonEmptyString(promptParams?.sessionId) ?? nonEmptyString(result.sessionId);
  const metaUsage = asRecord(resultMeta?.usage);
  if (metaUsage) {
    return grokPromptCostObservations({
      usage: metaUsage,
      sessionId,
      promptId,
      modelSource: "grok.prompt.metaModelUsage.costUsdTicks",
      aggregateSource: "grok.prompt.metaCostUsdTicks",
    });
  }

  const usage = asRecord(result.usage);
  if (!usage || grokUsageCostIsIncomplete(usage)) return [];
  const amountUsdTicks = exactUsdTicks(usage);
  if (amountUsdTicks === null) return [];
  return [
    {
      kind: "cost",
      provider: "grok",
      model: null,
      canonicalModel: null,
      modelProvider: "xai",
      modelSource: "unknown",
      amountUsdTicks,
      usageKey: grokTokenUsage(usage, true)
        ? dedupeKey(
            "grok",
            "session",
            sessionId,
            "prompt",
            promptId,
            "usage",
          )
        : null,
      source: "grok.prompt.costUsdTicks",
      scopeId: promptId,
      sessionId,
      turnId: promptId,
      dedupeKey: dedupeKey(
        "grok",
        "session",
        sessionId,
        "prompt",
        promptId,
        "cost",
      ),
    },
  ];
}

export function agentExecutionCostObservationsFromPayload(
  provider: AgentExecutionUsageProvider,
  payload: unknown,
): AgentExecutionCostObservation[] {
  if (provider === "claude") {
    return claudeExecutionCostObservationsFromPayload(payload);
  }
  if (provider === "opencode") {
    return openCodeExecutionCostObservationsFromPayload(payload);
  }
  if (provider === "grok") {
    return grokExecutionCostObservationsFromPayload(payload);
  }
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
  finishCosts: () => AgentExecutionCollectedCostObservation[];
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
  const collected = new Map<string, AgentExecutionCollectedTokenObservation>();
  const collectedCosts = new Map<
    string,
    AgentExecutionCollectedCostObservation
  >();
  const scopedModels = new Map<
    string,
    Pick<
      AgentExecutionUsageObservationBase,
      | "model"
      | "canonicalModel"
      | "modelProvider"
      | "modelSource"
      | "sessionId"
      | "turnId"
    >
  >();
  const claudeQueryDeltaKeys = new Set<string>();
  let claudeQueryHasCumulativeUsage = false;
  const openCodeFallbackKeyByMessage = new Map<string, string>();
  const openCodeMessagesWithSteps = new Set<string>();
  const codexTurnUsageBaselines = new Map<string, AgentExecutionTokenUsage>();
  const grokUsageGroups = new Map<
    string,
    { rank: number; keys: Set<string> }
  >();
  const claudeCostGroups = new Map<
    string,
    { rank: number; keys: Set<string> }
  >();
  const openCodeCostFallbackKeyByMessage = new Map<string, string>();
  const openCodeMessagesWithStepCosts = new Set<string>();
  const grokCostGroups = new Map<
    string,
    { rank: number; keys: Set<string> }
  >();
  const grokSessionCosts = new Map<
    string,
    {
      latestUsdTicks: number | null;
      activePrompt: { promptId: string; baselineUsdTicks: number | null } | null;
    }
  >();

  const scopedModelKey = (
    observationProvider: AgentProvider,
    scopeId: string,
  ) => `${observationProvider}:${scopeId}`;

  const prepareRankedCostGroup = (
    groups: Map<string, { rank: number; keys: Set<string> }>,
    groupKey: string,
    rank: number,
  ) => {
    const currentGroup = groups.get(groupKey);
    if (currentGroup && rank < currentGroup.rank) return false;
    if (!currentGroup || rank > currentGroup.rank) {
      for (const priorKey of currentGroup?.keys ?? []) {
        collectedCosts.delete(priorKey);
      }
      groups.set(groupKey, { rank, keys: new Set<string>() });
    }
    return true;
  };

  const collectCostObservation = (
    observation: AgentExecutionCostObservation,
    observedAt: string,
  ) => {
    const scopedModel = observation.scopeId
      ? scopedModels.get(
          scopedModelKey(observation.provider, observation.scopeId),
        )
      : undefined;
    const allowScopedModelFallback =
      observation.provider === "opencode" &&
      observation.source === "opencode.step.cost";
    const enriched: AgentExecutionCostObservation = {
      ...observation,
      model:
        observation.model ??
        (allowScopedModelFallback ? scopedModel?.model ?? null : null),
      canonicalModel:
        observation.canonicalModel ??
        (allowScopedModelFallback
          ? scopedModel?.canonicalModel ?? null
          : null),
      modelProvider:
        observation.modelProvider ??
        (allowScopedModelFallback
          ? scopedModel?.modelProvider ?? null
          : null),
      modelSource:
        observation.modelSource === "unknown" && allowScopedModelFallback
          ? (scopedModel?.modelSource ?? "unknown")
          : observation.modelSource,
      sessionId: observation.sessionId ?? scopedModel?.sessionId ?? null,
      turnId: observation.turnId ?? scopedModel?.turnId ?? null,
    };

    if (
      enriched.provider === "opencode" &&
      enriched.source === "opencode.step.cost" &&
      enriched.scopeId
    ) {
      openCodeMessagesWithStepCosts.add(enriched.scopeId);
      const fallbackKey = openCodeCostFallbackKeyByMessage.get(
        enriched.scopeId,
      );
      if (fallbackKey) collectedCosts.delete(fallbackKey);
      openCodeCostFallbackKeyByMessage.delete(enriched.scopeId);
    }
    if (
      enriched.provider === "opencode" &&
      enriched.source === "opencode.assistant.cost" &&
      enriched.scopeId &&
      openCodeMessagesWithStepCosts.has(enriched.scopeId)
    ) {
      return;
    }

    const costGroupKey = enriched.scopeId
      ? JSON.stringify([enriched.sessionId, enriched.scopeId])
      : null;
    const claudeCostRank =
      enriched.source === "claude.result.total_cost_usd"
        ? 1
        : enriched.source === "claude.result.modelUsage.costUSD"
          ? 2
          : null;
    if (
      costGroupKey &&
      claudeCostRank !== null &&
      !prepareRankedCostGroup(
        claudeCostGroups,
        costGroupKey,
        claudeCostRank,
      )
    ) {
      return;
    }

    const grokCostRank =
      enriched.source === "grok.usageUpdate.cost"
        ? 0
        : enriched.source === "grok.prompt.costUsdTicks"
          ? 1
          : enriched.source === "grok.prompt.metaCostUsdTicks"
            ? 2
            : enriched.source ===
                "grok.prompt.metaModelUsage.costUsdTicks"
              ? 3
              : enriched.source === "grok.turnCompleted.costUsdTicks"
                ? 4
                : enriched.source ===
                    "grok.turnCompleted.modelUsage.costUsdTicks"
                  ? 5
                  : null;
    if (
      costGroupKey &&
      grokCostRank !== null &&
      !prepareRankedCostGroup(grokCostGroups, costGroupKey, grokCostRank)
    ) {
      return;
    }

    const key =
      enriched.dedupeKey ?? `${provider}:cost-observation:${sequence++}`;
    collectedCosts.set(key, {
      ...enriched,
      dedupeKey: key,
      observedAt: collectedCosts.get(key)?.observedAt ?? observedAt,
    });
    if (
      enriched.provider === "opencode" &&
      enriched.source === "opencode.assistant.cost" &&
      enriched.scopeId
    ) {
      openCodeCostFallbackKeyByMessage.set(enriched.scopeId, key);
    }
    if (costGroupKey && claudeCostRank !== null) {
      claudeCostGroups.get(costGroupKey)?.keys.add(key);
    }
    if (costGroupKey && grokCostRank !== null) {
      grokCostGroups.get(costGroupKey)?.keys.add(key);
    }
  };

  const grokCumulativeCostObservation = (
    payload: unknown,
  ): AgentExecutionCostObservation | null => {
    const message = runnerPayload(payload);
    if (!message) return null;
    const method = nonEmptyString(message.method);
    const params = asRecord(message.params);
    const result = asRecord(message.result);

    if (method === "session/new" || method === "session/load") {
      const sessionId =
        nonEmptyString(result?.sessionId) ?? nonEmptyString(params?.sessionId);
      if (!sessionId) return null;
      if (method === "session/new") {
        grokSessionCosts.set(sessionId, {
          latestUsdTicks: 0,
          activePrompt: null,
        });
      } else {
        const known = grokSessionCosts.get(sessionId);
        if (known) {
          known.activePrompt = null;
        } else {
          grokSessionCosts.set(sessionId, {
            latestUsdTicks: null,
            activePrompt: null,
          });
        }
      }
      return null;
    }

    if (method === "briar/session/prompt_start") {
      const sessionId = nonEmptyString(params?.sessionId);
      const paramsMeta = asRecord(params?._meta);
      const promptId = grokPromptIdentifier(paramsMeta, params);
      if (!sessionId || !promptId) return null;
      const state = grokSessionCosts.get(sessionId) ?? {
        latestUsdTicks: null,
        activePrompt: null,
      };
      state.activePrompt = {
        promptId,
        baselineUsdTicks: state.latestUsdTicks,
      };
      grokSessionCosts.set(sessionId, state);
      return null;
    }

    const updateParams = params ?? message;
    const update = asRecord(updateParams.update);
    if (update?.sessionUpdate !== "usage_update") return null;
    const paramsMeta = asRecord(updateParams._meta);
    const updateMeta = asRecord(update._meta);
    if (paramsMeta?.isReplay === true || updateMeta?.isReplay === true) {
      return null;
    }
    const cost = asRecord(update.cost);
    const currency = nonEmptyString(cost?.currency)?.toUpperCase();
    const currentUsdTicks = usdAmountToTicks(cost?.amount);
    const sessionId = nonEmptyString(updateParams.sessionId);
    if (currency !== "USD" || currentUsdTicks === null || !sessionId) {
      return null;
    }

    const state = grokSessionCosts.get(sessionId) ?? {
      latestUsdTicks: null,
      activePrompt: null,
    };
    if (state.latestUsdTicks === null) {
      state.latestUsdTicks = currentUsdTicks;
      if (state.activePrompt?.baselineUsdTicks === null) {
        state.activePrompt.baselineUsdTicks = currentUsdTicks;
      }
      grokSessionCosts.set(sessionId, state);
      return null;
    }
    if (currentUsdTicks < state.latestUsdTicks) return null;
    state.latestUsdTicks = currentUsdTicks;
    grokSessionCosts.set(sessionId, state);
    const activePrompt = state.activePrompt;
    if (!activePrompt || activePrompt.baselineUsdTicks === null) return null;
    const amountUsdTicks = currentUsdTicks - activePrompt.baselineUsdTicks;
    return {
      kind: "cost",
      provider: "grok",
      model: null,
      canonicalModel: null,
      modelProvider: "xai",
      modelSource: "unknown",
      amountUsdTicks,
      usageKey: null,
      source: "grok.usageUpdate.cost",
      scopeId: activePrompt.promptId,
      sessionId,
      turnId: activePrompt.promptId,
      dedupeKey: dedupeKey(
        "grok",
        "session",
        sessionId,
        "prompt",
        activePrompt.promptId,
        "usage-update",
        "cost",
      ),
    };
  };

  const observe = (payload: unknown, observedAt = new Date().toISOString()) => {
    const normalizedObservedAt = observedAtSchema.parse(observedAt);
    const codexTokenUsageSnapshot =
      provider === "codex" ? codexTokenUsageSnapshotFromPayload(payload) : null;
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
        if (observation.scopeId) {
          scopedModels.set(
            scopedModelKey(observation.provider, observation.scopeId),
            {
              model: observation.model,
              canonicalModel: observation.canonicalModel,
              modelProvider: observation.modelProvider,
              modelSource: observation.modelSource,
              sessionId: observation.sessionId,
              turnId: observation.turnId,
            },
          );
          // OpenCode may publish a step before the matching assistant snapshot.
          // Repair any already-collected usage under that stable message id.
          for (const [key, existing] of collected) {
            if (
              existing.provider === observation.provider &&
              existing.scopeId === observation.scopeId
            ) {
              collected.set(key, {
                ...existing,
                model: observation.model ?? existing.model,
                canonicalModel:
                  observation.canonicalModel ?? existing.canonicalModel,
                modelProvider:
                  observation.modelProvider ?? existing.modelProvider,
                modelSource:
                  observation.modelSource === "unknown"
                    ? existing.modelSource
                    : observation.modelSource,
                sessionId: observation.sessionId ?? existing.sessionId,
                turnId: observation.turnId ?? existing.turnId,
              });
            }
          }
          for (const [key, existing] of collectedCosts) {
            if (
              existing.provider === observation.provider &&
              existing.scopeId === observation.scopeId &&
              existing.provider === "opencode" &&
              existing.source === "opencode.step.cost"
            ) {
              collectedCosts.set(key, {
                ...existing,
                model: observation.model ?? existing.model,
                canonicalModel:
                  observation.canonicalModel ?? existing.canonicalModel,
                modelProvider:
                  observation.modelProvider ?? existing.modelProvider,
                modelSource:
                  observation.modelSource === "unknown"
                    ? existing.modelSource
                    : observation.modelSource,
                sessionId: observation.sessionId ?? existing.sessionId,
                turnId: observation.turnId ?? existing.turnId,
              });
            }
          }
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

      const scopedModel = observation.scopeId
        ? scopedModels.get(
            scopedModelKey(observation.provider, observation.scopeId),
          )
        : undefined;
      let enriched: AgentExecutionTokenObservation = {
        ...observation,
        model: observation.model ?? scopedModel?.model ?? currentModel,
        canonicalModel:
          observation.canonicalModel ??
          scopedModel?.canonicalModel ??
          currentCanonicalModel,
        modelProvider:
          observation.modelProvider ??
          scopedModel?.modelProvider ??
          currentModelProvider,
        modelSource:
          observation.modelSource === "unknown"
            ? (scopedModel?.modelSource ?? currentModelSource)
            : observation.modelSource,
        sessionId: observation.sessionId ?? scopedModel?.sessionId ?? null,
        turnId: observation.turnId ?? scopedModel?.turnId ?? null,
      };
      if (
        enriched.provider === "codex" &&
        enriched.source === "codex.threadTokenUsage" &&
        enriched.turnId &&
        codexTokenUsageSnapshot?.total
      ) {
        const baselineKey = JSON.stringify([
          enriched.sessionId,
          enriched.turnId,
        ]);
        let baseline = codexTurnUsageBaselines.get(baselineKey);
        if (!baseline) {
          // App Server's `total` is cumulative for the whole thread while
          // `last` is only the most recent model call. Their difference on
          // the first snapshot is the thread usage from before this turn.
          baseline = tokenUsageDifference(
            codexTokenUsageSnapshot.total,
            codexTokenUsageSnapshot.last,
          );
          codexTurnUsageBaselines.set(baselineKey, baseline);
        }
        enriched = {
          ...enriched,
          // Subtract the stable pre-turn baseline from each later cumulative
          // snapshot. Fall back bucket-by-bucket when a provider omits or
          // resets a cumulative counter.
          tokenUsage: tokenUsageDifference(
            codexTokenUsageSnapshot.total,
            baseline,
            codexTokenUsageSnapshot.last,
          ),
        };
      }
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

      if (
        enriched.provider === "opencode" &&
        enriched.source === "opencode.step.usage" &&
        enriched.scopeId
      ) {
        openCodeMessagesWithSteps.add(enriched.scopeId);
        const fallbackKey = openCodeFallbackKeyByMessage.get(enriched.scopeId);
        if (fallbackKey) collected.delete(fallbackKey);
        openCodeFallbackKeyByMessage.delete(enriched.scopeId);
      }
      if (
        enriched.provider === "opencode" &&
        enriched.source === "opencode.assistant.usage" &&
        enriched.scopeId &&
        openCodeMessagesWithSteps.has(enriched.scopeId)
      ) {
        return enriched;
      }

      const grokUsageRank =
        enriched.provider !== "grok"
          ? null
          : enriched.source === "grok.prompt.usage"
            ? 1
            : enriched.source === "grok.prompt.metaUsage"
              ? 2
              : enriched.source === "grok.prompt.metaModelUsage"
                ? 3
                : enriched.source === "grok.turnCompleted.usage"
                  ? 4
                  : enriched.source === "grok.turnCompleted.modelUsage"
                    ? 5
                    : null;
      const grokUsageGroupKey =
        grokUsageRank !== null && enriched.scopeId
          ? JSON.stringify([enriched.sessionId, enriched.scopeId])
          : null;
      if (grokUsageGroupKey && grokUsageRank !== null) {
        const currentGroup = grokUsageGroups.get(grokUsageGroupKey);
        if (currentGroup && grokUsageRank < currentGroup.rank) {
          return enriched;
        }
        if (!currentGroup || grokUsageRank > currentGroup.rank) {
          for (const priorKey of currentGroup?.keys ?? []) {
            collected.delete(priorKey);
          }
          grokUsageGroups.set(grokUsageGroupKey, {
            rank: grokUsageRank,
            keys: new Set<string>(),
          });
        }
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
      if (
        enriched.provider === "opencode" &&
        enriched.source === "opencode.assistant.usage" &&
        enriched.scopeId
      ) {
        openCodeFallbackKeyByMessage.set(enriched.scopeId, key);
      }
      if (grokUsageGroupKey) {
        grokUsageGroups.get(grokUsageGroupKey)?.keys.add(key);
      }
      return enriched;
    });

    if (provider === "grok") {
      const cumulativeCost = grokCumulativeCostObservation(payload);
      if (cumulativeCost) {
        collectCostObservation(cumulativeCost, normalizedObservedAt);
      }
    }
    for (const costObservation of agentExecutionCostObservationsFromPayload(
      provider,
      payload,
    )) {
      collectCostObservation(costObservation, normalizedObservedAt);
    }
  };

  return {
    observe,
    finish: () => [...collected.values()],
    finishCosts: () => [...collectedCosts.values()],
  };
}

/**
 * Convert normalized provider observations into the immutable ingestion
 * contract. Codex, Grok, and Antigravity include cached input in inputTokens,
 * while Claude and OpenCode report cache reads and writes as separate buckets.
 */
export function agentExecutionUsageRecordsFromObservations(
  observations: AgentExecutionCollectedTokenObservation[],
): AgentExecutionUsageRecord[] {
  return observations.map((observation) => {
    const usage = observation.tokenUsage;
    const uncachedInputTokens =
      usage.inputTokens === null
        ? null
        : observation.provider === "codex" ||
            observation.provider === "grok" ||
            observation.provider === "agy"
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

export function agentExecutionCostRecordsFromObservations(
  observations: AgentExecutionCollectedCostObservation[],
): AgentExecutionCostRecord[] {
  return observations.map(
    (observation) =>
      ({
        costKey: observation.dedupeKey,
        usageKey: observation.usageKey,
        sessionId: observation.sessionId,
        scopeId: observation.scopeId,
        turnId: observation.turnId,
        agentProvider: observation.provider,
        modelProvider: observation.modelProvider,
        model: observation.model,
        canonicalModel: observation.canonicalModel,
        modelSource: observation.modelSource,
        source: observation.source,
        amountUsdTicks: observation.amountUsdTicks,
        observedAt: observation.observedAt,
      }) satisfies AgentExecutionCostRecord,
  );
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
