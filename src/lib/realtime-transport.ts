export type RealtimeNotification =
  | {
      topic: "channels";
      cursor: number;
    }
  | {
      topic: "project";
      projectId: string;
      cursor: number;
    };

export interface RealtimeTransport {
  start(): void;
  stop(): void;
  subscribe(listener: (notification: RealtimeNotification) => void): () => void;
}

type SseRealtimeTransportOptions = {
  url: string;
  token: string;
  fetch?: FetchLike;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type WebSocketRealtimeTransportOptions = {
  url: string;
  token: string;
  fetch?: FetchLike;
  createWebSocket?: (url: string) => WebSocket;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ParsedSseEvent = { event: string; data: string };

/** Incremental SSE decoder kept transport-agnostic for fragmented fetch streams. */
export class SseEventDecoder {
  private buffer = "";
  private event = "message";
  private data: string[] = [];

  push(chunk: string): ParsedSseEvent[] {
    this.buffer += chunk;
    const events: ParsedSseEvent[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const parsed = this.consumeLine(line);
      if (parsed) events.push(parsed);
      newline = this.buffer.indexOf("\n");
    }
    return events;
  }

  private consumeLine(line: string): ParsedSseEvent | null {
    if (line === "") {
      if (this.data.length === 0) {
        this.event = "message";
        return null;
      }
      const parsed = { event: this.event, data: this.data.join("\n") };
      this.event = "message";
      this.data = [];
      return parsed;
    }
    if (line.startsWith(":")) return null;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value || "message";
    else if (field === "data") this.data.push(value);
    return null;
  }
}

const realtimeNotification = (value: unknown): RealtimeNotification | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RealtimeNotification>;
  if (!Number.isSafeInteger(candidate.cursor) || (candidate.cursor ?? -1) < 0) {
    return null;
  }
  if (candidate.topic === "channels") {
    return { topic: "channels", cursor: candidate.cursor! };
  }
  const project = value as { topic?: unknown; projectId?: unknown };
  return project.topic === "project" &&
      typeof project.projectId === "string" &&
      /^[0-9a-f-]+$/iu.test(project.projectId)
    ? {
        topic: "project",
        projectId: project.projectId,
        cursor: candidate.cursor!,
      }
    : null;
};

/**
 * Authenticated fetch-stream SSE adapter.
 *
 * Domain consumers depend only on RealtimeTransport. Replacing this adapter
 * with WebSocket later does not change channel cursors, delta recovery, or UI
 * state reconciliation.
 */
export class SseRealtimeTransport implements RealtimeTransport {
  private readonly listeners = new Set<
    (notification: RealtimeNotification) => void
  >();
  private readonly fetchImpl: FetchLike;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private active = false;
  private generation = 0;
  private abortController: AbortController | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs: number;

  constructor(private readonly options: SseRealtimeTransportOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.reconnectDelayMs = this.reconnectBaseMs;
  }

  subscribe(listener: (notification: RealtimeNotification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.reconnectDelayMs = this.reconnectBaseMs;
    const generation = ++this.generation;
    void this.connect(generation);
  }

  stop() {
    if (!this.active && !this.abortController && this.reconnectTimer === null) {
      return;
    }
    this.active = false;
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async connect(generation: number) {
    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      const response = await this.fetchImpl(this.options.url, {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.options.token}`,
          "Cache-Control": "no-cache",
        },
        signal: abortController.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Realtime stream failed (${response.status})`);
      }
      this.reconnectDelayMs = this.reconnectBaseMs;
      await this.consume(response.body, generation);
    } catch (error) {
      if (abortController.signal.aborted) return;
      console.warn("Channel realtime stream disconnected", error);
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
    if (this.active && generation === this.generation) {
      this.scheduleReconnect(generation);
    }
  }

  private async consume(stream: ReadableStream<Uint8Array>, generation: number) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const sse = new SseEventDecoder();
    try {
      while (this.active && generation === this.generation) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of sse.push(decoder.decode(value, { stream: true }))) {
          if (event.event !== "ready" && event.event !== "change") continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            continue;
          }
          const notification = realtimeNotification(parsed);
          if (!notification) continue;
          for (const listener of this.listeners) listener(notification);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private scheduleReconnect(generation: number) {
    const jitter = 0.75 + Math.random() * 0.5;
    const delay = Math.min(
      this.reconnectDelayMs * jitter,
      this.reconnectMaxMs,
    );
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      this.reconnectMaxMs,
    );
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active && generation === this.generation) {
        void this.connect(generation);
      }
    }, delay);
  }
}

/**
 * Fetches a short-lived authenticated socket URL, then keeps only a browser
 * WebSocket open. The server-side Durable Object can hibernate between cursor
 * notifications because no ReadableStream controller remains attached.
 */
export class WebSocketRealtimeTransport implements RealtimeTransport {
  private readonly listeners = new Set<
    (notification: RealtimeNotification) => void
  >();
  private readonly fetchImpl: FetchLike;
  private readonly createSocket: (url: string) => WebSocket;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private active = false;
  private generation = 0;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs: number;

  constructor(private readonly options: WebSocketRealtimeTransportOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.createSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.reconnectDelayMs = this.reconnectBaseMs;
  }

  subscribe(listener: (notification: RealtimeNotification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.reconnectDelayMs = this.reconnectBaseMs;
    const generation = ++this.generation;
    void this.connect(generation);
  }

  stop() {
    this.active = false;
    this.generation += 1;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "Realtime transport stopped");
  }

  private async connect(generation: number) {
    try {
      const response = await this.fetchImpl(this.options.url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Realtime ticket failed (${response.status})`);
      }
      const body = await response.json() as { url?: unknown };
      if (typeof body.url !== "string" || !/^wss?:\/\//u.test(body.url)) {
        throw new Error("Realtime ticket returned an invalid WebSocket URL");
      }
      if (!this.active || generation !== this.generation) return;
      const socket = this.createSocket(body.url);
      this.socket = socket;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (this.socket === socket) this.socket = null;
        if (this.active && generation === this.generation) {
          this.scheduleReconnect(generation);
        }
      };
      socket.addEventListener("open", () => {
        this.reconnectDelayMs = this.reconnectBaseMs;
      });
      socket.addEventListener("message", (event) => {
        if (!this.active || generation !== this.generation) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            typeof event.data === "string" ? event.data : "",
          );
        } catch {
          return;
        }
        const notification = realtimeNotification(parsed);
        if (!notification) return;
        for (const listener of this.listeners) listener(notification);
      });
      socket.addEventListener("close", finish);
      socket.addEventListener("error", () => {
        socket.close(1011, "Realtime socket failed");
        finish();
      });
    } catch (error) {
      console.warn("Channel realtime socket disconnected", error);
      if (this.active && generation === this.generation) {
        this.scheduleReconnect(generation);
      }
    }
  }

  private scheduleReconnect(generation: number) {
    if (this.reconnectTimer !== null) return;
    const jitter = 0.75 + Math.random() * 0.5;
    const delay = Math.min(
      this.reconnectDelayMs * jitter,
      this.reconnectMaxMs,
    );
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      this.reconnectMaxMs,
    );
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active && generation === this.generation) {
        void this.connect(generation);
      }
    }, delay);
  }
}
