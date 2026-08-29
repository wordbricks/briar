import { readFile } from "node:fs/promises";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  managedComputerRemoteHeartbeatIntervalMs,
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
  managedComputerRemoteHeartbeatTimeoutMs,
} from "../src/lib/managed-computer-remote-protocol";
import { ManagedComputerSetupAgent } from "./managed-computer-setup-agent";

const RemoteAgentConfig = Schema.Struct({
  credential: Schema.String.check(
    Schema.isPattern(/^briar_worker_[A-Za-z0-9_-]+$/u),
  ),
  deviceId: Schema.String.check(
    Schema.isPattern(/^managed-[0-9a-f-]{36}$/u),
  ),
  organizationId: Schema.String.check(
    Schema.isPattern(/^[0-9a-f-]{36}$/u),
  ),
  managedComputerId: Schema.String.check(
    Schema.isPattern(/^[0-9a-f-]{36}$/u),
  ),
  apiOrigin: Schema.String.check(Schema.isPattern(/^https:\/\//u)),
});

const RemoteAgentControl = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("controller_ready"),
    sessionId: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u)),
  }),
  Schema.Struct({
    type: Schema.Literal("controller_ended"),
    sessionId: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u)),
  }),
]);

export type ManagedComputerRemoteAgentConfig = typeof RemoteAgentConfig.Type;
type RemoteAgentControl = typeof RemoteAgentControl.Type;

const decodeConfig = Schema.decodeUnknownOption(RemoteAgentConfig);
const decodeControl = Schema.decodeUnknownOption(RemoteAgentControl);

export function parseManagedComputerRemoteAgentConfig(value: unknown) {
  const parsed = decodeConfig(value);
  if (Option.isNone(parsed)) {
    throw new Error("Managed computer remote agent configuration is invalid");
  }
  const expectedDeviceId = `managed-${parsed.value.managedComputerId}`;
  if (parsed.value.deviceId !== expectedDeviceId) {
    throw new Error("Managed computer remote agent device binding is invalid");
  }
  return parsed.value;
}

export function managedComputerRemoteAgentSocketUrl(
  config: ManagedComputerRemoteAgentConfig,
) {
  const url = new URL(
    `/managed-computers/${config.managedComputerId}/remote-agent`,
    config.apiOrigin,
  );
  url.protocol = "wss:";
  return url.toString();
}

export function managedComputerRemoteDisplayEndpoint(environment = process.env) {
  const host = environment.BRIAR_REMOTE_DISPLAY_HOST?.trim() || "127.0.0.1";
  const port = Number(environment.BRIAR_REMOTE_DISPLAY_PORT?.trim() || "5901");
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("Remote display must bind to a loopback address");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Remote display port is invalid");
  }
  return { host, port };
}

function event(name: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event: name, ...detail }));
}

async function binaryMessage(value: unknown): Promise<Uint8Array | null> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return null;
}

export class ManagedComputerRemoteSessionAgent {
  private websocket: WebSocket | null = null;
  private localSocket: Bun.Socket<undefined> | null = null;
  private localConnect: Promise<Bun.Socket<undefined>> | null = null;
  private activeSessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatResponseAt = 0;
  private reconnectDelayMs = 1_000;
  private stopped = false;
  private pendingInput: Uint8Array[] = [];
  private pendingInputBytes = 0;
  private controllerBytes = 0;
  private screenBytes = 0;

  constructor(
    private readonly config: ManagedComputerRemoteAgentConfig,
    private readonly display = managedComputerRemoteDisplayEndpoint(),
  ) {}

  start() {
    if (this.stopped || this.websocket) return;
    this.connectRelay();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.closeDisplay("agent_stopped");
    this.websocket?.close(1000, "Remote session agent stopped");
    this.websocket = null;
  }

  private connectRelay() {
    const socket = new WebSocket(
      managedComputerRemoteAgentSocketUrl(this.config),
      `briar-remote-agent-v1.${this.config.credential}`,
    );
    socket.binaryType = "arraybuffer";
    this.websocket = socket;
    socket.addEventListener("open", () => {
      if (this.websocket !== socket) return;
      this.reconnectDelayMs = 1_000;
      this.startHeartbeat(socket);
      event("remote_relay_connected", {
        managedComputerId: this.config.managedComputerId,
      });
    });
    socket.addEventListener("message", (message) => {
      if (this.websocket === socket) {
        void this.handleRelayMessage(message.data);
      }
    });
    socket.addEventListener("close", (close) => {
      if (this.websocket !== socket) return;
      this.websocket = null;
      this.stopHeartbeat();
      this.closeDisplay("relay_disconnected");
      event("remote_relay_disconnected", { code: close.code });
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      socket.close(1011, "Remote relay connection failed");
    });
  }

