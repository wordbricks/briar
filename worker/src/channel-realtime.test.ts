import { describe, expect, it } from "vitest";
import { ChannelRealtimeHub } from "./channel-realtime";

const decode = (value: Uint8Array | undefined) =>
  value ? new TextDecoder().decode(value) : "";

describe("ChannelRealtimeHub", () => {
  it("fans out cursor-only notifications to a subscribed organization", async () => {
    const hub = new ChannelRealtimeHub(
      {} as DurableObjectState,
      {} as Env,
    );
    const response = await hub.fetch(
      new Request("https://realtime.test/subscribe?cursor=9"),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();

    expect(decode((await reader.read()).value)).toBe("retry: 3000\n\n");
    expect(decode((await reader.read()).value)).toContain(
      'event: ready\ndata: {"topic":"channels","cursor":9}',
    );

    const published = await hub.fetch(new Request("https://realtime.test/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "channels", cursor: 12 }),
    }));
    expect(published.status).toBe(204);
    expect(decode((await reader.read()).value)).toContain(
      'event: change\ndata: {"topic":"channels","cursor":12}',
    );
    await reader.cancel();
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
