import {
  inboxNotificationIdentity,
  type InboxCategory,
  type InboxMessage,
} from "../state/inbox/model";
import {
  MobilePushNotificationTargetSchema,
  type MobilePushNotificationTarget,
} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import { fromBinary } from "@bufbuild/protobuf";
import * as Schema from "effect/Schema";
import {
  getMobilePlatform,
  isDesktopTauri,
  isMacDesktopTauri,
} from "./platform";
import {
  commands,
  events,
  type InboxNotificationPermissionStatus,
  type InboxNotificationTarget,
} from "../generated/tauri";
import {
  registerMobilePushDevice,
  unregisterMobilePushDevice,
  type MobilePushDeviceLocale,
} from "./app-rpc/account";
import { UuidString } from "./api/schema-helpers";

export const inboxNotificationCategories = [
  "urgent",
  "action_required",
  "important",
  "activity",
] as const satisfies readonly InboxCategory[];

export type InboxNotificationPreferences = Record<InboxCategory, boolean>;

const storageKey = "briar.settings.inbox-notifications.v1";
const soundStorageKey = "briar.settings.inbox-notification-sound.v1";
const targetStorageKey = "briar.inbox.notification-targets.v1";
const browserOpenEvent = "briar:inbox-notification-open";
const preferencesChangedEvent = "briar:inbox-notification-preferences-changed";
const androidRemoteOpenEvent = "briar-remote-notification-open";
const androidPushTokenEvent = "briar-remote-push-token";
const androidRemoteReceiptStorageKey = "briar.remote-push-receipts.v1";
const androidRemoteReceiptLifetimeMs = 7 * 24 * 60 * 60 * 1_000;

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

export const defaultInboxNotificationPreferences = () =>
  ({
    urgent: false,
    action_required: false,
    important: false,
    activity: false,
  }) satisfies InboxNotificationPreferences;

export const recommendedInboxNotificationPreferences = () =>
  ({
    urgent: true,
    action_required: true,
    important: true,
    activity: false,
  }) satisfies InboxNotificationPreferences;

export function inboxNotificationsEnabled(
  preferences: InboxNotificationPreferences,
) {
  return inboxNotificationCategories.some((category) => preferences[category]);
}

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
    window.dispatchEvent(new Event(preferencesChangedEvent));
  } catch {
    // Keep the preference in the mounted settings screen when storage is unavailable.
  }
}

export function readInboxNotificationSoundPreference() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(soundStorageKey) !== "false";
  } catch {
    return true;
  }
}

export function writeInboxNotificationSoundPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(soundStorageKey, String(enabled));
    window.dispatchEvent(new Event(preferencesChangedEvent));
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
    ...(message.kind === "conversation"
      ? { conversationMessageId: message.messageId }
      : message.kind === "channel"
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

/** Channel targets retain the channel message and thread context. */
export function isInboxChannelTarget(
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

function inboxNotificationTargetFrom(
  value: unknown,
): InboxNotificationTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target = value as Partial<InboxNotificationTarget>;
  if (
    typeof target.messageId !== "string" ||
    typeof target.projectId !== "string" ||
    typeof target.targetId !== "string" ||
    (target.kind !== "issue" &&
      target.kind !== "conversation" &&
      target.kind !== "session" &&
      target.kind !== "channel") ||
    (target.kind === "channel" &&
      (typeof target.channelMessageId !== "string" ||
        typeof target.rootMessageId !== "string"))
  ) {
    return null;
  }
  return {
    messageId: target.messageId,
    projectId: target.projectId,
    targetId: target.targetId,
    kind: target.kind,
    ...(typeof target.conversationMessageId === "string"
      ? { conversationMessageId: target.conversationMessageId }
      : {}),
    ...(typeof target.channelMessageId === "string"
      ? { channelMessageId: target.channelMessageId }
      : {}),
    ...(typeof target.rootMessageId === "string"
      ? { rootMessageId: target.rootMessageId }
      : {}),
  };
}

type AndroidRemoteNotificationOpen = {
  target: InboxNotificationTarget;
  messageVersion: string;
  notificationId: string;
};

const decodeMobilePushValue = Schema.decodeUnknownSync(
  Schema.Trim.check(Schema.isNonEmpty()),
);
const decodeMobilePushUuid = Schema.decodeUnknownSync(UuidString);

const requiredMobilePushValue = (value: string, field: string) => {
  const decoded = decodeMobilePushValue(value);
  if (decoded !== value) {
    throw new Error(`Mobile push target ${field} is required`);
  }
  return decoded;
};

const requiredMobilePushUuid = (value: string) => decodeMobilePushUuid(value);

const impossibleMobilePushDestination = (destination: never): never => {
  throw new Error(`Unknown mobile push destination: ${String(destination)}`);
};

const mobilePushNotificationOpenFromMessage = (
  message: MobilePushNotificationTarget,
): AndroidRemoteNotificationOpen => {
  const messageId = requiredMobilePushValue(
    message.inboxMessageId,
    "inbox_message_id",
  );
  const messageVersion = requiredMobilePushValue(
    message.inboxMessageVersion,
    "inbox_message_version",
  );
  const notificationId = requiredMobilePushValue(
    message.notificationId,
    "notification_id",
  );
  const projectId = requiredMobilePushUuid(message.projectId);
  const metadata = { messageVersion, notificationId };
  const destination = message.destination;
  switch (destination.case) {
    case "issue":
      return {
        target: {
          messageId,
          projectId,
          targetId: requiredMobilePushUuid(message.targetId),
          kind: "issue",
        },
        ...metadata,
      };
    case "conversation":
      return {
        target: {
          messageId,
          projectId,
          targetId: requiredMobilePushUuid(message.targetId),
          kind: "conversation",
          conversationMessageId: requiredMobilePushUuid(
            destination.value.conversationMessageId,
          ),
        },
        ...metadata,
      };
    case "channel":
      return {
        target: {
          messageId,
          projectId,
          targetId: requiredMobilePushUuid(message.targetId),
          kind: "channel",
          channelMessageId: requiredMobilePushUuid(
            destination.value.channelMessageId,
          ),
          rootMessageId: requiredMobilePushUuid(
            destination.value.rootMessageId,
          ),
        },
        ...metadata,
      };
    case "session":
      return {
        target: {
          messageId,
          projectId,
          targetId: requiredMobilePushValue(message.targetId, "target_id"),
          kind: "session",
        },
        ...metadata,
      };
    case undefined:
      throw new Error("Mobile push target destination is required");
  }
  return impossibleMobilePushDestination(destination);
};

const standardBase64Bytes = (encoded: string) => {
  const binary = atob(encoded);
  if (btoa(binary) !== encoded) throw new Error("Non-canonical base64 payload");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export function decodeMobilePushNotificationOpen(
  encoded: unknown,
): AndroidRemoteNotificationOpen | null {
  if (typeof encoded !== "string" || encoded.length === 0) return null;
  try {
    return mobilePushNotificationOpenFromMessage(
      fromBinary(
        MobilePushNotificationTargetSchema,
        standardBase64Bytes(encoded),
      ),
    );
  } catch {
    return null;
  }
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
      for (const candidate of pending) {
        const target = inboxNotificationTargetFrom(candidate);
        if (target) onOpen(target);
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

function readStoredTargets() {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(
      window.localStorage.getItem(targetStorageKey) ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, candidate]) => {
        const target = inboxNotificationTargetFrom(candidate);
        const storedAt = (candidate as { storedAt?: unknown }).storedAt;
        return target && typeof storedAt === "number"
          ? [[id, { ...target, storedAt }] as const]
          : [];
      }),
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
    return inboxNotificationTargetFrom(target);
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
  return stored ? inboxNotificationTargetFrom(stored) : null;
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
      if (isMacDesktopTauri()) {
        return listenForMacInboxNotificationClicks(onOpen, {
          listenAvailable: (callback) =>
            events.inboxNotificationOpenAvailable.listen(callback),
          drain: () => commands.drainPendingInboxNotificationOpens(),
        });
      }
      return events.inboxNotificationOpen.listen(({ payload }) => {
        const target = inboxNotificationTargetFrom(payload);
        if (target) onOpen(target);
      });
    }

    const drainRemoteOpen = () => {
      const open = decodeMobilePushNotificationOpen(
        androidPushBridge()?.drainOpen(),
      );
      if (open) {
        recordAndroidRemoteNotificationReceipt(open);
        onOpen(open.target);
      }
    };
    window.addEventListener(androidRemoteOpenEvent, drainRemoteOpen);
    drainRemoteOpen();
    const { onAction } = await import("@tauri-apps/plugin-notification");
    const listener = await onAction((payload) => {
      const target = targetFromNotificationAction(payload);
      if (target) onOpen(target);
    });
    return () => {
      window.removeEventListener(androidRemoteOpenEvent, drainRemoteOpen);
      listener.unregister();
    };
  }

  const handleOpen = (event: Event) => {
    const target = inboxNotificationTargetFrom(
      (event as CustomEvent<unknown>).detail,
    );
    if (target) onOpen(target);
  };
  window.addEventListener(browserOpenEvent, handleOpen);
  return () => window.removeEventListener(browserOpenEvent, handleOpen);
}

