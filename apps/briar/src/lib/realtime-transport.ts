import * as Option from "effect/Option";
import {
  decodeRealtimeNotificationBinary,
  decodeWebSocketTicket,
  type RealtimeNotification,
} from "./realtime-protocol";

export type { RealtimeNotification } from "./realtime-protocol";

export interface RealtimeTransport {
  start(): void;
  stop(): void;
  subscribe(listener: (notification: RealtimeNotification) => void): () => void;
}

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
      const ticket = decodeWebSocketTicket(await response.json());
      if (Option.isNone(ticket)) {
        throw new Error("Realtime ticket returned an invalid WebSocket URL");
      }
      if (!this.active || generation !== this.generation) return;
      const socket = this.createSocket(ticket.value.url);
      socket.binaryType = "arraybuffer";
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
        if (!(event.data instanceof ArrayBuffer)) return;
        const notification = decodeRealtimeNotificationBinary(
          new Uint8Array(event.data),
        );
        if (Option.isNone(notification)) return;
        for (const listener of this.listeners) listener(notification.value);
      });
      socket.addEventListener("close", finish);
      socket.addEventListener("error", () => {
        socket.close(1011, "Realtime socket failed");
        finish();
      });
    } catch (error) {
      console.warn("Organization realtime socket disconnected", error);
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
