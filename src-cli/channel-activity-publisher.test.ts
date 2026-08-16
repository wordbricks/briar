import { describe, expect, it, vi } from "vitest";
import {
  ChannelActivityPublisher,
  safeChannelActivityHeadline,
} from "./channel-activity-publisher";
import type { ChannelAgentActivityPublishInput } from "../src/lib/channel-agent-activity";

const credential = {
  token: "activity-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

describe("ChannelActivityPublisher", () => {
  it("publishes commentary and restores it after a tool completes", async () => {
    const send = vi.fn(async (
      _credential: typeof credential,
      _input: ChannelAgentActivityPublishInput,
    ) => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });

    publisher.observePayload({
      event: {
        type: "messageCompleted",
        id: "commentary-1",
        phase: "commentary",
        text: "저장소 구조를 확인하고 있습니다.",
      },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      activity: {
        id: "commentary-1",
        kind: "message",
        headline: "저장소 구조를 확인하고 있습니다.",
      },
    });

    publisher.observePayload({
      event: {
        type: "activityStarted",
        id: "command-1",
        kind: "command",
        title: "Running tests",
        text: "",
      },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    publisher.observePayload({
      event: {
        type: "activityCompleted",
        id: "command-1",
        kind: "command",
        title: "Running tests",
        text: "",
        status: "completed",
      },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2]?.[1]).toMatchObject({
      activity: { id: "commentary-1", kind: "message" },
    });
    publisher.stop();
  });

  it("publishes only normalized semantic activity without blocking observation", async () => {
    const send = vi.fn(async () => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });

    publisher.observePayload({
      type: "event",
      event: {
        type: "activityStarted",
        id: "command-1",
        kind: "command",
        title: "Running tests",
        text: "private output",
      },
    });
    publisher.observePayload({
      type: "event",
      event: { type: "activityDelta", id: "command-1", delta: "secret stdout" },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(credential, {
      sequence: 1,
      activity: {
        id: "command-1",
        kind: "command",
        headline: "Running tests",
      },
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("private output");
    expect(JSON.stringify(send.mock.calls)).not.toContain("secret stdout");
    publisher.stop();
  });

  it("redacts common credentials from provider titles", () => {
    expect(
      safeChannelActivityHeadline(
        "command",
        "TOKEN=super-secret ghp_abcdefghijklmnopqrstuvwxyz123456",
      ),
    ).toBe("TOKEN=[redacted] [redacted]");
  });

  it("ignores malformed activity payloads without throwing", () => {
    const send = vi.fn(async () => undefined);
    const publisher = new ChannelActivityPublisher({ credential, send });
    expect(() => publisher.observePayload({
      event: { type: "activityStarted", id: "bad", kind: "tool" },
    })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
    publisher.stop();
  });

  it("keeps only the newest state while a publish is in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const send = vi.fn((
      _credential: typeof credential,
      _input: ChannelAgentActivityPublishInput,
    ) =>
      new Promise<void>((resolve) => {
        resolveFirst ??= resolve;
      })
    );
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });
    publisher.observePayload({
      event: {
        type: "activityStarted",
        id: "one",
        kind: "tool",
        title: "First tool",
        text: "",
      },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    publisher.observePayload({
      event: {
        type: "activityStarted",
        id: "two",
        kind: "webSearch",
        title: "Latest search",
        text: "",
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      activity: { id: "two", headline: "Latest search" },
    });
    publisher.stop();
  });
});
