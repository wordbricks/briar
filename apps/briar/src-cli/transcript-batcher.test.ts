import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS,
  TRANSCRIPT_BATCH_MAX_BUFFER_MS,
  TRANSCRIPT_BATCH_MAX_BYTES,
  TRANSCRIPT_BATCH_MAX_EVENTS,
  TranscriptBatcher,
  type TranscriptBatchEvent,
} from "./transcript-batcher";

const event = (sequence: number, payload: unknown = { sequence }) =>
  ({ sequence, direction: "server", payload }) satisfies TranscriptBatchEvent;

describe("TranscriptBatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces events until the short flush window elapses", async () => {
    vi.useFakeTimers();
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      flushIntervalMs: 250,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2));
    await batcher.enqueue(event(3));
    expect(batches).toEqual([]);

    await vi.advanceTimersByTimeAsync(250);
    await batcher.flush();
    expect(batches).toEqual([[event(1), event(2), event(3)]]);
  });

  it("uses headroom below the server request limits", () => {
    expect(TRANSCRIPT_BATCH_MAX_EVENTS).toBe(192);
    expect(TRANSCRIPT_BATCH_MAX_BYTES).toBe(896 * 1024);
    expect(TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS).toBe(500);
    expect(TRANSCRIPT_BATCH_MAX_BUFFER_MS).toBe(5_000);
  });

  it("cuts sustained delta R2 puts and serialized bytes", async () => {
    vi.useFakeTimers();
    const sourceEvents = Array.from({ length: 1_000 }, (_, index) =>
      event(index + 1, {
        type: "event",
        raw: {
          method: "item/agentMessage/delta",
          params: { itemId: "message-1", delta: "x" },
        },
        event: { type: "messageDelta", id: "message-1", delta: "x" },
      })
    );
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      flushIntervalMs: 500,
      maxBufferMs: 5_000,
      maxEvents: 10_000,
      maxBytes: 10 * 1024 * 1024,
    });
    for (const sourceEvent of sourceEvents) {
      await batcher.enqueue(sourceEvent);
      await vi.advanceTimersByTimeAsync(10);
    }
    await batcher.flush();

    const previousPutObjects = 20;
    const previousBatches = Array.from(
      { length: previousPutObjects },
      (_, index) => sourceEvents.slice(index * 50, index * 50 + 50),
    );
    const previousBytes = sourceEvents.reduce(
      (total, sourceEvent) =>
        total + Buffer.byteLength(JSON.stringify(sourceEvent), "utf8"),
      0,
    );
    const optimizedBytes = batches.flat().reduce(
      (total, archivedEvent) =>
        total + Buffer.byteLength(JSON.stringify(archivedEvent), "utf8"),
      0,
    );

    expect(batches).toHaveLength(2);
    expect(batches.flat()).toHaveLength(2);
    expect(batches.length).toBeLessThanOrEqual(previousPutObjects * 0.1);
    expect(optimizedBytes).toBeLessThan(previousBytes * 0.05);
    expect(
      batches.flat().reduce((total, archivedEvent) => {
        const payload = archivedEvent.payload as {
          type: "event",
          event: { delta: string };
          archiveCompaction: { eventCount: number };
        };
        expect(payload.event.delta).toBe("x".repeat(
          payload.archiveCompaction.eventCount,
        ));
        return total + payload.archiveCompaction.eventCount;
      }, 0),
    ).toBe(1_000);
    const compressedBytes = (items: TranscriptBatchEvent[][]) =>
      items.reduce(
        (total, batch) =>
          total + gzipSync(
            `${
              batch.map((archivedEvent) => JSON.stringify(archivedEvent)).join(
                "\n",
              )
            }\n`,
          ).byteLength,
        0,
      );
    expect(compressedBytes(batches)).toBeLessThan(
      compressedBytes(previousBatches) * 0.1,
    );
  });

  it("coalesces consecutive deltas without retaining repeated raw envelopes", async () => {
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1, {
      type: "event",
      raw: { token: "hello" },
      event: { type: "messageDelta", id: "message-1", delta: "hello" },
    }));
    await batcher.enqueue(event(2, {
      type: "event",
      raw: { token: " world" },
      event: { type: "messageDelta", id: "message-1", delta: " world" },
    }));
    await batcher.flush();

    expect(batches).toEqual([[
      {
        sequence: 2,
        direction: "server",
        payload: {
          type: "event",
          event: {
            type: "messageDelta",
            id: "message-1",
            delta: "hello world",
          },
          archiveCompaction: {
            kind: "delta",
            firstSequence: 1,
            eventCount: 2,
          },
        },
      },
    ]]);
  });

  it("lets a complete snapshot supersede pending deltas", async () => {
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1, {
      type: "event",
      event: { type: "messageDelta", id: "message-1", delta: "hello" },
    }));
    await batcher.enqueue(event(2, {
      type: "event",
      event: { type: "messageDelta", id: "message-1", delta: " world" },
    }));
    await batcher.enqueue(event(3, {
      type: "event",
      event: {
        type: "messageCompleted",
        id: "message-1",
        phase: "final",
        text: "hello world",
      },
    }));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([event(3, {
      type: "event",
      event: {
        type: "messageCompleted",
        id: "message-1",
        phase: "final",
        text: "hello world",
      },
    })]);
  });

  it("keeps pending delta text when a terminal snapshot does not contain it", async () => {
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1, {
      type: "event",
      event: {
        type: "activityDelta",
        id: "activity-1",
        delta: "diagnostic output",
      },
    }));
    await batcher.enqueue(event(2, {
      type: "event",
      event: {
        type: "activityCompleted",
        id: "activity-1",
        kind: "command",
        title: "Run check",
        text: "different summary",
        status: "failed",
      },
    }));

    expect(batches[0]).toHaveLength(2);
    expect(batches[0]?.[0]).toMatchObject({
      payload: { event: { delta: "diagnostic output" } },
    });
  });

  it("splits coalesced deltas before the per-event payload limit", async () => {
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      flushIntervalMs: 60_000,
    });

    for (let sequence = 1; sequence <= 2; sequence += 1) {
      await batcher.enqueue(event(sequence, {
        type: "event",
        event: {
          type: "activityDelta",
          id: "activity-1",
          delta: "x".repeat(20_000),
        },
      }));
    }
    await batcher.flush();

    expect(batches[0]).toHaveLength(2);
    expect(batches[0]?.every((archivedEvent) =>
      Buffer.byteLength(JSON.stringify(archivedEvent.payload), "utf8") <=
        30 * 1024
    )).toBe(true);
  });

  it.each([
    { type: "result", message: "done" },
    { type: "error", message: "failed" },
    { type: "blocked", message: "sign in" },
    { type: "approval", id: "approval-1" },
    { type: "event", event: { type: "conversationStarted" } },
    { type: "event", event: { type: "messageStarted" } },
    { type: "event", event: { type: "messageCompleted" } },
    { type: "event", event: { type: "activityStarted" } },
    { type: "event", event: { type: "activityCompleted" } },
    { type: "event", event: { type: "turnCompleted" } },
  ])("flushes a visible status boundary immediately: $type", async (payload) => {
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1, { text: "buffered delta" }));
    await batcher.enqueue(event(2, payload));

    expect(batches).toEqual([[
      event(1, { text: "buffered delta" }),
      event(2, payload),
    ]]);
  });

  it("flushes at count and byte bounds", async () => {
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      maxEvents: 2,
      maxBytes: 130,
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2));
    await batcher.enqueue(event(3, { text: "x".repeat(100) }));
    await batcher.flush();

    expect(batches.map((batch) => batch.map(({ sequence }) => sequence)))
      .toEqual([[1, 2], [3]]);
  });

  it("measures the complete request envelope when choosing a byte boundary", async () => {
    const batches: TranscriptBatchEvent[][] = [];
    const serialize = (events: TranscriptBatchEvent[]) =>
      JSON.stringify({
        projectId: "11111111-1111-4111-8111-111111111111",
        sessionId: "session-with-envelope-overhead",
        events,
      });
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      measureBytes: (events) => Buffer.byteLength(serialize(events), "utf8"),
      maxBytes: Buffer.byteLength(serialize([event(1)]), "utf8") + 1,
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2));
    await batcher.flush();

    expect(batches.map((batch) => batch.map(({ sequence }) => sequence)))
      .toEqual([[1], [2]]);
    expect(batches.every((batch) =>
      Buffer.byteLength(serialize(batch), "utf8") <=
        Buffer.byteLength(serialize([event(1)]), "utf8") + 1
    )).toBe(true);
  });

  it("retries transient failures without reordering batches", async () => {
    const attempts: number[][] = [];
    const errors: unknown[] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        attempts.push(events.map(({ sequence }) => sequence));
        if (attempts.length === 1) throw new Error("offline");
      },
      onError: (error) => errors.push(error),
      maxEvents: 1,
      retryDelayMs: 0,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2));

    expect(attempts).toEqual([[1], [1], [2]]);
    expect(errors).toHaveLength(0);
  });

  it("flushes a replayable compacted delta before an interrupted turn and retries it identically", async () => {
    const attempts: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        attempts.push(structuredClone(events));
        if (attempts.length === 1) throw new Error("response lost");
      },
      retryDelayMs: 0,
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1, {
      type: "event",
      event: { type: "messageDelta", id: "message-1", delta: "partial " },
    }));
    await batcher.enqueue(event(2, {
      type: "event",
      event: { type: "messageDelta", id: "message-1", delta: "answer" },
    }));
    await batcher.enqueue(event(3, {
      type: "event",
      event: { type: "turnCompleted", status: "failed" },
    }));

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0]).toHaveLength(2);
    expect(attempts[0]?.[0]).toMatchObject({
      sequence: 2,
      payload: {
        event: { type: "messageDelta", delta: "partial answer" },
        archiveCompaction: { firstSequence: 1, eventCount: 2 },
      },
    });
    expect(attempts[0]?.[1]).toEqual(event(3, {
      type: "event",
      event: { type: "turnCompleted", status: "failed" },
    }));
  });

  it("splits a 413 batch without retrying the oversized request", async () => {
    class PayloadTooLargeError extends Error {}
    const attempts: number[][] = [];
    const errors: unknown[] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        attempts.push(events.map(({ sequence }) => sequence));
        if (events.length > 2) throw new PayloadTooLargeError("too large");
      },
      onError: (error) => errors.push(error),
      isPayloadTooLarge: (error) => error instanceof PayloadTooLargeError,
      maxEvents: 4,
      retryDelayMs: 0,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2));
    await batcher.enqueue(event(3));
    await batcher.enqueue(event(4));

    expect(attempts).toEqual([[1, 2, 3, 4], [1, 2], [3, 4]]);
    expect(errors).toHaveLength(0);
  });

  it("sends a single event above the batch budget alone", async () => {
    class PayloadTooLargeError extends Error {}
    const attempts: number[][] = [];
    const errors: unknown[] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        attempts.push(events.map(({ sequence }) => sequence));
        if (events[0]?.sequence === 2) {
          throw new PayloadTooLargeError("single event too large");
        }
      },
      onError: (error) => errors.push(error),
      isPayloadTooLarge: (error) => error instanceof PayloadTooLargeError,
      maxBytes: 100,
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2, { text: "x".repeat(1_000) }));
    await batcher.enqueue(event(3));
    await batcher.flush();

    expect(attempts).toEqual([[1], [2], [3]]);
    expect(errors).toHaveLength(1);
  });

  it(
    "flushes buffered events when a caller finalizes before shutdown",
    async () => {
      const delivered: number[] = [];
      const batcher = new TranscriptBatcher({
        send: async (events) => {
          delivered.push(...events.map(({ sequence }) => sequence));
        },
        flushIntervalMs: 60_000,
      });

      await batcher.enqueue(event(1));
      await batcher.enqueue(event(2));
      await batcher.flush();

      expect(delivered).toEqual([1, 2]);
    },
  );

  it("keeps transcript failures from failing work after bounded retries", async () => {
    const errors: unknown[] = [];
    const delivered: number[] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        if (events[0]?.sequence === 1) throw new Error("offline");
        delivered.push(...events.map(({ sequence }) => sequence));
      },
      onError: (error) => errors.push(error),
      maxEvents: 1,
      maxSendAttempts: 2,
      retryDelayMs: 0,
    });

    await expect(batcher.enqueue(event(1))).resolves.toBeUndefined();
    await expect(batcher.enqueue(event(2))).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(delivered).toEqual([2]);
  });
});
