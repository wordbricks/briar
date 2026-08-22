import { describe, expect, it } from "vitest";
import { SseEventDecoder } from "./sse-event-decoder";

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