type AndroidPushBridge = {
  token: () => string;
  configured: () => boolean;
  drainOpen: () => string;
  hasActiveInboxNotification: (identity: string) => boolean;
};

function readAndroidRemoteNotificationReceipts() {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(androidRemoteReceiptStorageKey) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const cutoff = Date.now() - androidRemoteReceiptLifetimeMs;
    return Object.fromEntries(Object.entries(parsed).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && entry[1] >= cutoff,
    ));
  } catch {
    return {};
  }
}

function recordAndroidRemoteNotificationReceipt(
  open: AndroidRemoteNotificationOpen,
) {
  try {
    const receipts = readAndroidRemoteNotificationReceipts();
    receipts[`${open.notificationId}\u0000${open.messageVersion}`] = Date.now();
    window.localStorage.setItem(
      androidRemoteReceiptStorageKey,
      JSON.stringify(receipts),
    );
  } catch {
    // The active OS notification remains the short-lived duplicate guard.
  }
}

function androidRemoteNotificationAlreadyHandled(message: InboxMessage) {
  const identity = inboxNotificationIdentity(message);
  if (
    readAndroidRemoteNotificationReceipts()[
      `${identity}\u0000${message.version}`
    ]
  ) {
    return true;
  }
  try {
    return androidPushBridge()?.hasActiveInboxNotification(identity) ?? false;
  } catch {
    return false;
  }
}

function androidPushBridge(): AndroidPushBridge | null {
  if (getMobilePlatform() !== "android" || typeof window === "undefined") {
    return null;
  }
  const bridge = (window as typeof window & {
    BriarAndroidPush?: AndroidPushBridge;
  }).BriarAndroidPush;
  return bridge?.configured() ? bridge : null;
}

function pushLocale(): MobilePushDeviceLocale {
  const language = document.documentElement.lang.toLowerCase();
  if (language.startsWith("zh")) return "zh";
  if (language.startsWith("en")) return "en";
  return "ko";
}

export async function synchronizeAndroidPushRegistration(
  sessionToken: string,
) {
  const bridge = androidPushBridge();
  const token = bridge?.token().trim();
  if (!bridge || !token) return false;
  const preferences = readInboxNotificationPreferences();
  await registerMobilePushDevice(sessionToken, {
    endpoint: "fcm",
    deviceToken: token,
    locale: pushLocale(),
    playSound: readInboxNotificationSoundPreference(),
    urgent: preferences.urgent,
    actionRequired: preferences.action_required,
    important: preferences.important,
    activity: preferences.activity,
  });
  return true;
}

export async function deleteAndroidPushRegistration(sessionToken: string) {
  const bridge = androidPushBridge();
  const token = bridge?.token().trim();
  if (!bridge || !token) return false;
  await unregisterMobilePushDevice(sessionToken, "fcm", token);
  return true;
}

export const androidPushRegistrationEvents = {
  preferencesChanged: preferencesChangedEvent,
  tokenChanged: androidPushTokenEvent,
} as const;

