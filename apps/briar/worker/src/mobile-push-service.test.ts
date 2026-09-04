import { fromBinary } from "@bufbuild/protobuf";
import {
  MobilePushNotificationTargetSchema,
} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import { describe, expect, it } from "vitest";
import type { InboxFeedMessage } from "./inbox-feed";
import {
  mobilePushTargetProviderData,
  mobilePushTargetProtoBase64,
  normalizedMobilePushCollapseId,
} from "./mobile-push-provider";
import {
  classifyMobilePushInboxMessage,
  mobilePushNotificationContent,
  mobilePushNotificationGroupId,
  newestByMobilePushNotificationGroup,
} from "./mobile-push-service";

const baseMessage = {
  id: "issue:11111111-1111-4111-8111-111111111111",
  kind: "issue",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectName: "Mobile",
  targetId: "11111111-1111-4111-8111-111111111111",
  title: "Background notifications",
  occurredAt: "2026-08-30T12:00:00.000Z",
  version: "1:1:completed:merged:2026-08-30T12:00:00.000Z:3",
} satisfies InboxFeedMessage;

describe("mobile push Inbox adapter", () => {
  it("uses the same thread identities as the native and web clients", () => {
    expect(mobilePushNotificationGroupId({
      ...baseMessage,
      id: "conversation:33333333-3333-4333-8333-333333333333",
      kind: "conversation",
      messageId: "33333333-3333-4333-8333-333333333333",
      rootMessageId: "44444444-4444-4444-8444-444444444444",
    })).toBe(
      "conversation-thread:22222222-2222-4222-8222-222222222222:" +
        "11111111-1111-4111-8111-111111111111:" +
        "44444444-4444-4444-8444-444444444444",
    );

    expect(mobilePushNotificationGroupId({
      ...baseMessage,
      id: "channel:55555555-5555-4555-8555-555555555555",
      kind: "channel",
      targetId: "66666666-6666-4666-8666-666666666666",
      messageId: "55555555-5555-4555-8555-555555555555",
      rootMessageId: "77777777-7777-4777-8777-777777777777",
    })).toBe(
      "channel-thread:66666666-6666-4666-8666-666666666666:" +
        "77777777-7777-4777-8777-777777777777",
    );
  });

  it("preserves the shared notification category policy", () => {
    expect(classifyMobilePushInboxMessage({
      ...baseMessage,
      status: "blocked",
      priority: 1,
    })).toBe("urgent");
    expect(classifyMobilePushInboxMessage({
      ...baseMessage,
      status: "failed",
      priority: 4,
    })).toBe("action_required");
    expect(classifyMobilePushInboxMessage({
      ...baseMessage,
      status: "completed",
      priority: 2,
    })).toBe("important");
    expect(classifyMobilePushInboxMessage(baseMessage)).toBe("activity");
  });

  it("carries the structured result into issue alert bodies", () => {
    const content = mobilePushNotificationContent({
      ...baseMessage,
      status: "paused",
      structuredResult: {
        summary: "First summary line\n\nSecond line\r\nThird line\nFourth line",
        outcome: "partial",
        importance: "important",
        urgency: "normal",
        impact: "issue",
        humanActionRequired: true,
        nextAction: "Approve the paused stage",
        dueAt: null,
      },
    }, "ko");

    expect(content.title).toBe("Briar · 검토 대기");
    expect(content.body).toBe(
      "Mobile · Background notifications\nFirst summary line\nSecond line",
    );
  });

  it("roundtrips the generated destination oneof through provider base64", () => {
    const content = mobilePushNotificationContent({
      ...baseMessage,
      id: "conversation:33333333-3333-4333-8333-333333333333",
      kind: "conversation",
      messageId: "33333333-3333-4333-8333-333333333333",
      rootMessageId: "44444444-4444-4444-8444-444444444444",
      issueKey: "BR-42",
      authorName: "Eve",
      body: "First line\n\nSecond line",
    }, "ko");
    const encoded = mobilePushTargetProtoBase64(content.target);
    const decoded = fromBinary(
      MobilePushNotificationTargetSchema,
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
    );

    expect(decoded).toMatchObject({
      inboxMessageId:
        "conversation:33333333-3333-4333-8333-333333333333",
      inboxMessageVersion: baseMessage.version,
      notificationId: content.collapseId,
      projectId: baseMessage.projectId,
      targetId: baseMessage.targetId,
      destination: {
        case: "conversation",
        value: {
          conversationMessageId: "33333333-3333-4333-8333-333333333333",
        },
      },
    });
    expect(mobilePushTargetProviderData(content.target)).toEqual({
      briarInboxTargetProto: encoded,
    });

    const destinationCases = [
      baseMessage,
      {
        ...baseMessage,
        kind: "conversation" as const,
        messageId: "33333333-3333-4333-8333-333333333333",
      },
      {
        ...baseMessage,
        kind: "channel" as const,
        messageId: "55555555-5555-4555-8555-555555555555",
        rootMessageId: "66666666-6666-4666-8666-666666666666",
      },
      { ...baseMessage, kind: "session" as const },
    ].map((message) =>
      mobilePushNotificationContent(message, "en").target.destination.case
    );
    expect(destinationCases).toEqual([
      "issue",
      "conversation",
      "channel",
      "session",
    ]);
  });

  it("prioritizes the newest groups when a flush must cap alerts", () => {
    const groups = newestByMobilePushNotificationGroup([
      { ...baseMessage, id: "issue:older", targetId: "older" },
      {
        ...baseMessage,
        id: "issue:newer",
        targetId: "newer",
        occurredAt: "2026-08-30T12:05:00.000Z",
      },
    ]);

    expect(groups.map((group) => group.id)).toEqual([
      "issue:newer",
      "issue:older",
    ]);
  });

  it("keeps long conversation collapse identities distinct and provider-safe", async () => {
    const first = await normalizedMobilePushCollapseId(
      "conversation-thread:11111111-1111-4111-8111-111111111111:" +
        "22222222-2222-4222-8222-222222222222:" +
        "33333333-3333-4333-8333-333333333333",
    );
    const second = await normalizedMobilePushCollapseId(
      "conversation-thread:11111111-1111-4111-8111-111111111111:" +
        "44444444-4444-4444-8444-444444444444:" +
        "55555555-5555-4555-8555-555555555555",
    );

    expect(new TextEncoder().encode(first).byteLength).toBeLessThanOrEqual(64);
    expect(new TextEncoder().encode(second).byteLength).toBeLessThanOrEqual(64);
    expect(first).not.toBe(second);
  });
});