  private async handleRelayMessage(value: unknown) {
    if (typeof value === "string") {
      if (value === managedComputerRemoteHeartbeatResponse) {
        this.lastHeartbeatResponseAt = Date.now();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return;
      }
      const control = decodeControl(parsed);
      if (Option.isNone(control)) return;
      await this.handleControl(control.value);
      return;
    }
    const data = await binaryMessage(value);
    if (!data || !this.activeSessionId) return;
    this.controllerBytes += data.byteLength;
    if (this.localSocket) {
      this.localSocket.write(data);
      return;
    }
    if (this.pendingInputBytes + data.byteLength > 8 * 1024 * 1024) {
      this.reportDisplayFailure("input_backpressure");
      return;
    }
    this.pendingInput.push(data.slice());
    this.pendingInputBytes += data.byteLength;
  }

  private async handleControl(control: RemoteAgentControl) {
    if (control.type === "controller_ended") {
      if (this.activeSessionId === control.sessionId) {
        this.closeDisplay("controller_ended");
      }
      return;
    }
    if (this.activeSessionId && this.activeSessionId !== control.sessionId) {
      this.closeDisplay("controller_replaced");
    }
    this.activeSessionId = control.sessionId;
    if (this.localSocket || this.localConnect) return;
    this.localConnect = Bun.connect({
      hostname: this.display.host,
      port: this.display.port,
      socket: {
        open: (socket) => {
          this.localSocket = socket;
          for (const pending of this.pendingInput) socket.write(pending);
          this.pendingInput = [];
          this.pendingInputBytes = 0;
          event("remote_display_connected", {
            managedComputerId: this.config.managedComputerId,
          });
        },
        data: (_socket, data) => {
          const relay = this.websocket;
          if (!relay || relay.readyState !== WebSocket.OPEN) return;
          this.screenBytes += data.byteLength;
          if (relay.bufferedAmount > 8 * 1024 * 1024) {
            this.reportDisplayFailure("screen_backpressure");
            return;
          }
          relay.send(Uint8Array.from(data));
        },
        close: () => {
          this.localSocket = null;
          this.localConnect = null;
          if (this.activeSessionId) this.reportDisplayFailure("display_closed");
        },
        error: (_socket, error) => {
          event("remote_display_error", { error: error.message });
        },
      },
    });
    try {
      await this.localConnect;
    } catch (error) {
      this.localConnect = null;
      event("remote_display_connect_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.reportDisplayFailure("display_connect_failed");
    }
  }

  private reportDisplayFailure(code: string) {
    const relay = this.websocket;
    if (relay?.readyState === WebSocket.OPEN) {
      relay.send(JSON.stringify({ type: "display_error", code }));
    }
    this.closeDisplay(code);
  }

  private closeDisplay(reason: string) {
    const sessionId = this.activeSessionId;
    this.activeSessionId = null;
    const socket = this.localSocket;
    this.localSocket = null;
    this.localConnect = null;
    this.pendingInput = [];
    this.pendingInputBytes = 0;
    socket?.end();
    if (sessionId) {
      event("remote_display_disconnected", {
        reason,
        controllerBytes: this.controllerBytes,
        screenBytes: this.screenBytes,
      });
    }
    this.controllerBytes = 0;
    this.screenBytes = 0;
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connectRelay();
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
          managedComputerRemoteHeartbeatTimeoutMs
      ) {
        this.websocket = null;
        this.stopHeartbeat();
        this.closeDisplay("relay_heartbeat_timeout");
        event("remote_relay_heartbeat_timeout", {
          managedComputerId: this.config.managedComputerId,
        });
        socket.close(4008, "Remote relay heartbeat timed out");
        this.scheduleReconnect();
        return;
      }
      socket.send(managedComputerRemoteHeartbeatRequest);
    }, managedComputerRemoteHeartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.lastHeartbeatResponseAt = 0;
  }
}

async function main() {
  const credentialPath =
    process.env.BRIAR_MANAGED_CREDENTIAL_FILE?.trim() ||
    "/var/lib/briar/worker-credential.json";
  const config = parseManagedComputerRemoteAgentConfig(
    JSON.parse(await readFile(credentialPath, "utf8")) as unknown,
  );
  const remoteAgent = new ManagedComputerRemoteSessionAgent(config);
  const setupAgent = new ManagedComputerSetupAgent(config);
  const stop = () => {
    remoteAgent.stop();
    setupAgent.stop();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  remoteAgent.start();
  setupAgent.start();
}

if (import.meta.main) {
  await main();
}
