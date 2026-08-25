export type TranscriptBatchEvent = {
  sequence: number;
  direction: "client" | "server";
  payload: unknown;
};

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

type TranscriptPayloadRecord = Record<string, unknown>;

type DeltaDescriptor = {
  type: "messageDelta" | "activityDelta";
  id: string;
  delta: string;
  normalized: TranscriptPayloadRecord;
  nested: boolean;
  firstSequence: number;
  eventCount: number;
};

const payloadRecord = (value: unknown): TranscriptPayloadRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as TranscriptPayloadRecord)
    : null;

const normalizedPayload = (payload: unknown) => {
  const envelope = payloadRecord(payload);
  if (!envelope) return null;
  const nested = envelope.type === "event";
  const normalized = nested ? payloadRecord(envelope.event) : envelope;
  return normalized ? { envelope, normalized, nested } : null;
};

const compactionRecord = (payload: TranscriptPayloadRecord) => {
  const value = payloadRecord(payload.archiveCompaction);
  return value?.kind === "delta" &&
      Number.isSafeInteger(value.firstSequence) &&
      Number.isSafeInteger(value.eventCount)
    ? {
        firstSequence: value.firstSequence as number,
        eventCount: value.eventCount as number,
      }
    : null;
};

const deltaDescriptor = (
  event: TranscriptBatchEvent,
): DeltaDescriptor | null => {
  const payload = normalizedPayload(event.payload);
  if (!payload) return null;
  const type = payload.normalized.type;
  if (type !== "messageDelta" && type !== "activityDelta") return null;
  if (
    typeof payload.normalized.id !== "string" ||
    typeof payload.normalized.delta !== "string"
  ) {
    return null;
  }
  const compacted = compactionRecord(payload.envelope);
  return {
    type,
    id: payload.normalized.id,
    delta: payload.normalized.delta,
    normalized: payload.normalized,
    nested: payload.nested,
    firstSequence: compacted?.firstSequence ?? event.sequence,
    eventCount: compacted?.eventCount ?? 1,
  };
};

const compactedDeltaEvent = (
  event: TranscriptBatchEvent,
  descriptor: DeltaDescriptor,
  input: {
    delta: string;
    firstSequence: number;
    eventCount: number;
  },
): TranscriptBatchEvent => {
  const envelope = payloadRecord(event.payload)!;
  const normalized = { ...descriptor.normalized, delta: input.delta };
  const archiveCompaction = {
    kind: "delta",
    firstSequence: input.firstSequence,
    eventCount: input.eventCount,
  } as const;
  return {
    ...event,
    payload: descriptor.nested
      ? {
          type: "event",
          ...(envelope.direction === "client" ? { direction: "client" } : {}),
          event: normalized,
          archiveCompaction,
        }
      : { ...normalized, archiveCompaction },
  };
};

const snapshotDescriptor = (event: TranscriptBatchEvent) => {
  const payload = normalizedPayload(event.payload);
  if (!payload) return null;
  const type = payload.normalized.type;
  if (
    type !== "messageStarted" && type !== "messageCompleted" &&
    type !== "activityStarted" && type !== "activityCompleted"
  ) {
    return null;
  }
  if (
    typeof payload.normalized.id !== "string" ||
    typeof payload.normalized.text !== "string" ||
    !payload.normalized.text ||
    payload.normalized.text.includes("… truncated …") ||
    payload.normalized.text.includes("… output truncated …")
  ) {
    return null;
  }
  return {
    deltaType: type.startsWith("message")
      ? "messageDelta" as const
      : "activityDelta" as const,
    id: payload.normalized.id,
    text: payload.normalized.text,
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
    Buffer.byteLength(JSON.stringify(merged.payload), "utf8") >
      TRANSCRIPT_COMPACTED_DELTA_MAX_BYTES
  ) {
    return [...events, compacted];
  }
  return [...events.slice(0, -1), merged];
}

const immediatePayloadTypes = new Set([
  "approval",
  "blocked",
  "error",
  "result",
]);

const immediateNormalizedEventTypes = new Set([
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
  if (!event.payload || typeof event.payload !== "object") return false;
  const payload = event.payload as Record<string, unknown>;
  if (
    typeof payload.type === "string" &&
    immediatePayloadTypes.has(payload.type)
  ) {
    return true;
  }
  if (
    payload.type !== "event" ||
    !payload.event ||
    typeof payload.event !== "object"
  ) {
    return false;
  }
  const normalizedType = (payload.event as Record<string, unknown>).type;
  return typeof normalizedType === "string" &&
    immediateNormalizedEventTypes.has(normalizedType);
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
      Buffer.byteLength(JSON.stringify(events), "utf8");
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
