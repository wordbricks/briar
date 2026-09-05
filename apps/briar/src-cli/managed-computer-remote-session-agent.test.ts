import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeManagedComputerRemoteAgentControlFrame,
  encodeManagedComputerRemoteRelayControlFrame,
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
  vi.restoreAllMocks();
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

  it("opens and closes the display only for strict relay controls", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const localSocket = {
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as Bun.Socket<undefined>;
    const connect = vi.fn(async (
      options: Bun.TCPSocketConnectOptions<undefined>,
    ) => {
      options.socket.open?.(localSocket);
      return localSocket;
    });
    vi.stubGlobal("Bun", { connect });
    const agent = new ManagedComputerRemoteSessionAgent(config);

    agent.start();
    const socket = fakeWebSockets[0];
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");

    socket.emit("message", {
      data: JSON.stringify({
        type: "controller_ready",
        sessionId: managedComputerId,
        injected: true,
      }),
    });
    await vi.waitFor(() => expect(connect).not.toHaveBeenCalled());

    socket.emit("message", {
      data: encodeManagedComputerRemoteRelayControlFrame({
        type: "controller_ready",
        sessionId: managedComputerId,
      }),
    });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());

    socket.emit("message", {
      data: encodeManagedComputerRemoteRelayControlFrame({
        type: "controller_ended",
        sessionId: managedComputerId,
      }),
    });
    await vi.waitFor(() => expect(localSocket.end).toHaveBeenCalledOnce());
    agent.stop();
  });

  it("resolves an Agent assignment before opening its fork display", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const localSocket = {
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as Bun.Socket<undefined>;
    const connect = vi.fn(async (
      options: Bun.TCPSocketConnectOptions<undefined>,
    ) => {
      options.socket.open?.(localSocket);
      return localSocket;
    });
    vi.stubGlobal("Bun", { connect });
    const agentId = "33333333-3333-4333-8333-333333333333";
    const resolve = vi.fn().mockResolvedValue({
      host: "127.0.0.1",
      port: 5_907,
    });
    const agent = new ManagedComputerRemoteSessionAgent(config, { resolve });

    agent.start();
    const socket = fakeWebSockets[0];
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");
    socket.emit("message", {
      data: encodeManagedComputerRemoteRelayControlFrame({
        type: "controller_ready",
        sessionId: managedComputerId,
        agentId,
      }),
    });

    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    expect(resolve).toHaveBeenCalledWith(agentId);
    expect(connect.mock.calls[0]?.[0]).toMatchObject({
      hostname: "127.0.0.1",
      port: 5_907,
    });
    agent.stop();
  });

  it("reports a display connection failure for the active session", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const connect = vi.fn(async () => {
      throw new Error("display offline");
    });
    vi.stubGlobal("Bun", { connect });
    const agent = new ManagedComputerRemoteSessionAgent(config);

    agent.start();
    const socket = fakeWebSockets[0];
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");
    socket.emit("message", {
      data: encodeManagedComputerRemoteRelayControlFrame({
        type: "controller_ready",
        sessionId: managedComputerId,
      }),
    });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(decodeManagedComputerRemoteAgentControlFrame(socket.sent[0])).toEqual({
      type: "display_error",
      sessionId: managedComputerId,
      code: "display_connect_failed",
    });
    agent.stop();
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

describe("managedComputerRemoteDisplayResolver", () => {
  it("routes an assigned agent to its display and everyone else to the primary desktop", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { managedComputerRemoteDisplayResolver } = await import(
      "./managed-computer-remote-session-agent"
    );
    const directory = await mkdtemp(join(tmpdir(), "briar-display-resolver-"));
    try {
      const assignments = join(directory, "window-assignments.json");
      await writeFile(assignments, JSON.stringify({
        version: 1,
        assignments: [{
          agentId: "agent-with-display",
          displayIndex: 3,
          ownerToken: "owner-token",
          updatedAt: "2026-09-05T00:00:00.000Z",
        }],
      }), { mode: 0o600 });
      const resolver = managedComputerRemoteDisplayResolver({
        BRIAR_COMPUTER_USE_ASSIGNMENTS_FILE: assignments,
        BRIAR_REMOTE_DISPLAY_HOST: "127.0.0.1",
        BRIAR_REMOTE_DISPLAY_PORT: "5901",
      });
      expect(await resolver.resolve("agent-with-display")).toEqual({ host: "127.0.0.1", port: 5903 });
      // An agent that is not using the computer shows the owner desktop.
      expect(await resolver.resolve("idle-agent")).toEqual({ host: "127.0.0.1", port: 5901 });
      expect(await resolver.resolve(undefined)).toEqual({ host: "127.0.0.1", port: 5901 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
