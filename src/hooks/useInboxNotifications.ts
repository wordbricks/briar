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
      previousVersions[message.id] !== inboxNotificationVersion(message),
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
  viewingIssueConversationRunId: string | null,
  appIsFocused: boolean,
) {
  if (!appIsFocused) return false;
  if (message.kind === "channel") {
    return message.channelId === viewingChannelId;
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
  viewingIssueConversationRunId: string | null = null,
) {
  const { t } = useI18n();
  const baselineRef = useRef<NotificationBaseline | null>(null);

  useEffect(() => {
    if (!userId || !organizationId) {
      baselineRef.current = null;
      return;
    }

    const versions = Object.fromEntries(
      messages.map((message) => [message.id, inboxNotificationVersion(message)]),
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
    messages,
    organizationId,
    t,
    userId,
    viewingChannelId,
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
