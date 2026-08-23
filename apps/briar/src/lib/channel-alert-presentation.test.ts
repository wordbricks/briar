import { describe, expect, it } from "vitest";
import {
  channelAlertPreview,
  channelAlertToneFromMessage,
  channelAlertToneFromText,
  formattedChannelDump,
  prettyPrintJson,
  shouldCollapseChannelText,
} from "./channel-alert-presentation";
import type { ChannelMessage } from "./channels-contract";

const message = (
  overrides: Partial<ChannelMessage> & Pick<ChannelMessage, "body" | "author">,
): ChannelMessage => ({
  id: "message-1",
  channelId: "channel-1",
  parentMessageId: null,
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  lastReplyAt: null,
  document: null,
  proposal: null,
  executionProposal: null,
  createdAt: "2026-08-01T01:00:00.000Z",
  ...overrides,
});

describe("channel alert presentation", () => {
  it("pretty-prints JSON objects and arrays", () => {
    expect(prettyPrintJson('{"error":"boom","level":"error"}')).toBe(
      '{\n  "error": "boom",\n  "level": "error"\n}',
    );
    expect(prettyPrintJson("not json")).toBeNull();
    expect(formattedChannelDump('{"ok":true}')).toContain("\n");
  });

  it("classifies webhook error dumps and JSON payloads, not casual chat", () => {
    expect(channelAlertToneFromText("this is an error lol", "user")).toBeNull();
    expect(
      channelAlertToneFromText("Production deploy failed", "webhook"),
    ).toBe("error");
    expect(
      channelAlertToneFromText("Latency warning: p99 degraded", "webhook"),
    ).toBe("warning");
    expect(
      channelAlertToneFromText('{"level":"error","message":"timeout"}'),
    ).toBe("error");
    expect(
      channelAlertToneFromText(
        "Error: boom\n    at run (worker.ts:12:5)\n    at main (index.ts:4:1)",
      ),
    ).toBe("error");
  });

  it("classifies webhook messages from headers and blocks", () => {
    const alert = message({
      author: { type: "webhook", id: "hook-1", name: "Sentry" },
      body: "Event",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Unhandled exception" },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "TypeError: cannot read map" },
        },
      ],
    });
    expect(channelAlertToneFromMessage(alert)).toBe("error");

    const healthy = message({
      author: { type: "webhook", id: "hook-2", name: "Deploys" },
      body: "Deployment complete",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Deployment complete" },
        },
      ],
    });
    expect(channelAlertToneFromMessage(healthy)).toBeNull();
  });

  it("collapses long dumps and honors expand", () => {
    expect(shouldCollapseChannelText("short")).toBe(false);
    expect(shouldCollapseChannelText("short", true)).toBe(true);
    const stack = Array.from({ length: 12 }, (_, index) =>
      `    at frame${index} (app.ts:${index}:1)`
    ).join("\n");
    expect(shouldCollapseChannelText(`Error: boom\n${stack}`)).toBe(true);
    const preview = channelAlertPreview(stack);
    expect(preview.collapsed).toBe(true);
    expect(preview.preview.endsWith("…")).toBe(true);
    expect(preview.preview.split("\n").length).toBeLessThanOrEqual(4);
  });
});
