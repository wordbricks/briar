import { describe, expect, it } from "vitest";
import {
  agentExecutionMetrics,
  agentExecutionTokenUsageFromPayload,
  formatExecutionDuration,
} from "./agent-execution-metrics";

describe("agent execution metrics", () => {
  it("normalizes Codex turn usage without double-counting cached input", () => {
    expect(
      agentExecutionTokenUsageFromPayload("codex", {
        type: "turn.completed",
        usage: {
          input_tokens: 1_000,
          cached_input_tokens: 800,
          output_tokens: 250,
        },
      }),
    ).toEqual({
      inputTokens: 1_000,
      outputTokens: 250,
      cacheReadTokens: 800,
      cacheWriteTokens: null,
      reasoningOutputTokens: null,
      totalTokens: 1_250,
    });
  });

  it("normalizes Claude result usage including cache activity", () => {
    expect(
      agentExecutionTokenUsageFromPayload("claude", {
        type: "event",
        raw: {
          type: "result",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 25,
            cache_creation_input_tokens: 10,
          },
        },
      }),
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
      totalTokens: 185,
    });
  });

  it("normalizes Codex App Server turn usage from the raw RPC event", () => {
    expect(
      agentExecutionTokenUsageFromPayload("codex", {
        type: "event",
        raw: {
          method: "turn/completed",
          params: {
            turn: {
              usage: {
                input_tokens: 900,
                cached_input_tokens: 700,
                output_tokens: 180,
              },
            },
          },
        },
      }),
    ).toEqual({
      inputTokens: 900,
      outputTokens: 180,
      cacheReadTokens: 700,
      cacheWriteTokens: null,
      reasoningOutputTokens: null,
      totalTokens: 1_080,
    });
  });

  it("records duration even when a provider does not report tokens", () => {
    expect(agentExecutionMetrics(90_499, null)).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningOutputTokens: null,
      totalTokens: null,
      durationMs: 90_499,
    });
    expect(formatExecutionDuration(90_499)).toBe("1m 30s");
  });
});
