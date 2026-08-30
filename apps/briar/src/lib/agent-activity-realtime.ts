import { isWebSocketUrl } from "./realtime-transport";

type Listener<Frame> = (frame: Frame) => void;

export type AgentActivityRealtimeAdapter<Frame> = {
  label: "Channel" | "Issue";
  decodeFrame: (value: Uint8Array) => Frame | null;
  matchesScope: (frame: Frame) => boolean;
};

export type AgentActivityRealtimeInput<Frame> = {
  adapter: AgentActivityRealtimeAdapter<Frame>;
  createTicket: (signal: AbortSignal) => Promise<string>;
  createWebSocket?: (url: string) => WebSocket;
};

export class AgentActivityRealtimeTransport<Frame> {
  private readonly listeners = new Set<Listener<Frame>>();
  private active = false;
  private generation = 0;
  private socket: WebSocket | null = null;
  private ticketRequest: AbortController | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1_000;

  constructor(private readonly input: AgentActivityRealtimeInput<Frame>) {}

  subscribe(listener: Listener<Frame>) {
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
    this.ticketRequest?.abort();
    this.ticketRequest = null;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, `${this.input.adapter.label} activity stopped`);
  }

  private async connect(generation: number) {
    const { adapter } = this.input;
    const ticketRequest = new AbortController();
    this.ticketRequest = ticketRequest;
    try {
      const ticketUrl = await this.input.createTicket(ticketRequest.signal);
      if (!isWebSocketUrl(ticketUrl)) {
        throw new Error(
          `${adapter.label} activity ticket returned an invalid URL`,
        );
      }
      if (!this.active || generation !== this.generation) return;
      const createSocket = this.input.createWebSocket ??
        ((url: string) => new WebSocket(url));
      const socket = createSocket(ticketUrl);
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
        this.reconnectDelayMs = 1_000;
      });
      socket.addEventListener("message", (event) => {
        if (!this.active || generation !== this.generation) return;
        if (!(event.data instanceof ArrayBuffer)) return;
        const parsed = adapter.decodeFrame(new Uint8Array(event.data));
        if (parsed === null || !adapter.matchesScope(parsed)) return;
        for (const listener of this.listeners) listener(parsed);
      });
      socket.addEventListener("close", finish);
      socket.addEventListener("error", () => {
        socket.close(1011, `${adapter.label} activity socket failed`);
        finish();
      });
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      console.warn(`${adapter.label} activity socket disconnected`, error);
      this.scheduleReconnect(generation);
    } finally {
      if (this.ticketRequest === ticketRequest) this.ticketRequest = null;
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
