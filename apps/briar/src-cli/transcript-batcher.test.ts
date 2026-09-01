import {
  create,
  fromJson,
} from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
} from "@connectrpc/connect";
import {
  AgentTranscriptEventSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  AgentEventDirection,
  NormalizedAgentEventSchema,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
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
): TranscriptBatchEvent => create(AgentTranscriptEventSchema, {
  sequence: BigInt(sequence),
  direction: AgentEventDirection.SERVER,
  rawPayload: fromJson(ValueSchema, { providerSequence: sequence }),
  normalized: create(NormalizedAgentEventSchema, {
    event: {
      case: "messageDelta",
      value: { id: "message-1", delta: text },
    },
  }),
});

const opaque = (
  sequence: number,
  direction = AgentEventDirection.SERVER,
): TranscriptBatchEvent => create(AgentTranscriptEventSchema, {
  sequence: BigInt(sequence),
  direction,
  rawPayload: fromJson(ValueSchema, { opaque: sequence }),
});

describe("TranscriptBatcher", () => {
  it("compacts replayable deltas and lets a terminal snapshot supersede them", () => {
    const compacted = compactTranscriptBatch(
      compactTranscriptBatch([], delta(10, "hel")),
      delta(11, "lo"),
    );
    expect(compacted).toHaveLength(1);
    expect(compacted[0]?.sequence).toBe(11n);
    expect(compacted[0]?.rawPayload).toBeUndefined();
    expect(compacted[0]?.archiveCompaction).toMatchObject({
      firstSequence: 10n,
      representedEventCount: 2,
    });
    expect(compacted[0]?.normalized?.event).toMatchObject({
      case: "messageDelta",
      value: { id: "message-1", delta: "hello" },
    });

    const snapshot = create(AgentTranscriptEventSchema, {
      sequence: 12n,
      direction: AgentEventDirection.SERVER,
      normalized: create(NormalizedAgentEventSchema, {
        event: {
          case: "messageCompleted",
          value: { id: "message-1", phase: "final", text: "hello" },
        },
      }),
    });
    expect(compactTranscriptBatch(compacted, snapshot)).toEqual([snapshot]);
  });

  it("preserves batch order across bounded transient retries", async () => {
    const delivered: bigint[][] = [];
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

    await batcher.enqueue(opaque(1));
    await batcher.enqueue(opaque(2));
    await batcher.enqueue(opaque(3, AgentEventDirection.CLIENT));
    await batcher.flush();

    expect(attempts).toBe(3);
    expect(delivered).toEqual([[1n, 2n], [3n]]);
  });

  it("splits only Connect ResourceExhausted responses and keeps event order", async () => {
    const calls: bigint[][] = [];
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
      await batcher.enqueue(opaque(sequence));
    }
    expect(calls).toEqual([[1n, 2n, 3n, 4n], [1n, 2n], [3n, 4n]]);

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
    await genericFailure.enqueue(opaque(5));
    expect(genericAttempts).toBe(2);
    expect(onError).toHaveBeenCalledOnce();
  });
});
