export type TranscriptBatchEvent = {
  sequence: number;
  direction: "client" | "server";
  payload: unknown;
};

type TranscriptBatcherOptions = {
  send: (events: TranscriptBatchEvent[]) => Promise<void>;
  onError?: (error: unknown) => void;
  maxEvents?: number;
  maxBytes?: number;
  flushIntervalMs?: number;
  maxSendAttempts?: number;
  retryDelayMs?: number;
};

export const TRANSCRIPT_BATCH_MAX_EVENTS = 100;
export const TRANSCRIPT_BATCH_MAX_BYTES = 512 * 1024;
export const TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS = 250;

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
    const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    if (this.events.length > 0 && this.bytes + eventBytes > this.maxBytes) {
      await this.flush();
    }
    this.events.push(event);
    this.bytes += eventBytes;
    if (this.events.length >= this.maxEvents || this.bytes >= this.maxBytes) {
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
      this.sendChain = this.sendChain.then(() => this.sendWithRetry(batch));
    }
    await this.sendChain;
  }

  private scheduleFlush() {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // The next explicit enqueue/flush observes the rejected send chain.
      // Avoid an unhandled rejection from the timer itself.
      void this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }

  private async sendWithRetry(batch: TranscriptBatchEvent[]) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxSendAttempts; attempt += 1) {
      try {
        await this.options.send(batch);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxSendAttempts && this.retryDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs * attempt)
          );
        }
      }
    }
    this.options.onError?.(lastError);
    throw lastError;
  }

  private clearTimer() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
