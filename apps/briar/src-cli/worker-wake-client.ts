import {
  decodeWorkerWakeFrame,
  workerWakeHeartbeatIntervalMs,
  workerWakeHeartbeatRequest,
  workerWakeHeartbeatResponse,
  workerWakeHeartbeatTimeoutMs,
  workerWakeMaxReconnectDelayMs,
  workerWakeReconnectDelayMs,
  workerWakeSubprotocol,
  type WorkerWakeReason,
} from "../src/lib/worker-wake-protocol";

export type WorkerWakeListener = (reason: WorkerWakeReason) => void;

/**
 * What `runWorkerLoop` depends on. Kept to a bare subscription so the loop can
 * be driven by a fake in tests without a socket, a server, or real time.
 */
export type WorkerWakeSource = {
  subscribe: (listener: WorkerWakeListener) => () => void;
};

export type WorkerWakeClientConfig = {
  apiUrl: string;
  workspaceId: string;
  credential: string;
};

export function workerWakeSocketUrl(config: WorkerWakeClientConfig) {
  const url = new URL(
    `/workspaces/${config.workspaceId}/worker-wake`,
    config.apiUrl,
  );
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.toString();
}

/**
 * Keeps one socket to the workspace's wake hub open and reports every wake
 * frame to the Worker loop.
 *
 * The socket is pure latency optimization: it carries no work, and every
 * failure path is silent by design because the loop's poll still drains the
 * queue when the socket is down.
 */
export class WorkerWakeClient implements WorkerWakeSource {
  private websocket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatResponseAt = 0;
  private reconnectDelayMs = workerWakeReconnectDelayMs;
  private stopped = false;
  private readonly listeners = new Set<WorkerWakeListener>();

  constructor(
    private readonly config: WorkerWakeClientConfig,
    private readonly log: (line: string) => void = () => {},
  ) {}

  subscribe(listener: WorkerWakeListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start() {
    if (this.stopped || this.websocket) return;
    // A credential that cannot ride the subprotocol would fail the handshake
    // on every retry. Stay on polling instead of reconnecting forever.
    if (!/^briar_worker_[A-Za-z0-9_-]+$/u.test(this.config.credential)) {
      this.stopped = true;
      this.log("worker wake socket disabled: credential is not transportable");
      return;
    }
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.websocket?.close(1000, "Worker wake client stopped");
    this.websocket = null;
    this.listeners.clear();
  }

  private connect() {
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        workerWakeSocketUrl(this.config),
        workerWakeSubprotocol(this.config.credential),
      );
    } catch (error) {
      this.log(
        `worker wake socket could not be opened: ${describe(error)}`,
      );
      this.scheduleReconnect();
      return;
    }
    this.websocket = socket;
    socket.addEventListener("open", () => {
      if (this.websocket !== socket) return;
      this.reconnectDelayMs = workerWakeReconnectDelayMs;
      this.startHeartbeat(socket);
      this.log("worker wake socket connected");
    });
    socket.addEventListener("message", (message) => {
      if (this.websocket === socket) this.handleMessage(message.data);
    });
    socket.addEventListener("close", (close) => {
      if (this.websocket !== socket) return;
      this.websocket = null;
      this.stopHeartbeat();
      this.log(`worker wake socket disconnected (${close.code})`);
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      socket.close(1011, "Worker wake connection failed");
    });
  }

  private handleMessage(value: unknown) {
    if (typeof value !== "string") return;
    if (value === workerWakeHeartbeatResponse) {
      this.lastHeartbeatResponseAt = Date.now();
      return;
    }
    let frame;
    try {
      frame = decodeWorkerWakeFrame(value);
    } catch {
      return;
    }
    if (frame.type !== "wake") return;
    for (const listener of [...this.listeners]) {
      try {
        listener(frame.reason);
      } catch (error) {
        this.log(`worker wake listener failed: ${describe(error)}`);
      }
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      workerWakeMaxReconnectDelayMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(socket: WebSocket) {
    this.stopHeartbeat();
    this.lastHeartbeatResponseAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.websocket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (
        Date.now() - this.lastHeartbeatResponseAt >=
          workerWakeHeartbeatTimeoutMs
      ) {
        this.websocket = null;
        this.stopHeartbeat();
        this.log("worker wake socket heartbeat timed out");
        socket.close(4008, "Worker wake heartbeat timed out");
        this.scheduleReconnect();
        return;
      }
      socket.send(workerWakeHeartbeatRequest);
    }, workerWakeHeartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.lastHeartbeatResponseAt = 0;
  }
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
