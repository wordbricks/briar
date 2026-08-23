/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxMessage } from "../hooks/useInbox";
import {
  inboxNotificationContent,
  inboxNotificationLabelKey,
  inboxNotificationTarget,
  isInboxChannelTarget,
  isInboxRunDetailTarget,
  listenForMacInboxNotificationClicks,
  listenForInboxNotificationClicks,
  readInboxNotificationPreferences,
  sendInboxNotification,
  targetFromNotificationAction,
  writeInboxNotificationPreferences,
} from "./inbox-notifications";

const message: InboxMessage = {
  id: "issue:run-1",
  kind: "issue",
  projectId: "project-1",
  projectName: "Briar",
  targetId: "run-1",
  title: "Notification test",
  occurredAt: "2026-07-31T00:00:00.000Z",
  version: "event-1",
  runNumber: 1,
  status: "completed",
  workflowStage: null,
  priority: 2,
  structuredResult: null,
};

describe("inbox notification preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists each importance category independently", () => {
    writeInboxNotificationPreferences({
      urgent: true,
      action_required: false,
      important: true,
      activity: false,
    });

    expect(readInboxNotificationPreferences()).toEqual({
      urgent: true,
      action_required: false,
      important: true,
      activity: false,
    });
  });

  it("ignores malformed and non-boolean stored values", () => {
    window.localStorage.setItem(
      "briar.settings.inbox-notifications.v1",
      JSON.stringify({ urgent: "yes", activity: true }),
    );

    expect(readInboxNotificationPreferences()).toEqual({
      urgent: false,
      action_required: false,
      important: false,
      activity: true,
    });
  });
});

describe("inbox notification navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads an Android notification target from the action payload", () => {
    const target = inboxNotificationTarget(message);

    expect(
      targetFromNotificationAction({
        actionId: "tap",
        notification: {
          extra: { briarInboxTarget: JSON.stringify(target) },
        },
      }),
    ).toEqual(target);
  });

  it("preserves channel message and thread context in notification targets", () => {
    const channelMessage: InboxMessage = {
      id: "channel:message-1",
      kind: "channel",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "channel-1",
      channelId: "channel-1",
      channelName: "product",
      messageId: "message-1",
      rootMessageId: "root-1",
      title: "product",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "message-1",
      body: "A reply",
      authorName: "Sam",
      reason: "thread_reply",
    };

    expect(inboxNotificationTarget(channelMessage)).toEqual({
      messageId: "channel:message-1",
      projectId: "project-1",
      targetId: "channel-1",
      kind: "channel",
      channelMessageId: "message-1",
      rootMessageId: "root-1",
    });
  });

  it("identifies channel targets separately from run detail targets", () => {
    const channelTarget = inboxNotificationTarget({
      id: "channel:message-1",
      kind: "channel",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "channel-1",
      channelId: "channel-1",
      channelName: "product",
      messageId: "message-1",
      rootMessageId: "root-1",
      title: "product",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "message-1",
      body: "A reply",
      authorName: "Sam",
      reason: "thread_reply",
    });
    const issueTarget = inboxNotificationTarget(message);
    const conversationTarget = inboxNotificationTarget({
      id: "conversation:message-2",
      kind: "conversation",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "run-1",
      messageId: "message-2",
      rootMessageId: "root-2",
      title: "Issue title",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "message-2",
      body: "A mention",
      authorName: "Sam",
      reason: "mention",
    });
    const sessionTarget = {
      messageId: "session:session-1",
      projectId: "project-1",
      targetId: "session-1",
      kind: "session" as const,
    };

    expect(isInboxChannelTarget(channelTarget)).toBe(true);
    expect(isInboxRunDetailTarget(channelTarget)).toBe(false);
    expect(isInboxChannelTarget(issueTarget)).toBe(false);
    expect(isInboxRunDetailTarget(issueTarget)).toBe(true);
    expect(isInboxChannelTarget(conversationTarget)).toBe(false);
    expect(isInboxRunDetailTarget(conversationTarget)).toBe(true);
    expect(isInboxChannelTarget(sessionTarget)).toBe(false);
    expect(isInboxRunDetailTarget(sessionTarget)).toBe(false);
  });

  it("falls back to the stored target for iOS action payloads", () => {
    const target = inboxNotificationTarget(message);
    window.localStorage.setItem(
      "briar.inbox.notification-targets.v1",
      JSON.stringify({ 42: { ...target, storedAt: Date.now() } }),
    );

    expect(
      targetFromNotificationAction({
        actionId: "tap",
        notification: { id: 42 },
      }),
    ).toEqual(target);
    expect(
      targetFromNotificationAction({
        actionId: "dismiss",
        notification: { id: 42 },
      }),
    ).toBeNull();
  });

  it("opens the matching target when a browser notification is clicked", async () => {
    const notifications: MockNotification[] = [];
    class MockNotification {
      static permission = "granted";
      onclick: (() => void) | null = null;
      close = vi.fn();

      constructor() {
        notifications.push(this);
      }
    }
    vi.stubGlobal("Notification", MockNotification);
    vi.spyOn(window, "focus").mockImplementation(() => {});
    const onOpen = vi.fn();
    const stopListening = await listenForInboxNotificationClicks(onOpen);

    expect(await sendInboxNotification(message, "Important")).toBe(true);
    const [notification] = notifications;
    notification.onclick?.();

    expect(onOpen).toHaveBeenCalledWith(inboxNotificationTarget(message));
    expect(notification.close).toHaveBeenCalledOnce();
    stopListening();
  });

  it("drains macOS notification clicks registered before the webview starts", async () => {
    const target = inboxNotificationTarget(message);
    let notifyAvailable: (() => void) | undefined;
    const onOpen = vi.fn();
    const drain = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([target, { malformed: true }])
      .mockResolvedValueOnce([{ ...target, targetId: "run-2" }]);
    const unlisten = vi.fn();
    const stopListening = await listenForMacInboxNotificationClicks(onOpen, {
      listenAvailable: async (callback) => {
        notifyAvailable = callback;
        return unlisten;
      },
      drain,
    });

    expect(onOpen).toHaveBeenCalledWith(target);
    notifyAvailable?.();
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2));
    expect(onOpen).toHaveBeenLastCalledWith({ ...target, targetId: "run-2" });

    stopListening();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

