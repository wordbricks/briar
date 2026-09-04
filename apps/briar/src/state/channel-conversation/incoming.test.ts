/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  testChannelAgentReply,
  testChannelMessage,
} from "../../test/channel-conversation";
import { createTestRegistry } from "../registry";
import {
  channelAgentRepliesAtom,
  channelRootMessagesAtom,
} from "./atoms";
import {
  applyIncomingChannelAgentReplies,
  applyIncomingChannelMessages,
} from "./incoming";
import { writeChannelAgentReplies, writeChannelTimeline } from "./write";

const channelId = "channel-1";

describe("incoming channel conversation pages", () => {
  it("merges a page and drops what it says was removed", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [
      testChannelMessage("older", { createdAt: "2026-08-01T00:00:00.000Z" }),
      testChannelMessage("current"),
    ]);

    applyIncomingChannelMessages(
      registry,
      channelId,
      [testChannelMessage("new", { createdAt: "2026-08-01T02:00:00.000Z" })],
      ["current"],
      false,
      false,
    );

    expect(
      registry
        .get(channelRootMessagesAtom(channelId))
        .map((message) => message.id),
    ).toEqual(["older", "new"]);
  });

  it("ignores a page addressed to another channel", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [testChannelMessage("current")]);

    applyIncomingChannelMessages(
      registry,
      channelId,
      [testChannelMessage("elsewhere", { channelId: "channel-2" })],
      [],
      false,
      false,
    );

    expect(
      registry
        .get(channelRootMessagesAtom(channelId))
        .map((message) => message.id),
    ).toEqual(["current"]);
  });

  it("reports the reply that just became failed, and only once", () => {
    const registry = createTestRegistry();
    writeChannelAgentReplies(registry, channelId, [
      testChannelAgentReply("reply-a", { status: "running" }),
    ]);
    const failed = testChannelAgentReply("reply-a", {
      status: "failed",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });

    expect(
      applyIncomingChannelAgentReplies(registry, channelId, [failed], false)?.id,
    ).toBe("reply-a");
    expect(
      applyIncomingChannelAgentReplies(registry, channelId, [failed], false),
    ).toBeNull();
    expect(
      registry.get(channelAgentRepliesAtom(channelId)).map((r) => r.status),
    ).toEqual(["failed"]);
  });
});
