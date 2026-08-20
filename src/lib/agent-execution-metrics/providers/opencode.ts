import * as EffectArray from "effect/Array";
import * as Option from "effect/Option";
import type {
  AgentExecutionCostObservation,
  AgentExecutionTokenObservation,
  AgentExecutionTokenUsage,
  AgentExecutionUsageObservation,
} from "../model";
import {
  asRecord,
  dedupeKey,
  nonEmptyString,
  type ProviderPayloadRecord,
  runnerPayload,
  tokenSum,
  tokenValue,
  usdAmountToTicks,
} from "../payload";

type OpenCodeAssistant = {
  readonly messageId: string | null;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly model: string | null;
  readonly modelProvider: string | null;
  readonly tokenUsage: AgentExecutionTokenUsage | null;
  readonly amountUsdTicks: number | null;
};

type OpenCodeStep = {
  readonly partId: string | null;
  readonly messageId: string | null;
  readonly sessionId: string | null;
  readonly tokenUsage: AgentExecutionTokenUsage | null;
  readonly amountUsdTicks: number | null;
};

type OpenCodePayload = {
  readonly assistant: OpenCodeAssistant | null;
  readonly steps: ReadonlyArray<OpenCodeStep>;
};

export type OpenCodeExecutionObservations = {
  readonly usage: AgentExecutionUsageObservation[];
  readonly costs: AgentExecutionCostObservation[];
};

