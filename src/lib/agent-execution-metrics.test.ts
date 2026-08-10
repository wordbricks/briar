import { describe, expect, it } from "vitest";
import {
  agentExecutionMetrics,
  agentExecutionTokenUsageFromPayload,
  agentExecutionTokenUsageFromObservations,
  agentExecutionUsageObservationsFromPayload,
  agentExecutionUsageRecordSchema,
  agentExecutionUsageRecordsFromObservations,
  claudeExecutionUsageObservationsFromPayload,
  codexExecutionUsageObservationsFromPayload,
  createAgentExecutionUsageCollector,
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

  it("keeps compatibility with Codex usage directly under RPC params", () => {
    expect(
      agentExecutionTokenUsageFromPayload("codex", {
        type: "event",
        raw: {
          method: "turn/completed",
          params: {
            turnId: "turn-1",
            usage: {
              inputTokens: 90,
              cachedInputTokens: 40,
              outputTokens: 10,
            },
          },
        },
      }),
    ).toMatchObject({
      inputTokens: 90,
      cacheReadTokens: 40,
      outputTokens: 10,
      totalTokens: 100,
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

  it("observes Claude's provider-selected model and assistant token delta", () => {
    expect(
      claudeExecutionUsageObservationsFromPayload({
        type: "event",
        raw: {
          type: "system",
          subtype: "init",
          session_id: "session-1",
          model: "claude-sonnet-4-6",
        },
      }),
    ).toEqual([
      {
        kind: "model",
        provider: "claude",
        model: "claude-sonnet-4-6",
        canonicalModel: null,
        modelProvider: null,
        modelSource: "providerReported",
        source: "claude.init",
        scopeId: "session-1",
        sessionId: "session-1",
        turnId: null,
        dedupeKey: "claude:session:session-1:model",
      },
    ]);

    expect(
      claudeExecutionUsageObservationsFromPayload({
        type: "event",
        raw: {
          type: "assistant",
          uuid: "assistant-envelope-1",
          session_id: "session-1",
          message: {
            id: "message-1",
            model: "claude-opus-4-6-20260801",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 4,
              cache_creation_input_tokens: 2,
            },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "delta",
        provider: "claude",
        model: "claude-opus-4-6-20260801",
        source: "claude.assistant.usage",
        scopeId: "message-1",
        sessionId: "session-1",
        dedupeKey: "claude:message:message-1:usage",
        tokenUsage: expect.objectContaining({ totalTokens: 21 }),
      }),
    ]);
  });

  it("keeps every Claude result model usage and billing provider", () => {
    const payload = {
      type: "event",
      raw: {
        type: "result",
        subtype: "success",
        uuid: "result-1",
        session_id: "session-1",
        modelUsage: {
          "claude-sonnet-4-6-20260801": {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 25,
            cacheCreationInputTokens: 10,
            canonicalModel: "claude-sonnet-4-6",
            provider: "firstParty",
          },
          "anthropic.claude-haiku-4-5-v1:0": {
            inputTokens: 30,
            outputTokens: 20,
            cacheReadInputTokens: 5,
            cacheCreationInputTokens: 0,
            canonicalModel: "claude-haiku-4-5",
            provider: "bedrock",
          },
        },
        // This aggregate must not become a third usage observation.
        usage: {
          input_tokens: 130,
          output_tokens: 70,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 10,
        },
      },
    };

    expect(
      agentExecutionUsageObservationsFromPayload("claude", payload),
    ).toEqual([
      expect.objectContaining({
        kind: "cumulative",
        provider: "claude",
        model: "claude-sonnet-4-6-20260801",
        canonicalModel: "claude-sonnet-4-6",
        modelProvider: "firstParty",
        source: "claude.result.modelUsage",
        scopeId: "result-1",
        sessionId: "session-1",
        dedupeKey:
          "claude:session:result-1:model:claude-sonnet-4-6-20260801:usage",
        tokenUsage: expect.objectContaining({ totalTokens: 185 }),
      }),
      expect.objectContaining({
        kind: "cumulative",
        provider: "claude",
        model: "anthropic.claude-haiku-4-5-v1:0",
        canonicalModel: "claude-haiku-4-5",
        modelProvider: "bedrock",
        tokenUsage: expect.objectContaining({ totalTokens: 55 }),
      }),
    ]);
    expect(agentExecutionTokenUsageFromPayload("claude", payload)).toEqual({
      inputTokens: 130,
      outputTokens: 70,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      reasoningOutputTokens: null,
      totalTokens: 240,
    });
  });

  it("lets Claude cumulative model usage replace assistant deltas", () => {
    const collector = createAgentExecutionUsageCollector("claude");
    collector.observe({
      type: "event",
      raw: {
        type: "assistant",
        session_id: "session-1",
        message: {
          id: "message-1",
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
    });
    expect(collector.finish()).toHaveLength(1);

    collector.observe({
      type: "event",
      raw: {
        type: "result",
        session_id: "session-1",
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 40,
            outputTokens: 20,
            cacheReadInputTokens: 5,
            cacheCreationInputTokens: 0,
            provider: "vertex",
          },
        },
      },
    });

    expect(collector.finish()).toEqual([
      expect.objectContaining({
        kind: "cumulative",
        model: "claude-sonnet-4-6",
        modelProvider: "vertex",
        tokenUsage: expect.objectContaining({ totalTokens: 65 }),
      }),
    ]);
  });

  it("keeps resumed Claude query totals that share one session", () => {
    const collector = createAgentExecutionUsageCollector("claude");
    const observeQuery = (messageId: string, resultId: string, input: number) => {
      collector.observe({
        type: "event",
        raw: {
          type: "system",
          subtype: "init",
          session_id: "session-1",
          model: "claude-sonnet-4-6",
        },
      });
      collector.observe({
        type: "event",
        raw: {
          type: "assistant",
          session_id: "session-1",
          message: {
            id: messageId,
            model: "claude-sonnet-4-6",
            usage: { input_tokens: input, output_tokens: 1 },
          },
        },
      });
      collector.observe({
        type: "event",
        raw: {
          type: "result",
          uuid: resultId,
          session_id: "session-1",
          modelUsage: {
            "claude-sonnet-4-6": {
              inputTokens: input,
              outputTokens: 1,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          },
        },
      });
    };

    observeQuery("message-1", "result-1", 10);
    observeQuery("message-2", "result-2", 20);

    const observations = collector.finish();
    expect(observations).toEqual([
      expect.objectContaining({
        scopeId: "result-1",
        tokenUsage: expect.objectContaining({ totalTokens: 11 }),
      }),
      expect.objectContaining({
        scopeId: "result-2",
        tokenUsage: expect.objectContaining({ totalTokens: 21 }),
      }),
    ]);
    expect(agentExecutionTokenUsageFromObservations(observations)).toEqual({
      inputTokens: 30,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningOutputTokens: null,
      totalTokens: 32,
    });
  });

  it("observes Codex effective defaults from config and model list responses", () => {
    expect(
      codexExecutionUsageObservationsFromPayload({
        type: "event",
        direction: "server",
        raw: {
          id: 2,
          result: {
            config: {
              model: "gpt-5.6-sol",
              model_provider: "openai",
            },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "model",
        model: "gpt-5.6-sol",
        modelProvider: "openai",
        source: "codex.config",
      }),
    ]);

    expect(
      codexExecutionUsageObservationsFromPayload({
        type: "event",
        direction: "server",
        raw: {
          id: 3,
          result: {
            data: [
              { id: "gpt-5.6-mini", model: "gpt-5.6-mini", isDefault: false },
              { id: "gpt-5.6-sol", model: "gpt-5.6-sol", isDefault: true },
            ],
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "model",
        model: "gpt-5.6-sol",
        source: "codex.modelDefault",
      }),
    ]);
  });

  it("observes the model and billing provider resolved by a Codex thread", () => {
    expect(
      codexExecutionUsageObservationsFromPayload({
        type: "event",
        direction: "server",
        raw: {
          id: 4,
          result: {
            thread: { id: "thread-1" },
            model: "gpt-5.6-sol",
            modelProvider: "openai",
          },
        },
      }),
    ).toEqual([
      {
        kind: "model",
        provider: "codex",
        model: "gpt-5.6-sol",
        canonicalModel: null,
        modelProvider: "openai",
        modelSource: "providerReported",
        source: "codex.thread",
        scopeId: "thread-1",
        sessionId: "thread-1",
        turnId: null,
        dedupeKey: "codex:thread:thread-1:model",
      },
    ]);
  });

  it("combines a catalog default with a thread's provider-only response", () => {
    const collector = createAgentExecutionUsageCollector("codex");
    collector.observe({
      result: {
        data: [{ model: "gpt-5.6-sol", isDefault: true }],
      },
    });
    collector.observe({
      result: {
        thread: { id: "thread-1" },
        modelProvider: "openai",
      },
    });
    collector.observe({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      },
    });
    expect(collector.finish()).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-sol",
        modelProvider: "openai",
        modelSource: "providerConfig",
      }),
    ]);
  });

  it("updates the observed Codex model when App Server reroutes a turn", () => {
    expect(
      codexExecutionUsageObservationsFromPayload({
        type: "event",
        direction: "server",
        raw: {
          method: "model/rerouted",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            fromModel: "gpt-5.6-sol",
            toModel: "gpt-5.6-mini",
            reason: "highRiskCyberActivity",
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "model",
        provider: "codex",
        model: "gpt-5.6-mini",
        source: "codex.rerouted",
        scopeId: "turn-1",
        sessionId: "thread-1",
        turnId: "turn-1",
        dedupeKey: "codex:turn:turn-1:model",
      }),
    ]);
  });

  it("observes Codex thread settings updates", () => {
    expect(
      codexExecutionUsageObservationsFromPayload({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-1",
          threadSettings: {
            model: "gpt-5.6-terra",
            modelProvider: "openai",
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "model",
        model: "gpt-5.6-terra",
        modelProvider: "openai",
        source: "codex.threadSettings",
        sessionId: "thread-1",
      }),
    ]);
  });

  it("resets a prior reroute from each explicit Codex turn request", () => {
    const collector = createAgentExecutionUsageCollector("codex", {
      configuredModel: "gpt-5.6-sol",
    });
    collector.observe({
      method: "model/rerouted",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        toModel: "gpt-5.6-mini",
      },
    });
    const turnRequest = {
      type: "event",
      direction: "client",
      raw: {
        method: "turn/start",
        id: 5,
        params: { threadId: "thread-1", model: "gpt-5.6-sol" },
      },
    };
    expect(codexExecutionUsageObservationsFromPayload(turnRequest)).toEqual([
      expect.objectContaining({
        kind: "model",
        model: "gpt-5.6-sol",
        modelSource: "configuredFallback",
        source: "codex.turnRequest",
        sessionId: "thread-1",
      }),
    ]);
    collector.observe(turnRequest);
    collector.observe({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-2",
        tokenUsage: {
          last: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      },
    });
    expect(collector.finish()).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-sol",
        modelSource: "configuredFallback",
        turnId: "turn-2",
      }),
    ]);
  });

  it("normalizes and deduplicates Codex per-turn token deltas", () => {
    const payload = {
      type: "event",
      direction: "server",
      raw: {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          tokenUsage: {
            last: {
              inputTokens: 900,
              cachedInputTokens: 700,
              cacheWriteInputTokens: 40,
              outputTokens: 180,
              reasoningOutputTokens: 120,
              totalTokens: 1_080,
            },
            total: {
              inputTokens: 9_000,
              cachedInputTokens: 7_000,
              cacheWriteInputTokens: 400,
              outputTokens: 1_800,
              reasoningOutputTokens: 1_200,
              totalTokens: 10_800,
            },
          },
        },
      },
    };
    expect(codexExecutionUsageObservationsFromPayload(payload)).toEqual([
      expect.objectContaining({
        kind: "delta",
        provider: "codex",
        model: null,
        source: "codex.threadTokenUsage",
        scopeId: "turn-1",
        sessionId: "thread-1",
        turnId: "turn-1",
        dedupeKey: "codex:turn:turn-1:usage",
        tokenUsage: {
          inputTokens: 900,
          outputTokens: 180,
          cacheReadTokens: 700,
          cacheWriteTokens: 40,
          reasoningOutputTokens: 120,
          totalTokens: 1_080,
        },
      }),
    ]);

    const collector = createAgentExecutionUsageCollector("codex");
    collector.observe({
      result: {
        config: { model: "gpt-5.6-sol", model_provider: "openai" },
      },
    });
    collector.observe(payload);
    collector.observe(payload);
    expect(collector.finish()).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-sol",
        modelProvider: "openai",
        modelSource: "providerConfig",
        tokenUsage: expect.objectContaining({ totalTokens: 1_080 }),
      }),
    ]);

    // App Server may report a safety reroute after the usage snapshot; the
    // already-collected turn must still carry the model that served it.
    collector.observe({
      method: "model/rerouted",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        fromModel: "gpt-5.6-sol",
        toModel: "gpt-5.6-mini",
      },
    });
    expect(collector.finish()).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-mini",
        modelSource: "providerReported",
      }),
    ]);
  });

  it("returns ledger-ready Codex records with disjoint input and a stable timestamp", () => {
    const collector = createAgentExecutionUsageCollector("codex", {
      configuredModel: "gpt-5.6-sol",
    });
    collector.observe(
      {
        type: "turn.completed",
        usage: {
          input_tokens: 1_000,
          cached_input_tokens: 800,
          cache_write_input_tokens: 50,
          output_tokens: 250,
          reasoning_output_tokens: 100,
          total_tokens: 1_250,
        },
      },
      "2026-08-10T01:02:03.000Z",
    );

    const observations = collector.finish();
    expect(observations).toEqual([
      expect.objectContaining({
        dedupeKey: "codex:observation:0",
        observedAt: "2026-08-10T01:02:03.000Z",
      }),
    ]);
    expect(agentExecutionUsageRecordsFromObservations(observations)).toEqual([
      {
        usageKey: "codex:observation:0",
        sessionId: null,
        scopeId: null,
        turnId: null,
        agentProvider: "codex",
        modelProvider: null,
        model: "gpt-5.6-sol",
        canonicalModel: null,
        modelSource: "configuredFallback",
        source: "codex.turnUsage",
        uncachedInputTokens: 150,
        cacheReadTokens: 800,
        cacheWriteTokens: 50,
        outputTokens: 250,
        reasoningOutputTokens: 100,
        totalTokens: 1_250,
        observedAt: "2026-08-10T01:02:03.000Z",
      },
    ]);
    // reasoningOutputTokens is a subset of outputTokens, not an extra bucket.
    expect(agentExecutionTokenUsageFromObservations(observations)).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 250,
      reasoningOutputTokens: 100,
      totalTokens: 1_250,
    });
  });

  it("keeps the first occurrence time when a provider event is replayed", () => {
    const collector = createAgentExecutionUsageCollector("codex");
    const payload = {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      },
    };
    collector.observe(payload, "2026-08-10T01:00:00.000Z");
    collector.observe(payload, "2026-08-10T02:00:00.000Z");

    expect(collector.finish()).toEqual([
      expect.objectContaining({
        dedupeKey: "codex:turn:turn-1:usage",
        observedAt: "2026-08-10T01:00:00.000Z",
      }),
    ]);
  });

  it("rejects empty or internally inconsistent ledger token records", () => {
    const record = {
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
      uncachedInputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      totalTokens: null,
      observedAt: "2026-08-10T01:00:00.000Z",
    };

    expect(agentExecutionUsageRecordSchema.safeParse(record).success).toBe(false);
    expect(
      agentExecutionUsageRecordSchema.safeParse({
        ...record,
        outputTokens: 10,
        reasoningOutputTokens: 11,
        totalTokens: 10,
      }).success,
    ).toBe(false);
    expect(
      agentExecutionUsageRecordSchema.safeParse({
        ...record,
        reasoningOutputTokens: 1,
        totalTokens: 1,
      }).success,
    ).toBe(false);
    expect(
      agentExecutionUsageRecordSchema.safeParse({
        ...record,
        outputTokens: 10,
        reasoningOutputTokens: 4,
        totalTokens: 10,
      }).success,
    ).toBe(true);
  });

  it("marks configured model enrichment as fallback rather than provider-reported", () => {
    const collector = createAgentExecutionUsageCollector("codex", {
      configuredModel: "gpt-5.6-sol",
    });
    collector.observe({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          last: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      },
    });
    expect(collector.finish()).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-sol",
        modelSource: "configuredFallback",
      }),
    ]);
  });

  it("does not guess OpenCode or Grok usage through another provider adapter", () => {
    const lookalikePayload = {
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    expect(
      agentExecutionUsageObservationsFromPayload("opencode", lookalikePayload),
    ).toEqual([]);
    expect(
      agentExecutionUsageObservationsFromPayload("grok", lookalikePayload),
    ).toEqual([]);
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
