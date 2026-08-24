import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS,
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
  });

  it("halves requests for a sustained stream of small deltas", async () => {
    vi.useFakeTimers();
    const requestCount = async (flushIntervalMs: number) => {
      let requests = 0;
      const batcher = new TranscriptBatcher({
        send: async () => {
          requests += 1;
        },
        flushIntervalMs,
        maxEvents: 10_000,
        maxBytes: 10 * 1024 * 1024,
      });
      for (let sequence = 1; sequence <= 1_000; sequence += 1) {
        await batcher.enqueue(event(sequence, {
          type: "event",
          event: { type: "messageDelta", delta: "x" },
        }));
        await vi.advanceTimersByTimeAsync(10);
      }
      await batcher.flush();
      return requests;
    };

    const previousRequests = await requestCount(250);
    const optimizedRequests = await requestCount(
      TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS,
    );

    expect(previousRequests).toBe(40);
    expect(optimizedRequests).toBe(20);
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
