import type { InboxCategory, InboxMessage } from "../hooks/useInbox";

export const inboxNotificationCategories = [
  "urgent",
  "action_required",
  "important",
  "activity",
] as const satisfies readonly InboxCategory[];

export type InboxNotificationPreferences = Record<InboxCategory, boolean>;

const storageKey = "briar.settings.inbox-notifications.v1";

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

  if (isTauriRuntime()) {
    const { isPermissionGranted, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (!(await isPermissionGranted())) return false;
    sendNotification({
      title,
      body,
      group: "briar-inbox",
    });
    return true;
  }

  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  new Notification(title, { body, tag: message.id });
  return true;
}
