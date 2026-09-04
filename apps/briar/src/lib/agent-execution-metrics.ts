import * as Match from "effect/Match";
import type { AgentProvider } from "./agent-provider";
import type { AgentExecutionCostRecord } from "./agent-execution-cost";
import {
  type AgentExecutionCollectedCostObservation,
  type AgentExecutionCollectedTokenObservation,
  type AgentExecutionCostObservation,
  AgentExecutionMetrics,
  type AgentExecutionModelObservation,
  type AgentExecutionTokenObservation,
  type AgentExecutionTokenUsage,
  type AgentExecutionUsageObservation,
  type AgentExecutionUsageObservationBase,
  type AgentExecutionUsageProvider,
  AgentExecutionUsageRecord,
  decodeAgentExecutionMetrics,
  decodeAgentExecutionMetricsJson,
  decodeAgentExecutionUsageRecord,
  encodeAgentExecutionMetricsJson,
  parseObservedAt,
} from "./agent-execution-metrics/model";
import {
  asRecord,
  dedupeKey,
  exactUsdTicks,
  nonEmptyString,
  runnerPayload,
  tokenSum,
  tokenValue,
  usdAmountToTicks,
} from "./agent-execution-metrics/payload";
import {
  openCodeExecutionCostObservationsFromPayload,
  openCodeExecutionObservationsFromPayload,
  openCodeExecutionUsageObservationsFromPayload,
} from "./agent-execution-metrics/providers/opencode";

export {
  type AgentExecutionCollectedCostObservation,
  type AgentExecutionCollectedTokenObservation,
  type AgentExecutionCostObservation,
  AgentExecutionMetrics,
  type AgentExecutionModelObservation,
  type AgentExecutionTokenObservation,
  type AgentExecutionTokenUsage,
  type AgentExecutionUsageObservation,
  type AgentExecutionUsageProvider,
  AgentExecutionUsageRecord,
  decodeAgentExecutionMetrics,
  decodeAgentExecutionMetricsJson,
  decodeAgentExecutionUsageRecord,
  encodeAgentExecutionMetricsJson,
  openCodeExecutionCostObservationsFromPayload,
  openCodeExecutionUsageObservationsFromPayload,
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

  return [];
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
  return agentExecutionObservationsFromPayload(provider, payload).usage;
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
  return agentExecutionObservationsFromPayload(provider, payload).costs;
}

function agentExecutionObservationsFromPayload(
  provider: AgentExecutionUsageProvider,
  payload: unknown,
) {
  return Match.value(provider).pipe(
    Match.when("claude", () => ({
      usage: claudeExecutionUsageObservationsFromPayload(payload),
      costs: claudeExecutionCostObservationsFromPayload(payload),
    })),
    Match.when("codex", () => ({
      usage: codexExecutionUsageObservationsFromPayload(payload),
      costs: [] as AgentExecutionCostObservation[],
    })),
    Match.when("cursor", () => ({
      usage: [] as AgentExecutionUsageObservation[],
      costs: [] as AgentExecutionCostObservation[],
    })),
    Match.when("grok", () => ({
      usage: grokExecutionUsageObservationsFromPayload(payload),
      costs: grokExecutionCostObservationsFromPayload(payload),
    })),
    Match.when("agy", () => ({
      usage: agyExecutionUsageObservationsFromPayload(payload),
      costs: [] as AgentExecutionCostObservation[],
    })),
    Match.when("opencode", () =>
      openCodeExecutionObservationsFromPayload(payload)),
    // OpenCode upstreams publish no per-turn usage or cost of their own; the
    // account they bill against is the upstream's, not Briar's.
    Match.whenOr("openrouter", "vertex", () => ({
      usage: [] as AgentExecutionUsageObservation[],
      costs: [] as AgentExecutionCostObservation[],
    })),
    Match.exhaustive,
  );
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
    const normalizedObservedAt = parseObservedAt(observedAt);
    const codexTokenUsageSnapshot =
      provider === "codex" ? codexTokenUsageSnapshotFromPayload(payload) : null;
    const decodedObservations = agentExecutionObservationsFromPayload(
      provider,
      payload,
    );
    decodedObservations.usage.forEach((observation) => {
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
    for (const costObservation of decodedObservations.costs) {
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
  observations: AgentExecutionUsageObservation[],
): AgentExecutionTokenUsage | null {
  return aggregateTokenUsage(observations);
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