describe("inbox notification content", () => {
  it.each([
    ["paused", "action_required", "status.paused", "Awaiting review"],
    ["completed", "important", "status.completed", "Completed"],
    ["failed", "action_required", "status.failed", "Failed"],
    ["blocked", "urgent", "status.blocked", "Blocked"],
  ] as const)(
    "uses the %s issue status instead of its %s importance category",
    (status, category, labelKey, label) => {
      const issue = { ...message, status };

      expect(inboxNotificationLabelKey(issue, category)).toBe(labelKey);
      expect(inboxNotificationContent(issue, label)).toEqual({
        title: `Briar · ${label}`,
        body: "Briar · Notification test",
      });
    },
  );

  it("shows the agent, completed status, and at most three final-message lines", () => {
    const session: InboxMessage = {
      id: "session:session-1",
      kind: "session",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "session-1",
      title: "Process queued issues",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "event-1",
      status: "completed",
      agentName: "Release Agent",
      issueCount: 2,
      error: null,
      summary: " First line \n\nSecond line\r\n Third line \nFourth line",
      requiresAttention: false,
    };

    expect(inboxNotificationLabelKey(session, "activity")).toBe(
      "status.completed",
    );
    expect(inboxNotificationContent(session, "Completed")).toEqual({
      title: "Release Agent · Completed",
      body: "First line\nSecond line\nThird line",
    });
  });

  it("shows an issue reply author, issue key, and at most three non-empty lines", () => {
    const reply: InboxMessage = {
      id: "conversation:reply-1",
      kind: "conversation",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "run-1",
      messageId: "reply-1",
      rootMessageId: "root-1",
      title: "Fix checkout",
      issueKey: "WB-1321",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "reply-1",
      body: " First line \n\nSecond line\r\n Third line \nFourth line",
      authorName: "Codex",
      // A reply containing a mention is still a reply according to its
      // message hierarchy, regardless of the notification reason.
      reason: "mention",
    };

    expect(inboxNotificationContent(reply, "Needs review")).toEqual({
      title: "Codex in WB-1321",
      body: "First line\nSecond line\nThird line",
    });
  });

  it("shows a channel reply author and channel name", () => {
    const reply: InboxMessage = {
      id: "channel:reply-1",
      kind: "channel",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "channel-1",
      channelId: "channel-1",
      channelName: "general",
      messageId: "reply-1",
      rootMessageId: "root-1",
      title: "general",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "reply-1",
      body: "Channel reply",
      authorName: "Codex",
      reason: "thread_reply",
    };

    expect(inboxNotificationContent(reply, "Needs review")).toEqual({
      title: "Codex in #general",
      body: "Channel reply",
    });
  });

  it("shows the author and message for a subscribed issue conversation", () => {
    const subscribedMessage: InboxMessage = {
      id: "conversation:message-1",
      kind: "conversation",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "run-1",
      messageId: "message-1",
      rootMessageId: "message-1",
      title: "Fix checkout",
      issueKey: "WB-1321",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "message-1",
      body: "The rollout is ready.",
      authorName: "Sam",
      reason: "subscription",
    };

    expect(inboxNotificationContent(subscribedMessage, "Recent activity"))
      .toEqual({
        title: "Sam in WB-1321",
        body: "The rollout is ready.",
      });
  });

  it("keeps the importance wording for a top-level mention", () => {
    const mention: InboxMessage = {
      id: "conversation:mention-1",
      kind: "conversation",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "run-1",
      messageId: "mention-1",
      rootMessageId: "mention-1",
      title: "Fix checkout",
      issueKey: "WB-1321",
      occurredAt: "2026-08-08T00:00:00.000Z",
      version: "mention-1",
      body: "@Codex please review",
      authorName: "Sam",
      reason: "thread_reply",
    };

    expect(inboxNotificationContent(mention, "Needs review")).toEqual({
      title: "Briar · Needs review",
      body: "Briar · Fix checkout",
    });
  });
});
