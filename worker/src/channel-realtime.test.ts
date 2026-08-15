import { describe, expect, it, vi } from "vitest";
import {
  ChannelRealtimeHub,
  legacyChannelRealtimeResponse,
} from "./channel-realtime";

class FakeSocket {
  sent: string[] = [];
  attachment: { cursors: Record<string, number> } | { cursor: number } | null;
  close = vi.fn();

  constructor(cursor: number) {
    this.attachment = { cursors: { channels: cursor } };
  }

  deserializeAttachment() {
    return this.attachment;
  }

  serializeAttachment(
    attachment: { cursors: Record<string, number> } | { cursor: number },
  ) {
    this.attachment = attachment;
  }

  send(value: string) {
    this.sent.push(value);
  }
}

describe("ChannelRealtimeHub", () => {
  it("fans out only newer cursors through hibernatable sockets", async () => {
    const socket = new FakeSocket(9);
    const hub = new ChannelRealtimeHub(
      {
        getWebSockets: () => [socket],
      } as unknown as DurableObjectState,
      {} as Env,
    );

    const published = await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "channels", cursor: 12 }),
    }));
    expect(published.status).toBe(204);
    expect(socket.sent).toEqual(['{"topic":"channels","cursor":12}']);
    expect(socket.attachment).toEqual({ cursors: { channels: 12 } });

    await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "channels", cursor: 11 }),
    }));
    expect(socket.sent).toHaveLength(1);
  });

  it("tracks channel, project, and session cursors independently", async () => {
    const socket = new FakeSocket(42);
    const hub = new ChannelRealtimeHub(
      {
        getWebSockets: () => [socket],
      } as unknown as DurableObjectState,
      {} as Env,
    );

    await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "project",
        projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        cursor: 3,
      }),
    }));

    expect(socket.sent).toEqual([
      '{"topic":"project","projectId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","cursor":3}',
    ]);
    expect(socket.attachment).toEqual({
      cursors: {
        channels: 42,
        "project:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": 3,
      },
    });

    await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "project-session",
        projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        version: 8,
      }),
    }));
    expect(socket.sent.at(-1)).toBe(
      '{"topic":"project-session","projectId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","version":8}',
    );
    expect(socket.attachment).toEqual({
      cursors: {
        channels: 42,
        "project:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": 3,
        "project-session:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": 8,
      },
    });
  });

  it("tracks the Inbox revision independently from channel cursors", async () => {
    const socket = new FakeSocket(42);
    const hub = new ChannelRealtimeHub(
      {
        getWebSockets: () => [socket],
      } as unknown as DurableObjectState,
      {} as Env,
    );

    await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "inbox", version: 7 }),
    }));

    expect(socket.sent).toEqual(['{"topic":"inbox","version":7}']);
    expect(socket.attachment).toEqual({
      cursors: { channels: 42, inbox: 7 },
    });

    await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "inbox", version: 6 }),
    }));
    expect(socket.sent).toHaveLength(1);
  });

  it("does not create a long-lived stream for legacy subscribers", async () => {
    const response = legacyChannelRealtimeResponse();
    expect(response.status).toBe(426);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.text()).toBe("WebSocket transport required");

    const hub = new ChannelRealtimeHub(
      {} as DurableObjectState,
      {} as Env,
    );
    const upgradeRequired = await hub.fetch(
      new Request("https://realtime.test/subscribe?cursor=9"),
    );
    expect(upgradeRequired.status).toBe(426);
  });

  it("rejects malformed notifications", async () => {
    const hub = new ChannelRealtimeHub(
      {} as DurableObjectState,
      {} as Env,
    );
    const response = await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "channels", cursor: -1 }),
    }));
    expect(response.status).toBe(400);
  });
});
