import { afterEach, describe, expect, it, vi } from "vitest";
import {
  managedComputerRemoteHeartbeatIntervalMs,
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
  managedComputerRemoteHeartbeatTimeoutMs,
} from "../src/lib/managed-computer-remote-protocol";
import {
  ManagedComputerRemoteSessionAgent,
  managedComputerRemoteAgentSocketUrl,
  managedComputerRemoteDisplayEndpoint,
  parseManagedComputerRemoteAgentConfig,
} from "./managed-computer-remote-session-agent";

const managedComputerId = "11111111-1111-4111-8111-111111111111";

const config = {
  credential: "briar_worker_example",
  deviceId: `managed-${managedComputerId}`,
  organizationId: "22222222-2222-4222-8222-222222222222",
  managedComputerId,
  apiOrigin: "https://briar.example",
};

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly sent: unknown[] = [];
  readonly close = vi.fn();
  readyState = 0;
  binaryType = "blob";
  bufferedAmount = 0;
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    fakeWebSockets.push(this);
  }

  addEventListener(name: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  send(value: unknown) {
    this.sent.push(value);
  }

  emit(name: string, event: any = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

const fakeWebSockets: FakeWebSocket[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fakeWebSockets.length = 0;
});

describe("managed computer remote session agent", () => {
  it("binds a managed worker credential to the same computer and secure origin", () => {
    const parsed = parseManagedComputerRemoteAgentConfig(config);
    expect(managedComputerRemoteAgentSocketUrl(parsed)).toBe(
      `wss://briar.example/managed-computers/${managedComputerId}/remote-agent`,
    );
  });

  it("refuses a non-loopback display target", () => {
    expect(() => managedComputerRemoteDisplayEndpoint({
      BRIAR_REMOTE_DISPLAY_HOST: "0.0.0.0",
      BRIAR_REMOTE_DISPLAY_PORT: "5901",
    })).toThrow("loopback");
  });

  it("heartbeats the relay and accepts its automatic response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new ManagedComputerRemoteSessionAgent(config);

    agent.start();
    const socket = fakeWebSockets[0];
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");

    await vi.advanceTimersByTimeAsync(
      managedComputerRemoteHeartbeatIntervalMs,
    );
    expect(socket.sent).toEqual([managedComputerRemoteHeartbeatRequest]);
    socket.emit("message", { data: managedComputerRemoteHeartbeatResponse });

    await vi.advanceTimersByTimeAsync(
      managedComputerRemoteHeartbeatTimeoutMs -
        managedComputerRemoteHeartbeatIntervalMs,
    );
    expect(socket.close).not.toHaveBeenCalled();
    agent.stop();
  });

  it("replaces a half-open relay connection after the heartbeat times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const agent = new ManagedComputerRemoteSessionAgent(config);

    agent.start();
    const socket = fakeWebSockets[0];
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");

    await vi.advanceTimersByTimeAsync(
      managedComputerRemoteHeartbeatTimeoutMs,
    );
    expect(socket.close).toHaveBeenCalledWith(
      4008,
      "Remote relay heartbeat timed out",
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakeWebSockets).toHaveLength(2);
    agent.stop();
  });
});
