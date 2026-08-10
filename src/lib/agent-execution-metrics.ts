import { z } from "zod";
import type { AgentProvider } from "./agent-provider-contract";

const tokenCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

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
export type AgentExecutionTokenUsage = Omit<AgentExecutionMetrics, "durationMs">;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const tokenValue = (
  record: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  }
  return null;
};

const usageCandidates = (payload: unknown) => {
  const root = asRecord(payload);
  if (!root) return [];
  const raw = asRecord(root.raw);
  const rawParams = asRecord(raw?.params);
  const rawTurn = asRecord(rawParams?.turn);
  const result = asRecord(root.result);
  const event = asRecord(root.event);
  const params = asRecord(root.params);
  const turn = asRecord(params?.turn);
  const tokenUsage = asRecord(root.tokenUsage) ?? asRecord(params?.tokenUsage);
  return [
    asRecord(root.usage),
    asRecord(params?.usage),
    asRecord(turn?.usage),
    asRecord(rawParams?.usage),
    asRecord(rawTurn?.usage),
    asRecord(raw?.usage),
    asRecord(asRecord(raw?.result)?.usage),
    asRecord(result?.usage),
    asRecord(event?.usage),
    asRecord(tokenUsage?.last),
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
};

export function agentExecutionTokenUsageFromPayload(
  provider: AgentProvider,
  payload: unknown,
): AgentExecutionTokenUsage | null {
  for (const usage of usageCandidates(payload)) {
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
      continue;
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
  }
  return null;
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
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
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
