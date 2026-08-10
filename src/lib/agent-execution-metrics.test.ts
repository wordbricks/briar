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
  grokExecutionUsageObservationsFromPayload,
  openCodeExecutionUsageObservationsFromPayload,
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
    const observeQuery = (
      messageId: string,
      resultId: string,
      input: number,
    ) => {
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
    expect(
      agentExecutionTokenUsageFromObservations(observations),
    ).toMatchObject({
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

    expect(agentExecutionUsageRecordSchema.safeParse(record).success).toBe(
      false,
    );
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

  it("observes OpenCode's provider-selected model and disjoint token buckets", () => {
    expect(
      openCodeExecutionUsageObservationsFromPayload({
        type: "event",
        raw: {
          id: "evt-1",
          type: "message.updated",
          properties: {
            sessionID: "session-1",
            info: {
              id: "message-1",
              sessionID: "session-1",
              parentID: "user-message-1",
              role: "assistant",
              providerID: "opencode-go",
              modelID: "deepseek-v4-flash",
              tokens: {
                input: 200,
                output: 557,
                reasoning: 69,
                cache: { read: 141_184, write: 0 },
                total: 142_010,
              },
            },
          },
        },
      }),
    ).toEqual([
      {
        kind: "model",
        provider: "opencode",
        model: "deepseek-v4-flash",
        canonicalModel: null,
        modelProvider: "opencode-go",
        modelSource: "providerReported",
        source: "opencode.assistant",
        scopeId: "message-1",
        sessionId: "session-1",
        turnId: "user-message-1",
        dedupeKey: "opencode:message:message-1:model",
      },
      {
        kind: "delta",
        provider: "opencode",
        model: "deepseek-v4-flash",
        canonicalModel: null,
        modelProvider: "opencode-go",
        modelSource: "providerReported",
        source: "opencode.assistant.usage",
        scopeId: "message-1",
        sessionId: "session-1",
        turnId: "user-message-1",
        dedupeKey: "opencode:message:message-1:usage",
        tokenUsage: {
          inputTokens: 200,
          // OpenCode output excludes reasoning; Briar output includes it.
          outputTokens: 626,
          cacheReadTokens: 141_184,
          cacheWriteTokens: 0,
          reasoningOutputTokens: 69,
          totalTokens: 142_010,
        },
      },
    ]);
  });

  it("prefers every OpenCode step-finish over the assistant fallback", () => {
    const collector = createAgentExecutionUsageCollector("opencode");
    const step = (
      id: string,
      tokens: {
        input: number;
        output: number;
        reasoning: number;
        read: number;
        total: number;
      },
    ) => ({
      type: "event",
      raw: {
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          part: {
            id,
            sessionID: "session-1",
            messageID: "message-1",
            type: "step-finish",
            reason: "tool-calls",
            cost: 0,
            tokens: {
              input: tokens.input,
              output: tokens.output,
              reasoning: tokens.reasoning,
              cache: { read: tokens.read, write: 0 },
              total: tokens.total,
            },
          },
        },
      },
    });
    const firstStep = step("part-step-1", {
      input: 10,
      output: 3,
      reasoning: 7,
      read: 20,
      total: 40,
    });
    const secondPart = {
      id: "part-step-2",
      sessionID: "session-1",
      messageID: "message-1",
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: {
        input: 5,
        output: 4,
        reasoning: 1,
        cache: { read: 30, write: 0 },
        total: 40,
      },
    };
    const assistant = {
      id: "message-1",
      sessionID: "session-1",
      parentID: "user-message-1",
      role: "assistant",
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      // This snapshot must not survive once step usage is available.
      tokens: {
        input: 999,
        output: 999,
        reasoning: 0,
        cache: { read: 0, write: 0 },
        total: 1_998,
      },
    };

    // Exercise out-of-order correlation: usage can be seen before model info.
    collector.observe(firstStep, "2026-08-10T01:00:00.000Z");
    collector.observe({
      type: "event",
      raw: {
        type: "message.updated",
        properties: { sessionID: "session-1", info: assistant },
      },
    });
    // The final response bundle replays step one and supplies step two.
    collector.observe({
      type: "event",
      raw: {
        info: assistant,
        parts: [firstStep.raw.properties.part, secondPart],
      },
    });

    const observations = collector.finish();
    expect(observations).toHaveLength(2);
    expect(observations).toEqual([
      expect.objectContaining({
        source: "opencode.step.usage",
        dedupeKey: "opencode:part:part-step-1:usage",
        model: "deepseek-v4-flash",
        modelProvider: "opencode-go",
        modelSource: "providerReported",
        turnId: "user-message-1",
        observedAt: "2026-08-10T01:00:00.000Z",
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadTokens: 20,
          cacheWriteTokens: 0,
          reasoningOutputTokens: 7,
          totalTokens: 40,
        },
      }),
      expect.objectContaining({
        source: "opencode.step.usage",
        dedupeKey: "opencode:part:part-step-2:usage",
        model: "deepseek-v4-flash",
        tokenUsage: expect.objectContaining({
          inputTokens: 5,
          outputTokens: 5,
          reasoningOutputTokens: 1,
          totalTokens: 40,
        }),
      }),
    ]);
    expect(agentExecutionTokenUsageFromObservations(observations)).toEqual({
      inputTokens: 15,
      outputTokens: 15,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      reasoningOutputTokens: 8,
      totalTokens: 80,
    });
    expect(
      agentExecutionUsageRecordsFromObservations(observations)[0],
    ).toMatchObject({
      uncachedInputTokens: 10,
      cacheReadTokens: 20,
      outputTokens: 10,
    });
  });

  it("keeps OpenCode assistant usage when no step-finish is available", () => {
    const collector = createAgentExecutionUsageCollector("opencode");
    collector.observe({
      type: "event",
      raw: {
        id: "message-1",
        sessionID: "session-1",
        parentID: "user-message-1",
        role: "assistant",
        providerID: "opencode",
        modelID: "big-pickle",
        tokens: {
          input: 12,
          output: 5,
          reasoning: 3,
          cache: { read: 10, write: 2 },
          total: 32,
        },
      },
    });

    expect(collector.finish()).toEqual([
      expect.objectContaining({
        source: "opencode.assistant.usage",
        model: "big-pickle",
        tokenUsage: expect.objectContaining({
          outputTokens: 8,
          reasoningOutputTokens: 3,
          totalTokens: 32,
        }),
      }),
    ]);
  });

  it("keeps every actual Grok modelUsage entry and normalizes inclusive input", () => {
    const payload = {
      type: "event",
      raw: {
        jsonrpc: "2.0",
        method: "_x.ai/session/update",
        params: {
          sessionId: "session-1",
          _meta: { eventId: "event-1" },
          update: {
            sessionUpdate: "turn_completed",
            prompt_id: "prompt-1",
            stop_reason: "end_turn",
            usage: {
              inputTokens: 120,
              outputTokens: 45,
              reasoningTokens: 17,
              totalTokens: 165,
              cachedReadTokens: 65,
              cacheCreationTokens: 10,
              modelCalls: 3,
              modelUsage: {
                "grok-4.5-build": {
                  inputTokens: 100,
                  outputTokens: 40,
                  reasoningTokens: 15,
                  totalTokens: 140,
                  cachedReadTokens: 60,
                  cacheCreationTokens: 10,
                  modelCalls: 2,
                },
                "grok-4.5-mini": {
                  inputTokens: 20,
                  outputTokens: 5,
                  reasoningTokens: 2,
                  totalTokens: 25,
                  cachedReadTokens: 5,
                  cacheCreationTokens: 0,
                  modelCalls: 1,
                },
              },
            },
          },
        },
      },
    };

    expect(grokExecutionUsageObservationsFromPayload(payload)).toEqual([
      expect.objectContaining({
        kind: "delta",
        provider: "grok",
        model: "grok-4.5-build",
        modelProvider: "xai",
        modelSource: "providerReported",
        source: "grok.turnCompleted.modelUsage",
        scopeId: "prompt-1",
        sessionId: "session-1",
        turnId: "prompt-1",
        dedupeKey:
          "grok:session:session-1:prompt:prompt-1:model:grok-4.5-build:usage",
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 60,
          cacheWriteTokens: 10,
          reasoningOutputTokens: 15,
          totalTokens: 140,
        },
      }),
      expect.objectContaining({
        model: "grok-4.5-mini",
        tokenUsage: expect.objectContaining({ totalTokens: 25 }),
      }),
    ]);

    const collector = createAgentExecutionUsageCollector("grok");
    collector.observe(payload, "2026-08-10T02:00:00.000Z");
    collector.observe(payload, "2026-08-10T03:00:00.000Z");
    const records = agentExecutionUsageRecordsFromObservations(
      collector.finish(),
    );
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      model: "grok-4.5-build",
      uncachedInputTokens: 30,
      cacheReadTokens: 60,
      cacheWriteTokens: 10,
      outputTokens: 40,
      reasoningOutputTokens: 15,
      observedAt: "2026-08-10T02:00:00.000Z",
    });
    expect(records[1]).toMatchObject({ uncachedInputTokens: 15 });
  });

  it("uses Grok session model as fallback but prefers prompt meta modelUsage", () => {
    const collector = createAgentExecutionUsageCollector("grok", {
      configuredModel: "grok-build",
    });
    const sessionSetup = {
      type: "event",
      raw: {
        method: "session/new",
        result: {
          sessionId: "session-1",
          models: {
            currentModelId: "grok-4.5",
            availableModels: [],
          },
        },
      },
    };
    expect(grokExecutionUsageObservationsFromPayload(sessionSetup)).toEqual([
      expect.objectContaining({
        kind: "model",
        model: "grok-4.5",
        modelProvider: "xai",
        source: "grok.sessionNew",
        sessionId: "session-1",
      }),
    ]);
    expect(
      grokExecutionUsageObservationsFromPayload({
        type: "event",
        raw: {
          method: "session/set_model",
          params: { sessionId: "session-1", modelId: "grok-4.5-fast" },
          result: {},
        },
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "model",
        model: "grok-4.5-fast",
        modelSource: "providerConfig",
        source: "grok.modelSet",
        sessionId: "session-1",
      }),
    ]);
    collector.observe(sessionSetup);

    const genericPrompt = {
      type: "event",
      raw: {
        method: "session/prompt",
        params: {
          sessionId: "session-1",
          messageId: "client-message-1",
          _meta: {
            promptId: "prompt-1",
            requestId: "prompt-1",
          },
        },
        result: {
          stopReason: "end_turn",
          _meta: { modelId: "grok-4.5-runtime" },
          // This agent-assigned id must not break private prompt correlation.
          userMessageId: "agent-message-1",
          usage: {
            inputTokens: 90,
            outputTokens: 6,
            thoughtTokens: 4,
            cachedReadTokens: 40,
            cachedWriteTokens: 10,
            totalTokens: 100,
          },
        },
      },
    };
    expect(grokExecutionUsageObservationsFromPayload(genericPrompt)).toEqual([
      expect.objectContaining({
        source: "grok.prompt.usage",
        scopeId: "prompt-1",
        turnId: "prompt-1",
        tokenUsage: {
          inputTokens: 90,
          outputTokens: 10,
          cacheReadTokens: 40,
          cacheWriteTokens: 10,
          reasoningOutputTokens: 4,
          totalTokens: 100,
        },
      }),
    ]);
    collector.observe(genericPrompt);
    expect(collector.finish()).toEqual([
      expect.objectContaining({
        source: "grok.prompt.usage",
        model: "grok-4.5-runtime",
        modelSource: "providerReported",
      }),
    ]);

    const richPromptResult = {
      type: "event",
      raw: {
        method: "session/prompt",
        params: {
          sessionId: "session-1",
          messageId: "client-message-1",
          _meta: { promptId: "prompt-1", requestId: "prompt-1" },
        },
        result: {
          stopReason: "end_turn",
          _meta: {
            // Grok 1.0.0 can put the per-prompt proprietary aggregate here.
            usage: {
              inputTokens: 80,
              outputTokens: 20,
              reasoningTokens: 8,
              cachedReadTokens: 50,
              cacheCreationTokens: 5,
              totalTokens: 100,
              modelUsage: {
                "grok-4.5-build": {
                  inputTokens: 80,
                  outputTokens: 20,
                  reasoningTokens: 8,
                  cachedReadTokens: 50,
                  cacheCreationTokens: 5,
                  totalTokens: 100,
                },
              },
            },
          },
          // The richer _meta.usage must suppress this generic fallback.
          usage: { inputTokens: 999, outputTokens: 999, totalTokens: 1_998 },
        },
      },
    };
    expect(grokExecutionUsageObservationsFromPayload(richPromptResult)).toEqual(
      [
        expect.objectContaining({
          source: "grok.prompt.metaModelUsage",
          model: "grok-4.5-build",
          scopeId: "prompt-1",
        }),
      ],
    );
    collector.observe(richPromptResult, "2026-08-10T04:00:00.000Z");
    // A later generic replay for the same prompt cannot reintroduce fallback.
    collector.observe(genericPrompt);

    const observations = collector.finish();
    expect(observations).toEqual([
      expect.objectContaining({
        source: "grok.prompt.metaModelUsage",
        model: "grok-4.5-build",
        modelProvider: "xai",
        tokenUsage: expect.objectContaining({ totalTokens: 100 }),
      }),
    ]);
    expect(agentExecutionUsageRecordsFromObservations(observations)).toEqual([
      expect.objectContaining({
        model: "grok-4.5-build",
        uncachedInputTokens: 25,
        cacheReadTokens: 50,
        cacheWriteTokens: 5,
        outputTokens: 20,
        reasoningOutputTokens: 8,
      }),
    ]);
  });

  it.each(["ascending", "descending"] as const)(
    "keeps only the strongest Grok prompt usage tier in %s event order",
    (order) => {
      const promptId = "prompt-ranked";
      const sessionId = "session-ranked";
      const generic = {
        method: "session/prompt",
        params: { sessionId, _meta: { promptId } },
        result: {
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
        },
      };
      const metaAggregate = {
        method: "session/prompt",
        params: { sessionId, _meta: { promptId } },
        result: {
          stopReason: "end_turn",
          _meta: {
            usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 },
          },
        },
      };
      const metaModels = {
        method: "session/prompt",
        params: { sessionId, _meta: { promptId } },
        result: {
          stopReason: "end_turn",
          _meta: {
            usage: {
              modelUsage: {
                "fallback-model-a": {
                  inputTokens: 30,
                  outputTokens: 3,
                  totalTokens: 33,
                },
                "fallback-model-b": {
                  inputTokens: 40,
                  outputTokens: 4,
                  totalTokens: 44,
                },
              },
            },
          },
        },
      };
      const privateAggregate = {
        method: "_x.ai/session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "turn_completed",
            prompt_id: promptId,
            usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
          },
        },
      };
      const privateModels = {
        method: "_x.ai/session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "turn_completed",
            prompt_id: promptId,
            usage: {
              modelUsage: {
                "actual-model-a": {
                  inputTokens: 60,
                  outputTokens: 6,
                  totalTokens: 66,
                },
                "actual-model-b": {
                  inputTokens: 70,
                  outputTokens: 7,
                  totalTokens: 77,
                },
              },
            },
          },
        },
      };
      const payloads = [
        generic,
        metaAggregate,
        metaModels,
        privateAggregate,
        privateModels,
      ];
      const collector = createAgentExecutionUsageCollector("grok");
      for (const payload of order === "ascending"
        ? payloads
        : [...payloads].reverse()) {
        collector.observe(payload);
      }

      expect(collector.finish()).toEqual([
        expect.objectContaining({
          source: "grok.turnCompleted.modelUsage",
          model: "actual-model-a",
          tokenUsage: expect.objectContaining({ totalTokens: 66 }),
        }),
        expect.objectContaining({
          source: "grok.turnCompleted.modelUsage",
          model: "actual-model-b",
          tokenUsage: expect.objectContaining({ totalTokens: 77 }),
        }),
      ]);
    },
  );

  it("scopes Grok prompt replacement by both session and prompt", () => {
    const collector = createAgentExecutionUsageCollector("grok");
    collector.observe({
      method: "session/prompt",
      params: { sessionId: "session-a", _meta: { promptId: "prompt-1" } },
      result: {
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
      },
    });
    collector.observe({
      method: "_x.ai/session/update",
      params: {
        sessionId: "session-b",
        update: {
          sessionUpdate: "turn_completed",
          prompt_id: "prompt-1",
          usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 },
        },
      },
    });

    expect(collector.finish()).toEqual([
      expect.objectContaining({
        source: "grok.prompt.usage",
        sessionId: "session-a",
      }),
      expect.objectContaining({
        source: "grok.turnCompleted.usage",
        sessionId: "session-b",
      }),
    ]);
  });

  it("adds distinct Grok prompt aggregates while replacing prompt replays", () => {
    const collector = createAgentExecutionUsageCollector("grok", {
      configuredModel: "grok-4.5",
    });
    const prompt = (promptId: string, inputTokens: number) => ({
      method: "session/prompt",
      params: {
        sessionId: "session-1",
        messageId: promptId,
        _meta: { promptId, requestId: promptId },
      },
      result: {
        stopReason: "end_turn",
        usage: {
          inputTokens,
          outputTokens: 10,
          totalTokens: inputTokens + 10,
        },
      },
    });
    collector.observe(prompt("prompt-1", 100));
    collector.observe(prompt("prompt-1", 100));
    collector.observe(prompt("prompt-2", 180));

    const observations = collector.finish();
    expect(observations).toHaveLength(2);
    expect(observations.map((observation) => observation.scopeId)).toEqual([
      "prompt-1",
      "prompt-2",
    ]);
    expect(
      agentExecutionTokenUsageFromObservations(observations),
    ).toMatchObject({
      inputTokens: 280,
      outputTokens: 20,
      totalTokens: 300,
    });
  });

  it("ignores Grok context usage updates and explicit load replays", () => {
    expect(
      grokExecutionUsageObservationsFromPayload({
        type: "event",
        raw: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "usage_update",
            size: 256_000,
            used: 120_000,
          },
        },
      }),
    ).toEqual([]);
    expect(
      grokExecutionUsageObservationsFromPayload({
        type: "event",
        raw: {
          method: "_x.ai/session/update",
          params: {
            sessionId: "session-1",
            _meta: { isReplay: true },
            update: {
              sessionUpdate: "turn_completed",
              prompt_id: "old-prompt",
              usage: {
                inputTokens: 100,
                outputTokens: 10,
                totalTokens: 110,
              },
            },
          },
        },
      }),
    ).toEqual([]);
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
