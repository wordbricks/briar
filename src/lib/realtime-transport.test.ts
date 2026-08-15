import { describe, expect, it } from "vitest";
import {
  SseEventDecoder,
  SseRealtimeTransport,
  WebSocketRealtimeTransport,
  type RealtimeNotification,
} from "./realtime-transport";

class FakeWebSocket {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  closeCode: number | undefined;

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close(code?: number) {
    this.closeCode = code;
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("SseEventDecoder", () => {
  it("decodes fragmented named events and multiline data", () => {
    const decoder = new SseEventDecoder();
    expect(decoder.push("event: cha")).toEqual([]);
    expect(decoder.push("nge\r\ndata: {\"topic\":\"channels\",\r\n")).toEqual([]);
    expect(decoder.push("data: \"cursor\":12}\r\n\r\n")).toEqual([
      {
        event: "change",
        data: '{"topic":"channels",\n"cursor":12}',
      },
    ]);
  });

  it("ignores retry and comment frames", () => {
    const decoder = new SseEventDecoder();
    expect(decoder.push("retry: 3000\n\n: keepalive\n\n")).toEqual([]);
  });
});

describe("SseRealtimeTransport", () => {
  it("authenticates the fetch stream and emits cursor notifications", async () => {
    let request: RequestInit | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: ready\ndata: {"topic":"channels","cursor":21}\n\n',
        ));
      },
    });
    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return new Response(stream, { status: 200 });
    };
    const transport = new SseRealtimeTransport({
      url: "https://api.test/channel-events",
      token: "secret-token",
      fetch: fetchMock,
    });
    const notification = new Promise<RealtimeNotification>(
      (resolve) => transport.subscribe(resolve),
    );

    transport.start();
    await expect(notification).resolves.toEqual({ topic: "channels", cursor: 21 });
    expect(new Headers(request?.headers).get("authorization"))
      .toBe("Bearer secret-token");
    transport.stop();
  });
});

describe("WebSocketRealtimeTransport", () => {
  it("exchanges the bearer token for a short-lived socket URL", async () => {
    let request: RequestInit | undefined;
    const socket = new FakeWebSocket();
    const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return Response.json({
        url: "wss://api.test/channel-events?ticket=signed",
        expiresAt: "2026-08-12T00:00:00.000Z",
      });
    };
    const transport = new WebSocketRealtimeTransport({
      url: "https://api.test/channel-events",
      token: "secret-token",
      fetch: fetchMock,
      createWebSocket: () => socket as unknown as WebSocket,
    });
    const notification = new Promise<RealtimeNotification>(
      (resolve) => transport.subscribe(resolve),
    );

    transport.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.emit("open", new Event("open"));
    socket.emit(
      "message",
      { data: '{"topic":"channels","cursor":34}' } as MessageEvent,
    );

    await expect(notification).resolves.toEqual({ topic: "channels", cursor: 34 });
    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("authorization"))
      .toBe("Bearer secret-token");
    transport.stop();
    expect(socket.closeCode).toBe(1000);
  });

  it("emits project cursor notifications over the shared socket", async () => {
    const socket = new FakeWebSocket();
    const transport = new WebSocketRealtimeTransport({
      url: "https://api.test/channel-events",
      token: "secret-token",
      fetch: async () => Response.json({
        url: "wss://api.test/channel-events?ticket=signed",
        expiresAt: "2026-08-12T00:00:00.000Z",
      }),
      createWebSocket: () => socket as unknown as WebSocket,
    });
    const notification = new Promise((resolve) => transport.subscribe(resolve));

    transport.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.emit("open", new Event("open"));
    socket.emit("message", {
      data: JSON.stringify({
        topic: "project",
        projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        cursor: 9,
      }),
    } as MessageEvent);

    await expect(notification).resolves.toEqual({
      topic: "project",
      projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      cursor: 9,
    });
    transport.stop();
  });

  it("emits ready and project session revision notifications", async () => {
    const socket = new FakeWebSocket();
    const transport = new WebSocketRealtimeTransport({
      url: "https://api.test/channel-events",
      token: "secret-token",
      fetch: async () => Response.json({
        url: "wss://api.test/channel-events?ticket=signed",
        expiresAt: "2026-08-12T00:00:00.000Z",
      }),
      createWebSocket: () => socket as unknown as WebSocket,
    });
    const notifications: RealtimeNotification[] = [];
    transport.subscribe((notification) => notifications.push(notification));

    transport.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.emit("open", new Event("open"));
    socket.emit("message", { data: '{"topic":"ready"}' } as MessageEvent);
    socket.emit("message", {
      data: JSON.stringify({
        topic: "project-session",
        projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        version: 11,
      }),
    } as MessageEvent);

    expect(notifications).toEqual([
      { topic: "ready" },
      {
        topic: "project-session",
        projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        version: 11,
      },
    ]);
    transport.stop();
  });

  it("emits Inbox version notifications over the shared socket", async () => {
    const socket = new FakeWebSocket();
    const transport = new WebSocketRealtimeTransport({
      url: "https://api.test/channel-events",
      token: "secret-token",
      fetch: async () => Response.json({
        url: "wss://api.test/channel-events?ticket=signed",
        expiresAt: "2026-08-12T00:00:00.000Z",
      }),
      createWebSocket: () => socket as unknown as WebSocket,
    });
    const notification = new Promise((resolve) => transport.subscribe(resolve));

    transport.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.emit("open", new Event("open"));
    socket.emit("message", {
      data: JSON.stringify({ topic: "inbox", version: 17 }),
    } as MessageEvent);

    await expect(notification).resolves.toEqual({
      topic: "inbox",
      version: 17,
    });
    transport.stop();
  });
});
