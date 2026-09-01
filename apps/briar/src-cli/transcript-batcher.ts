import {
  create,
  toBinary,
} from "@bufbuild/protobuf";
import {
  AgentTranscriptEventSchema,
  type AgentTranscriptEvent,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  NormalizedAgentEventSchema,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";

/** The generated Worker contract remains authoritative throughout batching. */
export type TranscriptBatchEvent = AgentTranscriptEvent;

type TranscriptBatcherOptions = {
  send: (events: TranscriptBatchEvent[]) => Promise<void>;
  onError?: (error: unknown) => void;
  isPayloadTooLarge?: (error: unknown) => boolean;
  shouldFlushImmediately?: (event: TranscriptBatchEvent) => boolean;
  measureBytes?: (events: TranscriptBatchEvent[]) => number;
  maxEvents?: number;
  maxBytes?: number;
  flushIntervalMs?: number;
  maxBufferMs?: number;
  maxSendAttempts?: number;
  retryDelayMs?: number;
};

// Keep small margins below the Worker's 200 event and 1 MiB request limits.
export const TRANSCRIPT_BATCH_MAX_EVENTS = 192;
export const TRANSCRIPT_BATCH_MAX_BYTES = 896 * 1024;
export const TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS = 500;
export const TRANSCRIPT_BATCH_MAX_BUFFER_MS = 5_000;
export const TRANSCRIPT_COMPACTED_DELTA_MAX_BYTES = 30 * 1024;

type DeltaDescriptor = {
  type: "messageDelta" | "activityDelta";
  id: string;
  delta: string;
  firstSequence: bigint;
  eventCount: number;
};

const deltaDescriptor = (
  event: TranscriptBatchEvent,
): DeltaDescriptor | null => {
  const normalized = event.normalized?.event;
  if (
    normalized?.case !== "messageDelta" &&
    normalized?.case !== "activityDelta"
  ) {
    return null;
  }
  return {
    type: normalized.case,
    id: normalized.value.id,
    delta: normalized.value.delta,
    firstSequence: event.archiveCompaction?.firstSequence ?? event.sequence,
    eventCount: event.archiveCompaction?.representedEventCount ?? 1,
  };
};

const compactedDeltaEvent = (
  event: TranscriptBatchEvent,
  descriptor: DeltaDescriptor,
  input: {
    delta: string;
    firstSequence: bigint;
    eventCount: number;
  },
): TranscriptBatchEvent =>
  create(AgentTranscriptEventSchema, {
    sequence: event.sequence,
    direction: event.direction,
    normalized: create(NormalizedAgentEventSchema, {
      event: descriptor.type === "messageDelta"
        ? {
            case: "messageDelta",
            value: { id: descriptor.id, delta: input.delta },
          }
        : {
            case: "activityDelta",
            value: { id: descriptor.id, delta: input.delta },
          },
    }),
    archiveCompaction: {
      firstSequence: input.firstSequence,
      representedEventCount: input.eventCount,
    },
  });

const snapshotDescriptor = (event: TranscriptBatchEvent) => {
  const normalized = event.normalized?.event;
  if (
    normalized?.case !== "messageStarted" &&
    normalized?.case !== "messageCompleted" &&
    normalized?.case !== "activityStarted" &&
    normalized?.case !== "activityCompleted"
  ) {
    return null;
  }
  const text = normalized.value.text;
  if (
    !text ||
    text.includes("… truncated …") ||
    text.includes("… output truncated …")
  ) {
    return null;
  }
  return {
    deltaType: normalized.case.startsWith("message")
      ? "messageDelta" as const
      : "activityDelta" as const,
    id: normalized.value.id,
    text,
  };
};

/**
 * Raw archives retain normalized delta text, not the provider's repeated raw
 * streaming envelope. A terminal full-text snapshot supersedes unsent deltas;
 * otherwise consecutive deltas remain replayable as one annotated event.
 */
export function compactTranscriptBatch(
  events: TranscriptBatchEvent[],
  event: TranscriptBatchEvent,
) {
  const snapshot = snapshotDescriptor(event);
  if (snapshot) {
    const pending = events.filter((candidate) => {
      const descriptor = deltaDescriptor(candidate);
      return descriptor?.type === snapshot.deltaType &&
        descriptor.id === snapshot.id &&
        candidate.direction === event.direction;
    });
    const pendingText = pending.map((candidate) =>
      deltaDescriptor(candidate)!.delta
    ).join("");
    if (pendingText && snapshot.text.endsWith(pendingText)) {
      return [
        ...events.filter((candidate) => !pending.includes(candidate)),
        event,
      ];
    }
    return [...events, event];
  }

  const descriptor = deltaDescriptor(event);
  if (!descriptor) return [...events, event];
  const compacted = compactedDeltaEvent(event, descriptor, {
    delta: descriptor.delta,
    firstSequence: descriptor.firstSequence,
    eventCount: descriptor.eventCount,
  });
  const previous = events.at(-1);
  const previousDescriptor = previous && deltaDescriptor(previous);
  if (
    !previous || !previousDescriptor ||
    previous.direction !== event.direction ||
    previousDescriptor.type !== descriptor.type ||
    previousDescriptor.id !== descriptor.id
  ) {
    return [...events, compacted];
  }
  const merged = compactedDeltaEvent(event, descriptor, {
    delta: `${previousDescriptor.delta}${descriptor.delta}`,
    firstSequence: previousDescriptor.firstSequence,
    eventCount: previousDescriptor.eventCount + descriptor.eventCount,
  });
  if (
    toBinary(AgentTranscriptEventSchema, merged).byteLength >
      TRANSCRIPT_COMPACTED_DELTA_MAX_BYTES
  ) {
    return [...events, compacted];
  }
  return [...events.slice(0, -1), merged];
}

const immediateSidecarPayloads = new Set([
  "approval",
  "blocked",
  "error",
  "result",
]);

const immediateNormalizedEvents = new Set([
  "activityCompleted",
  "activityStarted",
  "conversationStarted",
  "messageCompleted",
  "messageStarted",
  "turnCompleted",
]);

/** Status boundaries reach transcript-backed UI without waiting for the timer. */
export function transcriptEventRequiresImmediateFlush(
  event: TranscriptBatchEvent,
) {
  const normalizedCase = event.normalized?.event.case;
  if (normalizedCase && immediateNormalizedEvents.has(normalizedCase)) {
    return true;
  }
  const raw = event.rawPayload;
  if (raw?.kind.case !== "structValue") return false;
  return Object.keys(raw.kind.value.fields).some((key) =>
    immediateSidecarPayloads.has(key)
  );
}

/**
 * Buffers optional transcript events while preserving their send order.
 * Threshold-triggered flushes apply backpressure to the provider stdout loop,
 * so a slow API cannot grow the worker's memory without a bound.
 */
export class TranscriptBatcher {
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferMs: number;
  private readonly maxSendAttempts: number;
  private readonly retryDelayMs: number;
  private events: TranscriptBatchEvent[] = [];
  private bytes = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private sendChain = Promise.resolve();

  constructor(private readonly options: TranscriptBatcherOptions) {
    this.maxEvents = options.maxEvents ?? TRANSCRIPT_BATCH_MAX_EVENTS;
    this.maxBytes = options.maxBytes ?? TRANSCRIPT_BATCH_MAX_BYTES;
    this.flushIntervalMs =
      options.flushIntervalMs ?? TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS;
    this.maxBufferMs = options.maxBufferMs ?? TRANSCRIPT_BATCH_MAX_BUFFER_MS;
    this.maxSendAttempts = options.maxSendAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    if (
      this.maxEvents < 1 ||
      this.maxBytes < 1 ||
      this.flushIntervalMs < 1 ||
      this.maxBufferMs < 1 ||
      this.maxSendAttempts < 1 ||
      this.retryDelayMs < 0
    ) {
      throw new Error("Transcript batch thresholds must be positive");
    }
  }

  async enqueue(event: TranscriptBatchEvent): Promise<void> {
    let candidate = compactTranscriptBatch(this.events, event);
    const candidateBytes = this.measureBytes(candidate);
    if (
      this.events.length > 0 &&
      (candidate.length > this.maxEvents || candidateBytes > this.maxBytes)
    ) {
      await this.flush();
      candidate = compactTranscriptBatch([], event);
    }
    this.events = candidate;
    this.bytes = this.measureBytes(this.events);
    if (
      this.events.length >= this.maxEvents ||
      this.bytes >= this.maxBytes ||
      (this.options.shouldFlushImmediately ??
        transcriptEventRequiresImmediateFlush)(event)
    ) {
      await this.flush();
      return;
    }
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    this.clearTimers();
    if (this.events.length > 0) {
      const batch = this.events;
      this.events = [];
      this.bytes = 0;
      this.sendChain = this.sendChain.then(() => this.deliver(batch));
    }
    await this.sendChain;
  }

  private scheduleFlush() {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // Keep timer callbacks from creating unhandled rejections.
      void this.flush().catch(() => {});
    }, this.flushIntervalMs);
    if (this.maxTimer !== null) return;
    this.maxTimer = setTimeout(() => {
      this.maxTimer = null;
      // A sustained stream still gets a bounded recovery checkpoint.
      void this.flush().catch(() => {});
    }, this.maxBufferMs);
  }

  private measureBytes(events: TranscriptBatchEvent[]) {
    return this.options.measureBytes?.(events) ??
      events.reduce(
        (total, event) =>
          total + toBinary(AgentTranscriptEventSchema, event).byteLength,
        0,
      );
  }

  private async deliver(batch: TranscriptBatchEvent[]): Promise<void> {
    try {
      await this.sendWithRetry(batch);
    } catch (error) {
      if (this.options.isPayloadTooLarge?.(error) && batch.length > 1) {
        const midpoint = Math.ceil(batch.length / 2);
        await this.deliver(batch.slice(0, midpoint));
        await this.deliver(batch.slice(midpoint));
        return;
      }
      // A single event cannot be split further. Its bounded retry/error path is
      // the fallback for payloads that still exceed the server's event limit.
      try {
        this.options.onError?.(error);
      } catch {
        // Transcript telemetry is optional. Error reporting must not fail work.
      }
    }
  }

  private async sendWithRetry(batch: TranscriptBatchEvent[]) {
    let lastFailure: TranscriptDeliveryFailure | null = null;
    for (let attempt = 1; attempt <= this.maxSendAttempts; attempt += 1) {
      try {
        await this.options.send(batch);
        return;
      } catch (error) {
        lastFailure = { error };
        if (this.options.isPayloadTooLarge?.(error)) throw error;
        if (attempt < this.maxSendAttempts && this.retryDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs * attempt)
          );
        }
      }
    }
    throw lastFailure?.error;
  }

  private clearTimers() {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.maxTimer !== null) clearTimeout(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
  }
}

interface TranscriptDeliveryFailure {
  error: unknown;
}
