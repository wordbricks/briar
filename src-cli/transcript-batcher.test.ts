import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

  it("flushes at count and byte bounds", async () => {
    const batches: TranscriptBatchEvent[][] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        batches.push(events);
      },
      maxEvents: 2,
      maxBytes: 120,
      flushIntervalMs: 60_000,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2));
    await batcher.enqueue(event(3, { text: "x".repeat(100) }));
    await batcher.flush();

    expect(batches.map((batch) => batch.map(({ sequence }) => sequence)))
      .toEqual([[1, 2], [3]]);
  });

  it("serializes sends and continues after an optional upload fails", async () => {
    const attempts: number[][] = [];
    const errors: unknown[] = [];
    const batcher = new TranscriptBatcher({
      send: async (events) => {
        attempts.push(events.map(({ sequence }) => sequence));
        if (attempts.length === 1) throw new Error("offline");
      },
      onError: (error) => errors.push(error),
      maxEvents: 1,
    });

    await batcher.enqueue(event(1));
    await batcher.enqueue(event(2));

    expect(attempts).toEqual([[1], [2]]);
    expect(errors).toHaveLength(1);
  });
});
