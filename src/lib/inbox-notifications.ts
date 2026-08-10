import type { InboxCategory, InboxMessage } from "../hooks/useInbox";
import { isDesktopTauri, isMacDesktopTauri } from "./platform";

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
const desktopOpenAvailableEvent = "inbox-notification-open-available";

export type InboxNotificationTarget = {
  messageId: string;
  projectId: string;
  targetId: string;
  kind: InboxMessage["kind"];
  channelMessageId?: string;
  rootMessageId?: string;
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
    ...(message.kind === "channel"
      ? {
          channelMessageId: message.messageId,
          rootMessageId: message.rootMessageId,
        }
      : {}),
  };
}

/** Issue and conversation targets open the inbox run detail panel. */
export function isInboxRunDetailTarget(
  target: Pick<InboxNotificationTarget, "kind">,
): boolean {
  return target.kind === "issue" || target.kind === "conversation";
}

/**
 * Channel targets navigate to the Channels page (thread context), not the
 * issue/session detail panel. Companion and OS notification clicks already
 * use this path; desktop inbox open must too.
 */
export function isInboxChannelNavigationTarget(
  target: InboxNotificationTarget,
): target is InboxNotificationTarget & {
  kind: "channel";
  channelMessageId: string;
  rootMessageId: string;
} {
  return (
    target.kind === "channel" &&
    typeof target.channelMessageId === "string" &&
    typeof target.rootMessageId === "string"
  );
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
      target.kind === "session" ||
      (target.kind === "channel" &&
        typeof target.channelMessageId === "string" &&
        typeof target.rootMessageId === "string"))
  );
}

type MacInboxNotificationBridge = {
  listenAvailable: (callback: () => void) => Promise<() => void>;
  drain: () => Promise<unknown>;
};

export async function listenForMacInboxNotificationClicks(
  onOpen: (target: InboxNotificationTarget) => void,
  bridge: MacInboxNotificationBridge,
) {
  let stopped = false;
  let drainQueue = Promise.resolve();
  const drain = () => {
    const next = drainQueue.catch(() => undefined).then(async () => {
      const pending = await bridge.drain();
      if (stopped || !Array.isArray(pending)) return;
      for (const target of pending) {
        if (isInboxNotificationTarget(target)) onOpen(target);
      }
    });
    drainQueue = next;
    return next;
  };
  const unlisten = await bridge.listenAvailable(() => {
    void drain().catch((error) => {
      console.error("Pending inbox notification open failed", error);
    });
  });
  await drain();
  return () => {
    stopped = true;
    unlisten();
  };
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
        ...(stored.channelMessageId
          ? { channelMessageId: stored.channelMessageId }
          : {}),
        ...(stored.rootMessageId ? { rootMessageId: stored.rootMessageId } : {}),
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
      if (isMacDesktopTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return listenForMacInboxNotificationClicks(onOpen, {
          listenAvailable: (callback) =>
            listen(desktopOpenAvailableEvent, callback),
          drain: () => invoke("drain_pending_inbox_notification_opens"),
        });
      }
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
    if (isMacDesktopTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<boolean>("request_inbox_notification_permission");
    }
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

export type InboxNotificationContent = {
  title: string;
  body: string;
};

function isReplyMessage(message: InboxMessage) {
  if (message.kind === "conversation") {
    return message.messageId !== message.rootMessageId;
  }
  if (message.kind === "channel") {
    return message.messageId !== message.rootMessageId;
  }
  return false;
}

function replyPreview(body: string) {
  return body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
}

export function inboxNotificationContent(
  message: InboxMessage,
  categoryLabel: string,
): InboxNotificationContent {
  if (
    (message.kind === "conversation" || message.kind === "channel") &&
    isReplyMessage(message)
  ) {
    const destination =
      message.kind === "channel"
        ? `#${message.channelName}`
        : (message.issueKey ?? message.title);
    return {
      title: `${message.authorName.trim() || "Briar"} in ${destination}`,
      body: replyPreview(message.body),
    };
  }

  return {
    title: `Briar · ${categoryLabel}`,
    body: message.projectName
      ? `${message.projectName} · ${message.title}`
      : message.title,
  };
}

export async function sendInboxNotification(
  message: InboxMessage,
  categoryLabel: string,
) {
  const { title, body } = inboxNotificationContent(message, categoryLabel);
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
