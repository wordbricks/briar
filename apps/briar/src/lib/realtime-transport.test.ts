import {
  OrganizationNotificationSchema,
  ProjectChangedSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  WebSocketRealtimeTransport,
  type RealtimeNotification,
} from "./realtime-transport";

class FakeWebSocket {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  binaryType = "blob";
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

describe("WebSocketRealtimeTransport", () => {
  it("exchanges the bearer token and emits a protobuf oneof frame", async () => {
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
    const frame = create(OrganizationNotificationSchema, {
      notification: {
        case: "projectChanged",
        value: create(ProjectChangedSchema, {
          projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          cursor: 34n,
        }),
      },
    });
    const encoded = toBinary(OrganizationNotificationSchema, frame);
    socket.emit("message", {
      data: encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      ),
    } as MessageEvent);

    await expect(notification).resolves.toEqual({
      topic: "project",
      projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      cursor: 34,
    });
    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("authorization"))
      .toBe("Bearer secret-token");
    expect(socket.binaryType).toBe("arraybuffer");
    transport.stop();
    expect(socket.closeCode).toBe(1000);
  });
});
