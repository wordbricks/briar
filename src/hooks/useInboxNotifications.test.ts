import { describe, expect, it } from "vitest";

import type { InboxMessageWithReadState } from "./useInbox";
import {
  findChangedInboxMessages,
  inboxConversationSyncSignal,
  inboxNotificationVersion,
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

  it("ignores legacy and canonical versions of the same terminal session", () => {
    const terminalSession: InboxMessageWithReadState = {
      id: "session:session-1",
      kind: "session",
      isUnread: true,
      occurredAt: "2026-08-01T12:22:38.913Z",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "session-1",
      title: "Completed task",
      version: "legacy-terminal-event-id",
      status: "failed",
      agentName: "Inbox Agent",
      issueCount: 1,
      error: "Runner stopped",
      summary: null,
      requiresAttention: true,
    };
    const baselineVersion = inboxNotificationVersion(terminalSession);

    expect(
      findChangedInboxMessages(
        { [terminalSession.id]: baselineVersion },
        [{
          ...terminalSession,
          version: "failed:2026-08-01T12:22:38.913Z",
        }],
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
        true,
      ),
    ).toBe(true);
    expect(
      shouldSuppressInboxNotification(
        channelMessage,
        "channel-2",
        null,
        true,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        channelMessage,
        "channel-1",
        null,
        false,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        message("issue-1", "v1"),
        "channel-1",
        null,
        true,
      ),
    ).toBe(false);
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
        "run-1",
        true,
      ),
    ).toBe(true);
    expect(
      shouldSuppressInboxNotification(
        conversationMessage,
        null,
        "run-2",
        true,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        conversationMessage,
        null,
        "run-1",
        false,
      ),
    ).toBe(false);
    expect(
      shouldSuppressInboxNotification(
        message("run-1", "v1"),
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
