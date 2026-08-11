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
  private events: TranscriptBatchEvent[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sendChain = Promise.resolve();

  constructor(private readonly options: TranscriptBatcherOptions) {
    this.maxEvents = options.maxEvents ?? TRANSCRIPT_BATCH_MAX_EVENTS;
    this.maxBytes = options.maxBytes ?? TRANSCRIPT_BATCH_MAX_BYTES;
    this.flushIntervalMs =
      options.flushIntervalMs ?? TRANSCRIPT_BATCH_FLUSH_INTERVAL_MS;
    if (
      this.maxEvents < 1 ||
      this.maxBytes < 1 ||
      this.flushIntervalMs < 1
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
      this.sendChain = this.sendChain
        .then(() => this.options.send(batch))
        .catch((error) => {
          this.options.onError?.(error);
        });
    }
    await this.sendChain;
  }

  private scheduleFlush() {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private clearTimer() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
