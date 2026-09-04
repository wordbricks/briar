import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import {
  MobilePushChannelDestinationSchema,
  MobilePushConversationDestinationSchema,
  MobilePushNotificationTargetSchema,
} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import type { InboxFeedMessage } from "./inbox-feed";
import { listInboxReadStates } from "./inbox-read-state-repository";
import { sendMobilePush, type MobilePushContent } from "./mobile-push-provider";
import {
  acknowledgeMobilePushOutbox,
  advanceMobilePushScope,
  deleteMobilePushRegistrationById,
  establishMobilePushScope,
  listMobilePushDeliveries,
  listMobilePushOutbox,
  listMobilePushRegistrations,
  pruneMobilePushDeliveries,
  recordMobilePushDeliveries,
  type MobilePushLocale,
  type MobilePushRegistrationRow,
} from "./mobile-push-repository";
import { loadOrganizationInboxFeed } from "./organization-inbox-feed";

type InboxCategory = "urgent" | "action_required" | "important" | "activity";

export function classifyMobilePushInboxMessage(
  message: InboxFeedMessage,
): InboxCategory {
  if (message.kind === "channel") return "action_required";
  if (message.kind === "conversation") {
    return message.reason === "subscription" ? "activity" : "action_required";
  }
  if (message.kind === "session") {
    return message.requiresAttention || message.status === "failed"
      ? "action_required"
      : "activity";
  }
  const result = message.structuredResult;
  if (
    result?.urgency === "immediate" ||
    result?.importance === "critical" ||
    (message.priority === 1 &&
      (message.status === "blocked" || message.status === "failed"))
  ) return "urgent";
  if (
    result?.humanActionRequired ||
    message.status === "blocked" ||
    message.status === "failed"
  ) return "action_required";
  if (
    result?.importance === "important" ||
    result?.impact === "project" ||
    result?.impact === "organization" ||
    (message.status === "completed" &&
      message.priority !== null && message.priority !== undefined &&
      message.priority <= 2)
  ) return "important";
  return "activity";
}

function categoryEnabled(
  registration: MobilePushRegistrationRow,
  category: InboxCategory,
) {
  switch (category) {
    case "urgent": return registration.notify_urgent === 1;
    case "action_required":
      return registration.notify_action_required === 1;
    case "important": return registration.notify_important === 1;
    case "activity": return registration.notify_activity === 1;
  }
}

export function mobilePushNotificationGroupId(message: InboxFeedMessage) {
  if (message.kind === "conversation" && message.rootMessageId) {
    return `conversation-thread:${message.projectId}:${message.targetId}:${message.rootMessageId}`;
  }
  if (message.kind === "channel" && message.rootMessageId) {
    return `channel-thread:${message.targetId}:${message.rootMessageId}`;
  }
  return message.id;
}

function preview(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n")
    .slice(0, 700);
}

const statusLabels = {
  ko: { paused: "검토 대기", completed: "완료", failed: "실패", blocked: "차단" },
  en: { paused: "Review needed", completed: "Completed", failed: "Failed", blocked: "Blocked" },
  zh: { paused: "等待审核", completed: "已完成", failed: "失败", blocked: "已阻止" },
} as const satisfies Record<
  MobilePushLocale,
  Record<"paused" | "completed" | "failed" | "blocked", string>
>;

const requiredDestinationField = (
  value: string | undefined,
  field: string,
) => {
  if (!value) throw new Error(`Inbox ${field} is required for mobile push`);
  return value;
};

const mobilePushDestination = (message: InboxFeedMessage) => {
  switch (message.kind) {
    case "issue":
      return { case: "issue", value: create(EmptySchema) } as const;
    case "conversation":
      return {
        case: "conversation",
        value: create(MobilePushConversationDestinationSchema, {
          conversationMessageId: requiredDestinationField(
            message.messageId,
            "conversation message ID",
          ),
        }),
      } as const;
    case "channel":
      return {
        case: "channel",
        value: create(MobilePushChannelDestinationSchema, {
          channelMessageId: requiredDestinationField(
            message.messageId,
            "channel message ID",
          ),
          rootMessageId: requiredDestinationField(
            message.rootMessageId,
            "channel root message ID",
          ),
        }),
      } as const;
    case "session":
      return { case: "session", value: create(EmptySchema) } as const;
  }
};

export function mobilePushNotificationContent(
  message: InboxFeedMessage,
  locale: MobilePushLocale,
): MobilePushContent {
  const status = message.status === "paused" ||
      message.status === "completed" ||
      message.status === "failed" ||
      message.status === "blocked"
    ? statusLabels[locale][message.status]
    : locale === "ko" ? "새 알림" : locale === "zh" ? "新通知" : "New update";
  let title = `Briar · ${status}`;
  let body = message.projectName
    ? `${message.projectName} · ${message.title}`
    : message.title;
  if (message.kind === "issue") {
    const summary = preview(message.structuredResult?.summary ?? "");
    const nextAction = message.structuredResult?.humanActionRequired
      ? preview(message.structuredResult.nextAction ?? "")
      : "";
    body = [body, summary || nextAction].filter(Boolean).join("\n");
  } else if (message.kind === "session") {
    title = `${message.agentName?.trim() || "Briar"} · ${status}`;
    body = preview(message.summary ?? message.error ?? message.title) || status;
  } else if (message.kind === "conversation" || message.kind === "channel") {
    const destination = message.kind === "channel"
      ? `#${message.channelName ?? message.title}`
      : (message.issueKey ?? message.title);
    title = `${message.authorName?.trim() || "Briar"} in ${destination}`;
    body = preview(message.body ?? "") || status;
  }
  return {
    title: title.slice(0, 160),
    body: preview(body) || status,
    collapseId: mobilePushNotificationGroupId(message),
    target: create(MobilePushNotificationTargetSchema, {
      inboxMessageId: message.id,
      inboxMessageVersion: message.version,
      notificationId: mobilePushNotificationGroupId(message),
      projectId: message.projectId,
      targetId: message.targetId,
      destination: mobilePushDestination(message),
    }),
  };
}

