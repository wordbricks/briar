import type { InboxCategory, InboxMessage } from "../hooks/useInbox";
import { isDesktopTauri } from "./platform";

export const inboxNotificationCategories = [
  "urgent",
  "action_required",
  "important",
  "activity",
] as const satisfies readonly InboxCategory[];

export type InboxNotificationPreferences = Record<InboxCategory, boolean>;

const storageKey = "briar.settings.inbox-notifications.v1";
const targetStorageKey = "briar.inbox.notification-targets.v1";
const browserOpenEvent = "briar:inbox-notification-open";
const desktopOpenEvent = "inbox-notification-open";

export type InboxNotificationTarget = {
  messageId: string;
  projectId: string;
  targetId: string;
  kind: InboxMessage["kind"];
};

type StoredInboxNotificationTarget = InboxNotificationTarget & {
  storedAt: number;
};

type NotificationActionPayload = {
  actionId?: unknown;
  notification?: {
    id?: unknown;
    extra?: unknown;
  };
};

export const defaultInboxNotificationPreferences =
  (): InboxNotificationPreferences => ({
    urgent: false,
    action_required: false,
    important: false,
    activity: false,
  });

export function readInboxNotificationPreferences(): InboxNotificationPreferences {
  const defaults = defaultInboxNotificationPreferences();
  if (typeof window === "undefined") return defaults;

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as Partial<Record<InboxCategory, unknown>>;
    return Object.fromEntries(
      inboxNotificationCategories.map((category) => [
        category,
        stored[category] === true,
      ]),
    ) as InboxNotificationPreferences;
  } catch {
    return defaults;
  }
}

export function writeInboxNotificationPreferences(
  preferences: InboxNotificationPreferences,
) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // Keep the preference in the mounted settings screen when storage is unavailable.
  }
}

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export function inboxNotificationTarget(
  message: InboxMessage,
): InboxNotificationTarget {
  return {
    messageId: message.id,
    projectId: message.projectId,
    targetId: message.targetId,
    kind: message.kind,
  };
}

function isInboxNotificationTarget(
  value: unknown,
): value is InboxNotificationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Partial<InboxNotificationTarget>;
  return (
    typeof target.messageId === "string" &&
    typeof target.projectId === "string" &&
    typeof target.targetId === "string" &&
    (target.kind === "issue" ||
      target.kind === "conversation" ||
      target.kind === "session")
  );
}

function inboxNotificationId(messageId: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < messageId.length; index += 1) {
    hash ^= messageId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) & 0x7fff_ffff || 1;
}

function readStoredTargets(): Record<string, StoredInboxNotificationTarget> {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(
      window.localStorage.getItem(targetStorageKey) ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, StoredInboxNotificationTarget] =>
          isInboxNotificationTarget(entry[1]) &&
          typeof (entry[1] as StoredInboxNotificationTarget).storedAt === "number",
      ),
    );
  } catch {
    return {};
  }
}

function storeNotificationTarget(
  notificationId: number,
  target: InboxNotificationTarget,
) {
  try {
    const targets = readStoredTargets();
    targets[String(notificationId)] = { ...target, storedAt: Date.now() };
    const recentTargets = Object.fromEntries(
      Object.entries(targets)
        .sort(([, left], [, right]) => right.storedAt - left.storedAt)
        .slice(0, 100),
    );
    window.localStorage.setItem(targetStorageKey, JSON.stringify(recentTargets));
  } catch {
    // Android carries the target in `extra`; storage is only the iOS fallback.
  }
}

function targetFromExtra(extra: unknown) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return null;
  const serialized = (extra as Record<string, unknown>).briarInboxTarget;
  if (typeof serialized !== "string") return null;
  try {
    const target: unknown = JSON.parse(serialized);
    return isInboxNotificationTarget(target) ? target : null;
  } catch {
    return null;
  }
}

export function targetFromNotificationAction(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const action = payload as NotificationActionPayload;
  if (action.actionId !== "tap" && action.actionId !== "default") return null;

  const extraTarget = targetFromExtra(action.notification?.extra);
  if (extraTarget) return extraTarget;

  const notificationId = action.notification?.id;
  if (typeof notificationId !== "number" && typeof notificationId !== "string") {
    return null;
  }
  const stored = readStoredTargets()[String(notificationId)];
  return stored && isInboxNotificationTarget(stored)
    ? {
        messageId: stored.messageId,
        projectId: stored.projectId,
        targetId: stored.targetId,
        kind: stored.kind,
      }
    : null;
}

function dispatchBrowserNotificationOpen(target: InboxNotificationTarget) {
  window.dispatchEvent(
    new CustomEvent<InboxNotificationTarget>(browserOpenEvent, {
      detail: target,
    }),
  );
}

export async function listenForInboxNotificationClicks(
  onOpen: (target: InboxNotificationTarget) => void,
) {
  if (isTauriRuntime()) {
    if (isDesktopTauri()) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<InboxNotificationTarget>(desktopOpenEvent, ({ payload }) => {
        if (isInboxNotificationTarget(payload)) onOpen(payload);
      });
    }

    const { onAction } = await import("@tauri-apps/plugin-notification");
    const listener = await onAction((payload) => {
      const target = targetFromNotificationAction(payload);
      if (target) onOpen(target);
    });
    return () => listener.unregister();
  }

  const handleOpen = (event: Event) => {
    const target = (event as CustomEvent<unknown>).detail;
    if (isInboxNotificationTarget(target)) onOpen(target);
  };
  window.addEventListener(browserOpenEvent, handleOpen);
  return () => window.removeEventListener(browserOpenEvent, handleOpen);
}

export async function requestInboxNotificationPermission() {
  if (isTauriRuntime()) {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  }

  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function sendInboxNotification(
  message: InboxMessage,
  categoryLabel: string,
) {
  const title = `Briar · ${categoryLabel}`;
  const body = message.projectName
    ? `${message.projectName} · ${message.title}`
    : message.title;
  const target = inboxNotificationTarget(message);

  if (isTauriRuntime()) {
    if (isDesktopTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("show_inbox_notification", { title, body, target });
      return true;
    }

    const { isPermissionGranted, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (!(await isPermissionGranted())) return false;
    const id = inboxNotificationId(message.id);
    storeNotificationTarget(id, target);
    sendNotification({
      id,
      title,
      body,
      group: "briar-inbox",
      autoCancel: true,
      extra: {
        briarInboxTarget: JSON.stringify(target),
      },
    });
    return true;
  }

  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  const notification = new Notification(title, { body, tag: message.id });
  notification.onclick = () => {
    window.focus();
    dispatchBrowserNotificationOpen(target);
    notification.close();
  };
  return true;
}
