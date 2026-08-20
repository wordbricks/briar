import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  decodeTranscriptRequest,
  decodeTranscriptRequestEffect,
  TranscriptRequest,
  TranscriptRequestDecodeError,
} from "./transcript-request";

const transcript = {
  sessionId: "detached-run",
  runId: "11111111-1111-4111-8111-111111111111",
  runAttempt: 2,
  executionId: "33333333-3333-4333-8333-333333333333",
  projectId: "22222222-2222-4222-8222-222222222222",
  workerId: "worker-1",
  agentProvider: "codex" as const,
  usageRecords: [{
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
    uncachedInputTokens: 10,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: 2,
    reasoningOutputTokens: null,
    totalTokens: 12,
    observedAt: "2026-08-10T01:00:00.000Z",
  }],
  events: [{ sequence: 1, direction: "server" as const, payload: {} }],
};

describe("transcript request schema", () => {
  it("decodes and normalizes the complete request", () => {
    const decoded = decodeTranscriptRequest({
      ...transcript,
      sessionId: "  detached-run  ",
      workerId: "  worker-1  ",
    });

    expect(decoded).toMatchObject({
      sessionId: "detached-run",
      workerId: "worker-1",
    });
    decoded.events.push({
      sequence: 2,
      direction: "client",
      payload: { type: "approvalResponse" },
    });
    expect(decoded.events).toHaveLength(2);
  });

  it("rejects excess top-level and nested event properties", () => {
    expect(() =>
      decodeTranscriptRequest({ ...transcript, requestTraceId: "trace-1" })
    ).toThrow();
    expect(() =>
      decodeTranscriptRequest({
        ...transcript,
        events: [{
          sequence: 1,
          direction: "server",
          payload: {},
          requestTraceId: "trace-1",
        }],
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TranscriptRequest)({
        ...transcript,
        requestTraceId: "trace-1",
      })
    ).toThrow();
  });

  it("preserves the legacy optional unknown event payload", () => {
    const decoded = decodeTranscriptRequest({
      ...transcript,
      events: [{ sequence: 1, direction: "server" }],
    });

    expect(decoded.events[0]).toEqual({
      sequence: 1,
      direction: "server",
    });
    expect(decoded.events[0]).not.toHaveProperty("payload");
  });

  it("requires usage identity and a matching provider", () => {
    expect(() =>
      decodeTranscriptRequest({ ...transcript, executionId: undefined })
    ).toThrow(/executionId is required with usageRecords/iu);
    expect(() =>
      decodeTranscriptRequest({ ...transcript, runAttempt: undefined })
    ).toThrow(/runAttempt is required with usageRecords/iu);
    expect(() =>
      decodeTranscriptRequest({
        ...transcript,
        usageRecords: [{
          ...transcript.usageRecords[0],
          agentProvider: "claude",
        }],
      })
    ).toThrow(/usage record providers must match agentProvider/iu);
  });

  it("keeps schema failures in the Effect error channel", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(decodeTranscriptRequestEffect({
        ...transcript,
        events: [],
      })),
    );

    expect(failure).toBeInstanceOf(TranscriptRequestDecodeError);
    expect(failure._tag).toBe("TranscriptRequestDecodeError");
    expect(Schema.isSchemaError(failure.cause)).toBe(true);
  });
});
