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
  maxSendAttempts?: number;
  retryDelayMs?: number;
};

// Keep small margins below the Worker's 200 event and 1 MiB request limits.
export const TRANSCRIPT_BATCH_MAX_EVENTS = 192;
export const TRANSCRIPT_BATCH_MAX_BYTES = 896 * 1024;
export const TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS = 500;

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
  private readonly maxSendAttempts: number;
  private readonly retryDelayMs: number;
  private events: TranscriptBatchEvent[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sendChain = Promise.resolve();

  constructor(private readonly options: TranscriptBatcherOptions) {
    this.maxEvents = options.maxEvents ?? TRANSCRIPT_BATCH_MAX_EVENTS;
    this.maxBytes = options.maxBytes ?? TRANSCRIPT_BATCH_MAX_BYTES;
    this.flushIntervalMs =
      options.flushIntervalMs ?? TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS;
    this.maxSendAttempts = options.maxSendAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    if (
      this.maxEvents < 1 ||
      this.maxBytes < 1 ||
      this.flushIntervalMs < 1 ||
      this.maxSendAttempts < 1 ||
      this.retryDelayMs < 0
    ) {
      throw new Error("Transcript batch thresholds must be positive");
    }
  }

  async enqueue(event: TranscriptBatchEvent): Promise<void> {
    const candidate = [...this.events, event];
    const candidateBytes = this.measureBytes(candidate);
    if (
      this.events.length > 0 &&
      (candidate.length > this.maxEvents || candidateBytes > this.maxBytes)
    ) {
      await this.flush();
    }
    this.events.push(event);
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
    this.clearTimer();
    if (this.events.length > 0) {
      const batch = this.events;
      this.events = [];
      this.bytes = 0;
      this.sendChain = this.sendChain.then(() => this.deliver(batch));
    }
    await this.sendChain;
  }

  private scheduleFlush() {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // Keep timer callbacks from creating unhandled rejections.
      void this.flush().catch(() => {});
    }, this.flushIntervalMs);
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

  private clearTimer() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

interface TranscriptDeliveryFailure {
  error: unknown;
}