export async function requestInboxNotificationPermission() {
  if (isTauriRuntime()) {
    if (isMacDesktopTauri()) {
      return commands.requestInboxNotificationPermission();
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

export async function readInboxNotificationPermissionStatus(): Promise<
  InboxNotificationPermissionStatus
> {
  if (isMacDesktopTauri()) {
    return commands.inboxNotificationPermissionStatus();
  }

  if (isTauriRuntime()) {
    const { isPermissionGranted } = await import(
      "@tauri-apps/plugin-notification"
    );
    return (await isPermissionGranted()) ? "authorized" : "not_determined";
  }

  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "authorized";
  if (Notification.permission === "denied") return "denied";
  return "not_determined";
}

export async function openInboxNotificationSystemSettings() {
  if (!isMacDesktopTauri()) return false;
  await commands.openInboxNotificationSettings();
  return true;
}

export type InboxNotificationContent = {
  title: string;
  body: string;
};

export type InboxNotificationLabelKey =
  | "status.paused"
  | "status.completed"
  | "status.failed"
  | "status.blocked"
  | `inbox.category.${InboxCategory}`;

export function inboxNotificationLabelKey(
  message: InboxMessage,
  category: InboxCategory,
): InboxNotificationLabelKey {
  if (message.kind === "session") {
    return `status.${message.status}`;
  }
  if (
    message.kind === "issue" &&
    (message.status === "paused" ||
      message.status === "completed" ||
      message.status === "failed" ||
      message.status === "blocked")
  ) {
    return `status.${message.status}`;
  }
  return `inbox.category.${category}`;
}

function isReplyMessage(message: InboxMessage) {
  if (message.kind === "conversation") {
    return message.messageId !== message.rootMessageId;
  }
  if (message.kind === "channel") {
    return message.messageId !== message.rootMessageId;
  }
  return false;
}

function notificationPreview(body: string) {
  return body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
}

export function inboxNotificationContent(
  message: InboxMessage,
  notificationLabel: string,
): InboxNotificationContent {
  if (message.kind === "session") {
    const finalMessage = [message.summary, message.error, message.title].find(
      (value) => value?.trim(),
    );
    return {
      title: `${message.agentName?.trim() || "Briar"} · ${notificationLabel}`,
      body:
        notificationPreview(finalMessage ?? notificationLabel) ||
        notificationLabel,
    };
  }

  if (
    (message.kind === "conversation" || message.kind === "channel") &&
    (isReplyMessage(message) || message.reason === "subscription")
  ) {
    const destination =
      message.kind === "channel"
        ? `#${message.channelName}`
        : (message.issueKey ?? message.title);
    return {
      title: `${message.authorName.trim() || "Briar"} in ${destination}`,
      body: notificationPreview(message.body),
    };
  }

  if (message.kind === "issue") {
    const identity = message.projectName
      ? `${message.projectName} · ${message.title}`
      : message.title;
    const summary = notificationPreview(
      message.structuredResult?.summary?.trim() ?? "",
    );
    const nextAction = message.structuredResult?.humanActionRequired
      ? notificationPreview(message.structuredResult.nextAction?.trim() ?? "")
      : "";
    return {
      title: `Briar · ${notificationLabel}`,
      body: notificationPreview([identity, summary || nextAction].filter(Boolean).join("\n")),
    };
  }

  return {
    title: `Briar · ${notificationLabel}`,
    body: message.projectName
      ? `${message.projectName} · ${message.title}`
      : message.title,
  };
}

export async function sendInboxNotification(
  message: InboxMessage,
  notificationLabel: string,
  playSound = readInboxNotificationSoundPreference(),
) {
  const { title, body } = inboxNotificationContent(message, notificationLabel);
  const target = inboxNotificationTarget(message);

  if (isTauriRuntime()) {
    if (isDesktopTauri()) {
      if (
        isMacDesktopTauri() &&
        (await readInboxNotificationPermissionStatus()) !== "authorized"
      ) {
        return false;
      }
      await commands.showInboxNotification(
        title,
        body,
        target,
        playSound,
      );
      return true;
    }

    const {
      createChannel,
      Importance,
      isPermissionGranted,
      sendNotification,
    } = await import(
      "@tauri-apps/plugin-notification"
    );
    if (!(await isPermissionGranted())) return false;
    const id = inboxNotificationId(inboxNotificationIdentity(message));
    storeNotificationTarget(id, target);
    const mobilePlatform = getMobilePlatform();
    if (
      mobilePlatform === "android" &&
      androidRemoteNotificationAlreadyHandled(message)
    ) return false;
    const channelId = playSound
      ? "briar-inbox-sound-v1"
      : "briar-inbox-silent-v1";
    if (mobilePlatform === "android") {
      try {
        await createChannel({
          id: channelId,
          name: playSound ? "Briar inbox" : "Briar inbox (silent)",
          description: "Briar inbox updates",
          importance: playSound ? Importance.Default : Importance.Low,
        });
      } catch {
        // Android versions before notification channels ignore channel IDs.
      }
    }
    await sendNotification({
      id,
      title,
      body,
      group: "briar-inbox",
      ...(mobilePlatform === "android" ? { channelId } : {}),
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
  const notification = new Notification(title, {
    body,
    tag: inboxNotificationIdentity(message),
    silent: !playSound,
  });
  notification.onclick = () => {
    window.focus();
    dispatchBrowserNotificationOpen(target);
    notification.close();
  };
  return true;
}
