/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeAgentReplyActivityFrameBinary,
  type AgentReplyActivityFrame,
} from "./channel-agent-activity";
import { ChannelActivityRealtimeTransport } from "./channel-activity-realtime";
import { IssueActivityRealtimeTransport } from "./issue-activity-realtime";

class FakeWebSocket {
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();
  binaryType = "blob";
  close = vi.fn();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener as (event: Event) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event = new Event(type)) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

type TestTransport = {
  subscribe: (listener: (frame: unknown) => void) => () => boolean;
  start: () => void;
  stop: () => void;
};

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const channelId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

const frameBase = {
  replyJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  attempt: 1,
  sequence: 1,
  triggerMessageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  parentMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  activity: {
    id: "commentary-1",
    kind: "message",
    headline: "원인을 확인하고 있습니다.",
  },
  sentAt: "2026-08-16T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
} as const;

const emitFrame = (socket: FakeWebSocket, frame: AgentReplyActivityFrame) => {
  const bytes = encodeAgentReplyActivityFrameBinary(frame);
  socket.emit("message", new MessageEvent("message", {
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }));
};

const scenarios = [
  {
    name: "channel",
    ticketPath:
      `/organizations/${organizationId}/channels/${channelId}/agent-activity-events`,
    frame: {
      ...frameBase,
      agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      channelId,
    },
    crossScope: {
      ...frameBase,
      agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      channelId: projectId,
    },
    create(fetchImpl: typeof fetch, createWebSocket: (url: string) => WebSocket) {
      return new ChannelActivityRealtimeTransport({
        token: "token",
        organizationId,
        channelId,
        fetch: fetchImpl,
        createWebSocket,
      }) as unknown as TestTransport;
    },
    stopReason: "Channel activity stopped",
    invalidUrlMessage: "Channel activity ticket returned an invalid URL",
  },
  {
    name: "issue",
    ticketPath: `/projects/${projectId}/runs/${runId}/agent-activity-events`,
    frame: { ...frameBase, projectId, runId },
    crossScope: { ...frameBase, projectId, runId: channelId },
    create(fetchImpl: typeof fetch, createWebSocket: (url: string) => WebSocket) {
      return new IssueActivityRealtimeTransport({
        token: "token",
        projectId,
        runId,
        fetch: fetchImpl,
        createWebSocket,
      }) as unknown as TestTransport;
    },
    stopReason: "Issue activity stopped",
    invalidUrlMessage: "Issue activity ticket returned an invalid URL",
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(scenarios)("$name activity realtime", (scenario) => {
  it("requests its scoped ticket and rejects malformed or cross-scope frames", async () => {
    const socket = new FakeWebSocket();
    const fetchMock = vi.fn(async () => Response.json({
      url: "wss://api.test/agent-activity-events?ticket=signed",
    }));
    const createWebSocket = vi.fn(() => socket as unknown as WebSocket);
    const transport = scenario.create(
      fetchMock as unknown as typeof fetch,
      createWebSocket,
    );
    const listener = vi.fn();
    transport.subscribe(listener);
    transport.start();
    await vi.waitFor(() => expect(createWebSocket).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(scenario.ticketPath),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer token",
        },
      },
    );
    socket.emit("message", new MessageEvent("message", { data: "not-binary" }));
    socket.emit("message", new MessageEvent("message", {
      data: new ArrayBuffer(1),
    }));
    emitFrame(socket, scenario.crossScope);
    emitFrame(socket, scenario.frame);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(scenario.frame);
    expect(socket.binaryType).toBe("arraybuffer");
    transport.stop();
    expect(socket.close).toHaveBeenCalledWith(1000, scenario.stopReason);
  });

  it("reconnects after close and stop cancels the pending reconnect", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const sockets = [new FakeWebSocket(), new FakeWebSocket()];
    const fetchMock = vi.fn(async () => Response.json({
      url: "wss://api.test/agent-activity-events?ticket=signed",
    }));
    const createWebSocket = vi.fn(
      () =>
        sockets[createWebSocket.mock.calls.length - 1] as unknown as WebSocket,
    );
    const transport = scenario.create(
      fetchMock as unknown as typeof fetch,
      createWebSocket,
    );

    transport.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(createWebSocket).toHaveBeenCalledOnce();
    sockets[0]!.emit("close");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(createWebSocket).toHaveBeenCalledTimes(2);

    sockets[1]!.emit("close");
    transport.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not open a socket when stopped while the ticket is pending", async () => {
    let resolveTicket!: (response: Response) => void;
    const ticket = new Promise<Response>((resolve) => {
      resolveTicket = resolve;
    });
    const fetchMock = vi.fn(() => ticket);
    const createWebSocket = vi.fn(
      () => new FakeWebSocket() as unknown as WebSocket,
    );
    const transport = scenario.create(
      fetchMock as unknown as typeof fetch,
      createWebSocket,
    );

    transport.start();
    transport.stop();
    resolveTicket(Response.json({ url: "wss://api.test/activity" }));
    await ticket;
    await Promise.resolve();

    expect(createWebSocket).not.toHaveBeenCalled();
  });

  it("rejects a ticket URL outside the WebSocket protocols", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => Response.json({
      url: "https://api.test/not-a-websocket",
    }));
    const createWebSocket = vi.fn(
      () => new FakeWebSocket() as unknown as WebSocket,
    );
    const transport = scenario.create(
      fetchMock as unknown as typeof fetch,
      createWebSocket,
    );

    transport.start();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      message: scenario.invalidUrlMessage,
    });
    expect(createWebSocket).not.toHaveBeenCalled();
    transport.stop();
  });
});
