import { describe, expect, it } from "vitest";

import type { InboxMessageWithReadState } from "./useInbox";
import {
  findChangedInboxMessages,
  inboxConversationSyncSignal,
  shouldSuppressInboxNotification,
} from "./useInboxNotifications";

const message = (
  id: string,
  version: string,
): InboxMessageWithReadState => ({
  id,
  kind: "issue",
  isUnread: true,
  occurredAt: "2026-07-29T00:00:00.000Z",
  priority: 1,
  projectId: "project-1",
  projectName: "Briar",
  runNumber: 1,
  status: "failed",
  structuredResult: null,
  targetId: id,
  title: "Notification test",
  version,
  workflowStage: null,
});

describe("inbox notification change detection", () => {
  it("returns only new message ids and changed versions", () => {
    const messages = [
      message("unchanged", "v1"),
      message("changed", "v2"),
      message("new", "v1"),
    ];

    expect(
      findChangedInboxMessages(
        { unchanged: "v1", changed: "v1" },
        messages,
      ).map((candidate) => candidate.id),
    ).toEqual(["changed", "new"]);
  });

  it("tracks a thread by its stable group while its oldest unread row stays selected", () => {
    const firstReply = {
      ...message("conversation:first", "reply-2"),
      notificationGroupId: "conversation-thread:project-1:run-1:root-1",
    };

    expect(
      findChangedInboxMessages(
        {
          "conversation-thread:project-1:run-1:root-1": "reply-1",
        },
        [firstReply],
      ),
    ).toEqual([firstReply]);
    expect(
      findChangedInboxMessages(
        {
          "conversation-thread:project-1:run-1:root-1": "reply-2",
        },
        [{ ...firstReply, id: "conversation:second" }],
      ),
    ).toEqual([]);
  });

  it("suppresses only the channel notification visible in the focused app", () => {
    const channelMessage: InboxMessageWithReadState = {
      id: "channel:message-1",
      kind: "channel",
      isUnread: true,
      occurredAt: "2026-08-14T00:00:00.000Z",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "channel-1",
      channelId: "channel-1",
      channelName: "product",
      messageId: "message-1",
      rootMessageId: "message-1",
      title: "product",
      version: "message-1",
      body: "Please review",
      authorName: "Nikita",
      reason: "mention",
    };

    expect(
      shouldSuppressInboxNotification(
        channelMessage,
        "channel-1",
        null,
        null,
        true,
      ),
    ).toBe(true);
    expect(
      shouldSuppressInboxNotification(
        channelMessage,
        "channel-2",
        null,
        null,
        true,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        channelMessage,
        "channel-1",
        null,
        null,
        false,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        message("issue-1", "v1"),
        "channel-1",
        null,
        null,
        true,
      ),
    ).toBe(false);

    const threadReply: InboxMessageWithReadState = {
      ...channelMessage,
      id: "channel:message-2",
      messageId: "message-2",
      rootMessageId: "thread-root",
      version: "message-2",
    };
    expect(
      shouldSuppressInboxNotification(
        threadReply,
        "channel-1",
        null,
        null,
        true,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        threadReply,
        "channel-1",
        "thread-root",
        null,
        true,
      ),
    ).toBe(true);
  });

  it("suppresses a conversation notification for the issue being viewed", () => {
    const conversationMessage: InboxMessageWithReadState = {
      id: "conversation:message-1",
      kind: "conversation",
      isUnread: true,
      occurredAt: "2026-08-15T00:00:00.000Z",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "run-1",
      messageId: "message-1",
      rootMessageId: "root-1",
      title: "Issue conversation",
      version: "message-1",
      body: "Reply completed",
      authorName: "Briar",
      reason: "thread_reply",
    };

    expect(
      shouldSuppressInboxNotification(
        conversationMessage,
        null,
        null,
        "run-1",
        true,
      ),
    ).toBe(true);
    expect(
      shouldSuppressInboxNotification(
        conversationMessage,
        null,
        null,
        "run-2",
        true,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        conversationMessage,
        null,
        null,
        "run-1",
        false,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        message("run-1", "v1"),
        null,
        null,
        "run-1",
        true,
      ),
    ).toBe(false);
  });

  it("builds the same stable Inbox recovery signal for both conversation kinds", () => {
    const conversationMessage: InboxMessageWithReadState = {
      id: "conversation:message-1",
      kind: "conversation",
      isUnread: true,
      occurredAt: "2026-08-15T00:00:00.000Z",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "run-1",
      messageId: "message-1",
      rootMessageId: "root-1",
      title: "Issue conversation",
      version: "message-1",
      body: "Reply completed",
      authorName: "Briar",
      reason: "thread_reply",
    };
    const channelMessage: InboxMessageWithReadState = {
      ...conversationMessage,
      id: "channel:message-2",
      kind: "channel",
      targetId: "channel-1",
      channelId: "channel-1",
      channelName: "product",
      messageId: "message-2",
      version: "message-2",
      reason: "mention",
    };

    expect(
      inboxConversationSyncSignal(
        [channelMessage, conversationMessage],
        "conversation",
      ),
    ).toBe("conversation:message-1:message-1");
    expect(
      inboxConversationSyncSignal(
        [conversationMessage, channelMessage],
        "channel",
      ),
    ).toBe("channel:message-2:message-2");
  });
});