const openCodeTokenUsage = (
  tokens: ProviderPayloadRecord,
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

const decodeOpenCodeAssistant = (
  assistant: ProviderPayloadRecord | null,
): OpenCodeAssistant | null => {
  if (!assistant || assistant.role !== "assistant") return null;
  const tokens = asRecord(assistant.tokens);
  return {
    messageId: nonEmptyString(assistant.id),
    sessionId: nonEmptyString(assistant.sessionID),
    turnId: nonEmptyString(assistant.parentID),
    model: nonEmptyString(assistant.modelID),
    modelProvider: nonEmptyString(assistant.providerID),
    tokenUsage: tokens ? openCodeTokenUsage(tokens) : null,
    amountUsdTicks: usdAmountToTicks(assistant.cost),
  };
};

const decodeOpenCodeStep = (
  part: ProviderPayloadRecord,
): OpenCodeStep | null => {
  if (part.type !== "step-finish") return null;
  const tokens = asRecord(part.tokens);
  return {
    partId: nonEmptyString(part.id),
    messageId: nonEmptyString(part.messageID),
    sessionId: nonEmptyString(part.sessionID),
    tokenUsage: tokens ? openCodeTokenUsage(tokens) : null,
    amountUsdTicks: usdAmountToTicks(part.cost),
  };
};

const decodeOpenCodePayload = (payload: unknown): OpenCodePayload | null => {
  const message = runnerPayload(payload);
  if (!message) return null;

  const properties = asRecord(message.properties);
  const eventAssistant = message.type === "message.updated"
    ? asRecord(properties?.info)
    : null;
  const responseAssistant = asRecord(message.info);
  const directAssistant = message.role === "assistant" ? message : null;

  const rawParts: ProviderPayloadRecord[] = [];
  if (message.type === "message.part.updated") {
    const part = asRecord(properties?.part);
    if (part) rawParts.push(part);
  } else if (message.type === "step-finish") {
    rawParts.push(message);
  }
  if (globalThis.Array.isArray(message.parts)) {
    rawParts.push(
      ...EffectArray.getSomes(
        message.parts.map((part) => Option.fromNullOr(asRecord(part))),
      ),
    );
  }

  return {
    assistant: decodeOpenCodeAssistant(
      eventAssistant ?? responseAssistant ?? directAssistant,
    ),
    steps: EffectArray.getSomes(
      rawParts.map((part) => Option.fromNullOr(decodeOpenCodeStep(part))),
    ),
  };
};

const openCodeAssistantUsage = (
  assistant: OpenCodeAssistant,
  includeUsage: boolean,
): AgentExecutionUsageObservation[] => {
  const observations: AgentExecutionUsageObservation[] = [];

  if (assistant.model) {
    observations.push({
      kind: "model",
      provider: "opencode",
      model: assistant.model,
      canonicalModel: null,
      modelProvider: assistant.modelProvider,
      modelSource: "providerReported",
      source: "opencode.assistant",
      scopeId: assistant.messageId,
      sessionId: assistant.sessionId,
      turnId: assistant.turnId,
      dedupeKey: dedupeKey(
        "opencode",
        "message",
        assistant.messageId,
        "model",
      ),
    });
  }

  if (includeUsage && assistant.tokenUsage) {
    observations.push({
      kind: "delta",
      provider: "opencode",
      model: assistant.model,
      canonicalModel: null,
      modelProvider: assistant.modelProvider,
      modelSource: assistant.model ? "providerReported" : "unknown",
      tokenUsage: assistant.tokenUsage,
      source: "opencode.assistant.usage",
      scopeId: assistant.messageId,
      sessionId: assistant.sessionId,
      turnId: assistant.turnId,
      dedupeKey: dedupeKey(
        "opencode",
        "message",
        assistant.messageId,
        "usage",
      ),
    });
  }
  return observations;
};

const openCodeStepUsage = (
  step: OpenCodeStep,
): AgentExecutionTokenObservation | null => {
  if (!step.tokenUsage) return null;
  return {
    kind: "delta",
    provider: "opencode",
    model: null,
    canonicalModel: null,
    modelProvider: null,
    modelSource: "unknown",
    tokenUsage: step.tokenUsage,
    source: "opencode.step.usage",
    scopeId: step.messageId,
    sessionId: step.sessionId,
    turnId: null,
    dedupeKey: dedupeKey("opencode", "part", step.partId, "usage"),
  };
};

const openCodeAssistantCost = (
  assistant: OpenCodeAssistant,
): AgentExecutionCostObservation | null => {
  if (assistant.amountUsdTicks === null) return null;
  return {
    kind: "cost",
    provider: "opencode",
    model: assistant.model,
    canonicalModel: null,
    modelProvider: assistant.modelProvider,
    modelSource: assistant.model ? "providerReported" : "unknown",
    amountUsdTicks: assistant.amountUsdTicks,
    usageKey:
      assistant.tokenUsage
        ? dedupeKey("opencode", "message", assistant.messageId, "usage")
        : null,
    source: "opencode.assistant.cost",
    scopeId: assistant.messageId,
    sessionId: assistant.sessionId,
    turnId: assistant.turnId,
    dedupeKey: dedupeKey(
      "opencode",
      "message",
      assistant.messageId,
      "cost",
    ),
  };
};

const openCodeStepCost = (
  step: OpenCodeStep,
): AgentExecutionCostObservation | null => {
  if (step.amountUsdTicks === null) return null;
  return {
    kind: "cost",
    provider: "opencode",
    model: null,
    canonicalModel: null,
    modelProvider: null,
    modelSource: "unknown",
    amountUsdTicks: step.amountUsdTicks,
    usageKey:
      step.tokenUsage
        ? dedupeKey("opencode", "part", step.partId, "usage")
        : null,
    source: "opencode.step.cost",
    scopeId: step.messageId,
    sessionId: step.sessionId,
    turnId: null,
    dedupeKey: dedupeKey("opencode", "part", step.partId, "cost"),
  };
};

export function openCodeExecutionObservationsFromPayload(
  payload: unknown,
): OpenCodeExecutionObservations {
  const decoded = decodeOpenCodePayload(payload);
  if (!decoded) return { usage: [], costs: [] };

  const stepUsage = EffectArray.getSomes(
    decoded.steps.map((step) => Option.fromNullOr(openCodeStepUsage(step))),
  );
  const assistantId = decoded.assistant?.messageId ?? null;
  const hasAssistantStep = stepUsage.some(
    (observation) =>
      assistantId === null || observation.scopeId === assistantId,
  );
  const assistantUsage = decoded.assistant
    ? openCodeAssistantUsage(decoded.assistant, !hasAssistantStep)
    : [];

  const stepCosts = EffectArray.getSomes(
    decoded.steps.map((step) => Option.fromNullOr(openCodeStepCost(step))),
  );
  const hasAssistantStepCost = stepCosts.some(
    (observation) =>
      assistantId === null || observation.scopeId === assistantId,
  );
  const assistantCost = decoded.assistant && !hasAssistantStepCost
    ? openCodeAssistantCost(decoded.assistant)
    : null;

  return {
    usage: [...assistantUsage, ...stepUsage],
    costs: [...(assistantCost ? [assistantCost] : []), ...stepCosts],
  };
}

export const openCodeExecutionUsageObservationsFromPayload = (
  payload: unknown,
): AgentExecutionUsageObservation[] =>
  openCodeExecutionObservationsFromPayload(payload).usage;

export const openCodeExecutionCostObservationsFromPayload = (
  payload: unknown,
): AgentExecutionCostObservation[] =>
  openCodeExecutionObservationsFromPayload(payload).costs;
