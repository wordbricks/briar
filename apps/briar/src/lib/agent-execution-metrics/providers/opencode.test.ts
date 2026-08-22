import { describe, expect, it } from "vitest";
import {
  agentExecutionCostObservationsFromPayload,
  agentExecutionUsageObservationsFromPayload,
} from "../../agent-execution-metrics";
import { openCodeExecutionObservationsFromPayload } from "./opencode";

describe("OpenCode execution metrics adapter", () => {
  it("keeps valid observations when sibling scalar fields are malformed", () => {
    const observations = openCodeExecutionObservationsFromPayload({
      type: "event",
      raw: {
        type: "message.updated",
        properties: {
          info: {
            id: " message-1 ",
            role: "assistant",
            sessionID: "session-1",
            parentID: "user-1",
            providerID: "opencode",
            modelID: " big-pickle ",
            cost: 0.25,
            tokens: {
              input: 12,
              output: "malformed",
              reasoning: 3,
              cache: { read: -1, write: 2 },
              total: Number.POSITIVE_INFINITY,
            },
          },
        },
      },
    });

    expect(observations.usage).toEqual([
      expect.objectContaining({
        kind: "model",
        model: "big-pickle",
        scopeId: "message-1",
      }),
      expect.objectContaining({
        source: "opencode.assistant.usage",
        tokenUsage: {
          inputTokens: 12,
          outputTokens: 3,
          cacheReadTokens: null,
          cacheWriteTokens: 2,
          reasoningOutputTokens: 3,
          totalTokens: 17,
        },
      }),
    ]);
    expect(observations.costs).toEqual([
      expect.objectContaining({
        source: "opencode.assistant.cost",
        amountUsdTicks: 2_500_000_000,
        usageKey: "opencode:message:message-1:usage",
      }),
    ]);
  });

  it("makes providers without a metrics adapter explicit", () => {
    const payload = {
      role: "assistant",
      tokens: { input: 10, output: 5 },
      cost: 1,
    };

    for (const provider of ["cursor", "openrouter"] as const) {
      expect(
        agentExecutionUsageObservationsFromPayload(provider, payload),
      ).toEqual([]);
      expect(
        agentExecutionCostObservationsFromPayload(provider, payload),
      ).toEqual([]);
    }
  });
});
