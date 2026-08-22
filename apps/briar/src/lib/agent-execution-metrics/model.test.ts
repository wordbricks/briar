import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  AgentExecutionMetrics,
  decodeAgentExecutionMetrics,
  decodeAgentExecutionUsageRecord,
} from "./model";

const metrics = {
  inputTokens: 0,
  outputTokens: 1,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningOutputTokens: 1,
  totalTokens: Number.MAX_SAFE_INTEGER,
  durationMs: 0,
};

const usageRecord = {
  usageKey: "codex:turn:turn-1:usage",
  sessionId: "thread-1",
  scopeId: "turn-1",
  turnId: "turn-1",
  agentProvider: "codex" as const,
  modelProvider: "openai",
  model: "gpt-5.6-sol",
  canonicalModel: null,
  modelSource: "providerReported" as const,
  source: "codex.threadTokenUsage",
  uncachedInputTokens: 0,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  outputTokens: 1,
  reasoningOutputTokens: 1,
  totalTokens: 1,
  observedAt: "2026-08-10T01:00:00.000Z",
};

describe("agent execution metric schemas", () => {
  it("accepts the complete nonnegative safe-integer range", () => {
    expect(decodeAgentExecutionMetrics(metrics)).toEqual(metrics);
  });

  it("rejects invalid token counts and excess properties", () => {
    for (const totalTokens of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() =>
        decodeAgentExecutionMetrics({ ...metrics, totalTokens })
      ).toThrow();
    }
    expect(() =>
      decodeAgentExecutionMetrics({ ...metrics, requestTraceId: "trace-1" })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AgentExecutionMetrics)({
        ...metrics,
        requestTraceId: "trace-1",
      })
    ).toThrow();
  });

  it("trims bounded identifiers while preserving the observed offset", () => {
    expect(
      decodeAgentExecutionUsageRecord({
        ...usageRecord,
        usageKey: "  codex:turn:turn-1:usage  ",
        modelProvider: "  openai  ",
        observedAt: "2026-08-10T04:15:00.123456789+03:15",
      }),
    ).toMatchObject({
      usageKey: "codex:turn:turn-1:usage",
      modelProvider: "openai",
      observedAt: "2026-08-10T04:15:00.123456789+03:15",
    });
  });

  it("matches the existing offset date-time boundary", () => {
    for (const observedAt of [
      "2024-02-29T00:00Z",
      "2026-08-10T01:00:00Z",
      "2026-08-10T04:15:00.123456789+03:15",
    ]) {
      expect(
        decodeAgentExecutionUsageRecord({ ...usageRecord, observedAt })
          .observedAt,
      ).toBe(observedAt);
    }

    for (const observedAt of [
      "2023-02-29T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-08-10T01:00:00",
      "2026-08-10T01:00:00+24:00",
      "2026-08-10T01:00:00+00:60",
    ]) {
      expect(() =>
        decodeAgentExecutionUsageRecord({ ...usageRecord, observedAt })
      ).toThrow();
    }
  });

  it("rejects excess usage claims", () => {
    expect(() =>
      decodeAgentExecutionUsageRecord({
        ...usageRecord,
        futureClaim: true,
      })
    ).toThrow();
  });
});
