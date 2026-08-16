/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { IssueActivityRealtimeTransport } from "./issue-activity-realtime";

class FakeWebSocket {
  private readonly listeners = new Map<string, Array<(event: Event) => void>>();
  close = vi.fn();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener as (event: Event) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("IssueActivityRealtimeTransport", () => {
  it("delivers only frames for the requested project run", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    const socket = new FakeWebSocket();
    const fetchMock = vi.fn(async () => Response.json({
      url: "wss://api.test/agent-activity-events?ticket=signed",
    }));
    const createWebSocket = vi.fn(() => socket as unknown as WebSocket);
    const transport = new IssueActivityRealtimeTransport({
      token: "token",
      projectId,
      runId,
      fetch: fetchMock as unknown as typeof fetch,
      createWebSocket,
    });
    const listener = vi.fn();
    transport.subscribe(listener);
    transport.start();
    await vi.waitFor(() => expect(createWebSocket).toHaveBeenCalledOnce());

    const frame = {
      version: 1,
      replyJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      attempt: 1,
      sequence: 1,
      projectId,
      runId,
      triggerMessageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      parentMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      activity: {
        id: "commentary-1",
        kind: "message",
        headline: "원인을 확인하고 있습니다.",
      },
      sentAt: "2026-08-16T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify(frame),
    }));
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({ ...frame, runId: frame.triggerMessageId }),
    }));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(frame);
    transport.stop();
  });
});
