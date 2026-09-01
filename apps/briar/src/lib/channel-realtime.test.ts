import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChannelRealtimeTransport,
  createInboxRealtimeTransport,
  createProjectRealtimeTransport,
} from "./channel-realtime";

class FakeWebSocket {
  close = vi.fn();
  addEventListener = vi.fn();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("organization realtime transport", () => {
  it("shares one physical socket across channel, project, and Inbox consumers", async () => {
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(_url: string) {
        super();
        sockets.push(this);
      }
    });
    const createTicket = vi.fn(async () =>
      "wss://api.test/channel-events?ticket=signed"
    );

    const channel = createChannelRealtimeTransport(
      "token",
      "organization-1",
      createTicket,
    );
    const project = createProjectRealtimeTransport(
      "token",
      "organization-1",
      createTicket,
    );
    const inbox = createInboxRealtimeTransport(
      "token",
      "organization-1",
      createTicket,
    );
    channel.start();
    project.start();
    inbox.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createTicket).toHaveBeenCalledOnce();
    expect(createTicket).toHaveBeenCalledWith(
      "token",
      "organization-1",
      expect.any(AbortSignal),
    );
    expect(sockets).toHaveLength(1);
    channel.stop();
    expect(sockets[0]?.close).not.toHaveBeenCalled();
    project.stop();
    expect(sockets[0]?.close).not.toHaveBeenCalled();
    inbox.stop();
    expect(sockets[0]?.close).toHaveBeenCalledWith(
      1000,
      "Realtime transport stopped",
    );
  });
});
