import { useEffect, useRef } from "react";

import { useI18n } from "../i18n";
import {
  inboxNotificationLabelKey,
  listenForInboxNotificationClicks,
  readInboxNotificationPreferences,
  sendInboxNotification,
  synchronizeAndroidPushRegistration,
  androidPushRegistrationEvents,
} from "../lib/inbox-notifications";
import type { InboxNotificationTarget } from "../generated/tauri";
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
      message.version,
  );
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
  sessionToken: string | null = null,
) {
  const { t } = useI18n();
  const baselineRef = useRef<NotificationBaseline | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    const synchronize = () => {
      void synchronizeAndroidPushRegistration(sessionToken).catch((error) => {
        console.error("Failed to synchronize Android push registration", error);
      });
    };
    const synchronizeWhenVisible = () => {
      if (document.visibilityState === "visible") synchronize();
    };
    synchronize();
    window.addEventListener(
      androidPushRegistrationEvents.preferencesChanged,
      synchronize,
    );
    window.addEventListener(
      androidPushRegistrationEvents.tokenChanged,
      synchronize,
    );
    window.addEventListener("online", synchronize);
    document.addEventListener("visibilitychange", synchronizeWhenVisible);
    return () => {
      window.removeEventListener(
        androidPushRegistrationEvents.preferencesChanged,
        synchronize,
      );
      window.removeEventListener(
        androidPushRegistrationEvents.tokenChanged,
        synchronize,
      );
      window.removeEventListener("online", synchronize);
      document.removeEventListener("visibilitychange", synchronizeWhenVisible);
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!userId || !organizationId || !initialSyncComplete) {
      baselineRef.current = null;
      return;
    }

    const versions = Object.fromEntries(
      messages.map((message) => [
        inboxNotificationIdentity(message),
        message.version,
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
