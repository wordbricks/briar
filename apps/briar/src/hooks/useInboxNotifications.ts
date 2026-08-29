import { useEffect, useRef } from "react";

import { useI18n } from "../i18n";
import {
  inboxNotificationLabelKey,
  listenForInboxNotificationClicks,
  readInboxNotificationPreferences,
  sendInboxNotification,
  type InboxNotificationTarget,
} from "../lib/inbox-notifications";
import { inboxSessionMessageVersion } from "../lib/inbox-session-version";
import {
  classifyInboxMessage,
  inboxNotificationIdentity,
  type InboxMessageWithReadState,
} from "./useInbox";

type NotificationBaseline = {
  userId: string;
  organizationId: string;
  baselineId: string;
  versions: Record<string, string>;
};

export function findChangedInboxMessages(
  previousVersions: Record<string, string>,
  messages: InboxMessageWithReadState[],
) {
  return messages.filter(
    (message) =>
      previousVersions[inboxNotificationIdentity(message)] !==
      inboxNotificationVersion(message),
  );
}

export function inboxNotificationVersion(message: InboxMessageWithReadState) {
  return message.kind === "session"
    ? inboxSessionMessageVersion(message.status, message.occurredAt)
    : message.version;
}

export function inboxConversationSyncSignal(
  messages: InboxMessageWithReadState[],
  kind: "channel" | "conversation",
) {
  return messages
    .filter((message) => message.kind === kind)
    .map((message) => `${message.id}:${message.version}`)
    .sort()
    .join("\n");
}

export function shouldSuppressInboxNotification(
  message: InboxMessageWithReadState,
  viewingChannelId: string | null,
  viewingChannelThreadRootMessageId: string | null,
  viewingIssueConversationRunId: string | null,
  appIsFocused: boolean,
) {
  if (!appIsFocused) return false;
  if (message.kind === "channel") {
    if (message.channelId !== viewingChannelId) return false;
    // Root messages are visible in the open channel. Thread replies are only
    // visible when that exact thread is open, so another thread in the same
    // channel must not suppress its notification.
    return message.rootMessageId === message.messageId ||
      message.rootMessageId === viewingChannelThreadRootMessageId;
  }
  return message.kind === "conversation" &&
    message.targetId === viewingIssueConversationRunId;
}

const appIsFocused = () =>
  typeof document !== "undefined" &&
  document.visibilityState === "visible" &&
  document.hasFocus();

export function useInboxNotifications(
  userId: string | null,
  organizationId: string | null,
  messages: InboxMessageWithReadState[],
  baselineId = "local",
  viewingChannelId: string | null = null,
  viewingChannelThreadRootMessageId: string | null = null,
  viewingIssueConversationRunId: string | null = null,
  initialSyncComplete = true,
) {
  const { t } = useI18n();
  const baselineRef = useRef<NotificationBaseline | null>(null);

  useEffect(() => {
    if (!userId || !organizationId || !initialSyncComplete) {
      baselineRef.current = null;
      return;
    }

    const versions = Object.fromEntries(
      messages.map((message) => [
        inboxNotificationIdentity(message),
        inboxNotificationVersion(message),
      ]),
    );
    const baseline = baselineRef.current;
    if (
      !baseline ||
      baseline.userId !== userId ||
      baseline.organizationId !== organizationId ||
      baseline.baselineId !== baselineId
    ) {
      baselineRef.current = { userId, organizationId, baselineId, versions };
      return;
    }

    const changedMessages = findChangedInboxMessages(
      baseline.versions,
      messages,
    );
    baselineRef.current = { userId, organizationId, baselineId, versions };
    if (changedMessages.length === 0) return;

    const preferences = readInboxNotificationPreferences();
    for (const message of changedMessages) {
      if (
        shouldSuppressInboxNotification(
          message,
          viewingChannelId,
          viewingChannelThreadRootMessageId,
          viewingIssueConversationRunId,
          appIsFocused(),
        )
      ) continue;
      const category = classifyInboxMessage(message);
      if (!preferences[category]) continue;
      void sendInboxNotification(
        message,
        t(inboxNotificationLabelKey(message, category)),
      ).catch((error) => {
        console.error("Failed to send inbox notification", error);
      });
    }
  }, [
    baselineId,
    initialSyncComplete,
    messages,
    organizationId,
    t,
    userId,
    viewingChannelId,
    viewingChannelThreadRootMessageId,
    viewingIssueConversationRunId,
  ]);
}

export function useInboxNotificationClicks(
  onOpen: (target: InboxNotificationTarget) => void,
) {
  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void | Promise<void>) | null = null;

    void listenForInboxNotificationClicks(onOpen)
      .then((stop) => {
        if (disposed) void stop();
        else stopListening = stop;
      })
      .catch((error) => {
        console.error("Failed to listen for inbox notification clicks", error);
      });

    return () => {
      disposed = true;
      void stopListening?.();
    };
  }, [onOpen]);
}
