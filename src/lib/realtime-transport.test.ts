import { describe, expect, it } from "vitest";
import {
  SseEventDecoder,
  SseRealtimeTransport,
} from "./realtime-transport";

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
    const notification = new Promise<{ topic: "channels"; cursor: number }>(
      (resolve) => transport.subscribe(resolve),
    );

    transport.start();
    await expect(notification).resolves.toEqual({ topic: "channels", cursor: 21 });
    expect(new Headers(request?.headers).get("authorization"))
      .toBe("Bearer secret-token");
    transport.stop();
  });
});
