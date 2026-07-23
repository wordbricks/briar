import { describe, expect, it } from "vitest";
import {
  mergeAutoHuntAppServerEvents,
  type AutoHuntAppServerEvent,
} from "./auto-hunt-agent";

const event = (
  sequence: number,
  method: string,
): AutoHuntAppServerEvent => ({
  sessionId: "session-1",
  sequence,
  occurredAtMs: sequence,
  direction: sequence % 2 === 0 ? "server" : "client",
  message: { method },
});

describe("mergeAutoHuntAppServerEvents", () => {
  it("deduplicates persisted and live events and keeps wire order", () => {
    const merged = mergeAutoHuntAppServerEvents(
      [event(2, "thread/started"), event(1, "initialize")],
      [event(2, "thread/started"), event(3, "turn/started")],
    );

    expect(merged.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(merged.map((item) => item.message.method)).toEqual([
      "initialize",
      "thread/started",
      "turn/started",
    ]);
  });
});
