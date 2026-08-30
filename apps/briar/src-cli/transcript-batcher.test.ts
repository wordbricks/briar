import {
  Code,
  ConnectError,
} from "@connectrpc/connect";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  compactTranscriptBatch,
  TranscriptBatcher,
  type TranscriptBatchEvent,
} from "./transcript-batcher";
import { isConnectPayloadTooLarge } from "./worker-transcript-client";

const delta = (
  sequence: number,
  text: string,
): TranscriptBatchEvent => ({
  sequence,
  direction: "server",
  payload: {
    type: "event",
    raw: { providerSequence: sequence },
    event: { type: "messageDelta", id: "message-1", delta: text },
  },
});

describe("TranscriptBatcher", () => {
  it("compacts replayable deltas and lets a terminal snapshot supersede them", () => {
    const compacted = compactTranscriptBatch(
      compactTranscriptBatch([], delta(10, "hel")),
      delta(11, "lo"),
    );
    expect(compacted).toEqual([
      {
        sequence: 11,
        direction: "server",
        payload: {
          type: "event",
          event: { type: "messageDelta", id: "message-1", delta: "hello" },
          archiveCompaction: {
            kind: "delta",
            firstSequence: 10,
            eventCount: 2,
          },
        },
      },
    ]);

    expect(compactTranscriptBatch(compacted, {
      sequence: 12,
      direction: "server",
      payload: {
        type: "event",
        event: {
          type: "messageCompleted",
          id: "message-1",
          phase: "final",
          text: "hello",
        },
      },
    })).toEqual([
      {
        sequence: 12,
        direction: "server",
        payload: {
          type: "event",
          event: {
            type: "messageCompleted",
            id: "message-1",
            phase: "final",
            text: "hello",
          },
        },
      },
    ]);
  });

  it("preserves batch order across bounded transient retries", async () => {
    const delivered: number[][] = [];
    let attempts = 0;
    const batcher = new TranscriptBatcher({
      maxEvents: 2,
      flushIntervalMs: 60_000,
      maxBufferMs: 60_000,
      retryDelayMs: 0,
      send: async (events) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary outage");
        delivered.push(events.map((event) => event.sequence));
      },
    });

    await batcher.enqueue({
      sequence: 1,
      direction: "server",
      payload: { type: "opaque", value: "a" },
    });
    await batcher.enqueue({
      sequence: 2,
      direction: "server",
      payload: { type: "opaque", value: "b" },
    });
    await batcher.enqueue({
      sequence: 3,
      direction: "client",
      payload: { type: "approval", id: "approval-1" },
    });
    await batcher.flush();

    expect(attempts).toBe(3);
    expect(delivered).toEqual([[1, 2], [3]]);
  });

  it("splits only Connect ResourceExhausted responses and keeps event order", async () => {
    const calls: number[][] = [];
    const batcher = new TranscriptBatcher({
      maxEvents: 4,
      flushIntervalMs: 60_000,
      maxBufferMs: 60_000,
      retryDelayMs: 0,
      isPayloadTooLarge: isConnectPayloadTooLarge,
      send: async (events) => {
        calls.push(events.map((event) => event.sequence));
        if (events.length === 4) {
          throw new ConnectError("request too large", Code.ResourceExhausted);
        }
      },
    });

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      await batcher.enqueue({
        sequence,
        direction: sequence % 2 === 0 ? "client" : "server",
        payload: { type: "opaque", sequence },
      });
    }

    expect(calls).toEqual([[1, 2, 3, 4], [1, 2], [3, 4]]);

    const onError = vi.fn();
    let genericAttempts = 0;
    const genericFailure = new TranscriptBatcher({
      maxEvents: 1,
      maxSendAttempts: 2,
      retryDelayMs: 0,
      flushIntervalMs: 60_000,
      maxBufferMs: 60_000,
      isPayloadTooLarge: isConnectPayloadTooLarge,
      onError,
      send: async () => {
        genericAttempts += 1;
        throw new Error("ordinary failure");
      },
    });
    await genericFailure.enqueue({
      sequence: 5,
      direction: "server",
      payload: { type: "opaque" },
    });
    expect(genericAttempts).toBe(2);
    expect(onError).toHaveBeenCalledOnce();
  });
});
