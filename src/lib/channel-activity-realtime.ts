import * as Option from "effect/Option";
import {
  decodeChannelAgentActivityFrameOption,
  type ChannelAgentActivityFrame,
} from "./channel-agent-activity";
import { briarApiUrl } from "./api-config";

type Listener = (frame: ChannelAgentActivityFrame) => void;

export class ChannelActivityRealtimeTransport {
  private readonly listeners = new Set<Listener>();
  private active = false;
  private generation = 0;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1_000;

  constructor(
    private readonly input: {
      token: string;
      organizationId: string;
      channelId: string;
      fetch?: typeof fetch;
      createWebSocket?: (url: string) => WebSocket;
    },
  ) {}

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.reconnectDelayMs = 1_000;
    void this.connect(++this.generation);
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
    socket?.close(1000, "Channel activity stopped");
  }

  private async connect(generation: number) {
    try {
      const fetchImpl = this.input.fetch ?? fetch;
      const path = `/organizations/${this.input.organizationId}/channels/` +
        `${this.input.channelId}/agent-activity-events`;
      const response = await fetchImpl(`${briarApiUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.input.token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Channel activity ticket failed (${response.status})`);
      }
      const body = await response.json() as { url?: unknown };
      if (typeof body.url !== "string" || !/^wss?:\/\//u.test(body.url)) {
        throw new Error("Channel activity ticket returned an invalid URL");
      }
      if (!this.active || generation !== this.generation) return;
      const createSocket = this.input.createWebSocket ??
        ((url: string) => new WebSocket(url));
      const socket = createSocket(body.url);
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
        this.reconnectDelayMs = 1_000;
      });
      socket.addEventListener("message", (event) => {
        if (!this.active || generation !== this.generation) return;
        let value: unknown;
        try {
          value = JSON.parse(typeof event.data === "string" ? event.data : "");
        } catch {
          return;
        }
        const parsed = Option.getOrNull(
          decodeChannelAgentActivityFrameOption(value),
        );
        if (parsed === null || parsed.channelId !== this.input.channelId) {
          return;
        }
        for (const listener of this.listeners) listener(parsed);
      });
      socket.addEventListener("close", finish);
      socket.addEventListener("error", () => {
        socket.close(1011, "Channel activity socket failed");
        finish();
      });
    } catch (error) {
      console.warn("Channel activity socket disconnected", error);
      if (this.active && generation === this.generation) {
        this.scheduleReconnect(generation);
      }
    }
  }

  private scheduleReconnect(generation: number) {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(
      this.reconnectDelayMs * (0.75 + Math.random() * 0.5),
      30_000,
    );
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active && generation === this.generation) {
        void this.connect(generation);
      }
    }, delay);
  }
}