export function newestByMobilePushNotificationGroup(
  messages: InboxFeedMessage[],
) {
  const groups = new Map<string, InboxFeedMessage[]>();
  for (const message of messages) {
    const id = mobilePushNotificationGroupId(message);
    const group = groups.get(id) ?? [];
    group.push(message);
    groups.set(id, group);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    messages: group,
    representative: [...group].sort((left, right) =>
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
      right.id.localeCompare(left.id)
    )[0]!,
  })).sort((left, right) =>
    Date.parse(right.representative.occurredAt) -
      Date.parse(left.representative.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

type UserInboxState = {
  messages: InboxFeedMessage[];
  readVersions: Map<string, string>;
};

async function deliverRegistration(
  env: Env,
  db: D1Database,
  organizationId: string,
  version: number,
  registration: MobilePushRegistrationRow,
  state: UserInboxState,
  observedAt: string,
) {
  if (registration.baseline_version === null) {
    await establishMobilePushScope(
      db,
      registration.id,
      organizationId,
      version,
      observedAt,
    );
    return true;
  }
  if (registration.baseline_version >= version) return true;
  const delivered = new Set(
    (await listMobilePushDeliveries(db, registration.id)).map(
      (row) => `${row.message_id}\u0000${row.message_version}`,
    ),
  );
  const registeredAt = Date.parse(registration.registered_at);
  const candidates = state.messages.filter((message) => {
    const occurredAt = Date.parse(message.occurredAt);
    return Number.isFinite(occurredAt) &&
      Number.isFinite(registeredAt) &&
      occurredAt > registeredAt &&
      state.readVersions.get(message.id) !== message.version &&
      !delivered.has(`${message.id}\u0000${message.version}`) &&
      categoryEnabled(registration, classifyMobilePushInboxMessage(message));
  });
  const groups = newestByMobilePushNotificationGroup(candidates);
  for (const [index, group] of groups.entries()) {
    if (index < 5) {
      const result = await sendMobilePush(
        env,
        registration,
        mobilePushNotificationContent(
          group.representative,
          registration.locale,
        ),
      );
      if (result.outcome === "invalid_token") {
        await deleteMobilePushRegistrationById(db, registration.id);
        return true;
      }
      if (result.outcome === "retry") {
        console.error(JSON.stringify({
          message: "Mobile push delivery deferred",
          registrationId: registration.id,
          platform: registration.platform,
          organizationId,
          reason: result.reason,
        }));
        return false;
      }
    }
    await recordMobilePushDeliveries(
      db,
      registration.id,
      group.messages.map((message) => ({
        id: message.id,
        version: message.version,
      })),
      observedAt,
    );
  }
  await advanceMobilePushScope(
    db,
    registration.id,
    organizationId,
    version,
    observedAt,
  );
  return true;
}

export async function flushMobilePushOutbox(env: Env, db: D1Database) {
  const outbox = await listMobilePushOutbox(db);
  for (const row of outbox) {
    const registrations = await listMobilePushRegistrations(
      db,
      row.organization_id,
    );
    const userStates = new Map<string, Promise<UserInboxState>>();
    const stateFor = (userId: string) => {
      const existing = userStates.get(userId);
      if (existing) return existing;
      const loaded = Promise.all([
        loadOrganizationInboxFeed(db, row.organization_id, userId),
        listInboxReadStates(db, userId),
      ]).then(([feed, readStates]) => ({
        messages: feed.messages,
        readVersions: new Map(
          readStates.map((state) => [state.message_id, state.version]),
        ),
      }));
      userStates.set(userId, loaded);
      return loaded;
    };
    let completed = true;
    for (const registration of registrations) {
      try {
        const delivered = await deliverRegistration(
          env,
          db,
          row.organization_id,
          row.version,
          registration,
          await stateFor(registration.user_id),
          new Date().toISOString(),
        );
        completed = completed && delivered;
      } catch (error) {
        completed = false;
        console.error(JSON.stringify({
          message: "Mobile push registration delivery failed",
          organizationId: row.organization_id,
          registrationId: registration.id,
          platform: registration.platform,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    if (completed) {
      await acknowledgeMobilePushOutbox(
        db,
        row.organization_id,
        row.version,
      );
    }
  }
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000).toISOString();
  await pruneMobilePushDeliveries(db, cutoff);
}
