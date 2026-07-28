import { useEffect, useRef } from "react";

import { useI18n } from "../i18n";
import {
  readInboxNotificationPreferences,
  sendInboxNotification,
} from "../lib/inbox-notifications";
import {
  classifyInboxMessage,
  type InboxMessageWithReadState,
} from "./useInbox";

type NotificationBaseline = {
  userId: string;
  versions: Record<string, string>;
};

export function findChangedInboxMessages(
  previousVersions: Record<string, string>,
  messages: InboxMessageWithReadState[],
) {
  return messages.filter(
    (message) => previousVersions[message.id] !== message.version,
  );
}

export function useInboxNotifications(
  userId: string | null,
  messages: InboxMessageWithReadState[],
) {
  const { t } = useI18n();
  const baselineRef = useRef<NotificationBaseline | null>(null);

  useEffect(() => {
    if (!userId) {
      baselineRef.current = null;
      return;
    }

    const versions = Object.fromEntries(
      messages.map((message) => [message.id, message.version]),
    );
    const baseline = baselineRef.current;
    if (!baseline || baseline.userId !== userId) {
      baselineRef.current = { userId, versions };
      return;
    }

    const changedMessages = findChangedInboxMessages(
      baseline.versions,
      messages,
    );
    baselineRef.current = { userId, versions };
    if (changedMessages.length === 0) return;

    const preferences = readInboxNotificationPreferences();
    for (const message of changedMessages) {
      const category = classifyInboxMessage(message);
      if (!preferences[category]) continue;
      void sendInboxNotification(
        message,
        t(`inbox.category.${category}`),
      ).catch((error) => {
        console.error("Failed to send inbox notification", error);
      });
    }
  }, [messages, t, userId]);
}
