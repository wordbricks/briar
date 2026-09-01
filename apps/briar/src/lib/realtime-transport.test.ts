/** @vitest-environment jsdom */

import {
  OrganizationNotificationSchema,
  ProjectChangedSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
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
  it("opens the issued URL and emits a protobuf oneof frame", async () => {
    const socket = new FakeWebSocket();
    const createTicket = vi.fn(async () =>
      "wss://api.test/channel-events?ticket=signed"
    );
    const transport = new WebSocketRealtimeTransport({
      createTicket,
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
    expect(createTicket).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(socket.binaryType).toBe("arraybuffer");
    transport.stop();
    expect(socket.closeCode).toBe(1000);
  });

  it("rejects a non-WebSocket URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const createWebSocket = vi.fn(
      () => new FakeWebSocket() as unknown as WebSocket,
    );
    const transport = new WebSocketRealtimeTransport({
      createTicket: async () => "https://api.test/not-a-websocket",
      createWebSocket,
    });

    transport.start();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());

    expect(createWebSocket).not.toHaveBeenCalled();
    transport.stop();
    warn.mockRestore();
  });

  it("aborts a pending ticket request when stopped", async () => {
    let signal: AbortSignal | undefined;
    const createTicket = vi.fn((value: AbortSignal) => {
      signal = value;
      return new Promise<string>(() => undefined);
    });
    const createWebSocket = vi.fn(
      () => new FakeWebSocket() as unknown as WebSocket,
    );
    const transport = new WebSocketRealtimeTransport({
      createTicket,
      createWebSocket,
    });

    transport.start();
    await vi.waitFor(() => expect(createTicket).toHaveBeenCalledOnce());
    transport.stop();

    expect(signal?.aborted).toBe(true);
    expect(createWebSocket).not.toHaveBeenCalled();
  });
});
