import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChannelRealtimeTransport,
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
  it("shares one physical socket across channel and project consumers", async () => {
    const sockets: FakeWebSocket[] = [];
    const fetchMock = vi.fn(async () => Response.json({
      url: "wss://api.test/channel-events?ticket=signed",
      expiresAt: "2026-08-12T00:00:00.000Z",
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(_url: string) {
        super();
        sockets.push(this);
      }
    });

    const channel = createChannelRealtimeTransport("token", "organization-1");
    const project = createProjectRealtimeTransport("token", "organization-1");
    channel.start();
    project.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
    channel.stop();
    expect(sockets[0]?.close).not.toHaveBeenCalled();
    project.stop();
    expect(sockets[0]?.close).toHaveBeenCalledWith(
      1000,
      "Realtime transport stopped",
    );
  });
});
