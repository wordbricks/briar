import * as Option from "effect/Option";
import * as Atom from "effect/unstable/reactivity/Atom";

import type { HuntRun, Project } from "../../types";
import { agentSessionsAtom } from "../agent-sessions/atoms";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { shallowArrayEqual } from "../entities/upsert";
import { lockedTeamIdAtom } from "../platform";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { tokenAtom, userAtom } from "../session/atoms";
import { activeTeamIdAtom, teamNotificationsAtom, teamsAtom } from "../team/atoms";
import {
  buildCurrentInboxMessages,
  classifyInboxMessage,
  collapseInboxThreadMessages,
  filterInboxMessagesByOrganization,
  inboxConversationSyncSignal,
  inboxIssueNotifyingStatuses,
  inboxMessageSnapshotsEqual,
  isInboxMessageUnread,
  reuseInboxMessageIdentities,
  type InboxCategory,
  type InboxMessage,
  type InboxMessageWithReadState,
  type InboxSource,
} from "./model";
import { inboxStorageKey, readInboxState, type InboxState } from "./persistence";

/*
  The inbox, derived rather than published.

  Until follow-up F4 a hook below `App` owned all of this and a bridge component
  copied its result into two atoms. Now the whole chain is here: the stored
  record, the messages the open board implies, the merge of the two, and the
  counts and per-row atoms the views read. `state/inbox/useInboxSync.ts` feeds
  the two ends that are not arithmetic — the account feed and the read-state
  round trip — and `actions.ts` writes what a click means.

  Two identity rules do the render-count work. The source keeps the references
  the store holds, so a polling tick that moved a running run's progress bar
  reaches nothing here; and the displayed list reuses the object each message
  already had, so a tick that changed one message wakes one row.
*/

/*
  What the inbox reads of the open team: of the run list only the runs that can
  *become* a message — one whose status notifies, or one a conversation
  notification points at.
*/

/** The runs of `teamId` that the inbox can build a message from. */
const inboxTeamRunsAtom = Atom.family((teamId: string) =>
  Atom.make((get): HuntRun[] | null => {
    const ids = get(teamRunIdsAtom(teamId));
    if (!ids) return null;
    const runs = get(runsByIdAtom);
    const conversation = get(teamNotificationsAtom(teamId)).conversation;
    const notified = new Set(
      conversation?.map((notification) => notification.runId) ?? [],
    );
    const resolved: HuntRun[] = [];
    for (const id of ids) {
      const run = runs.get(id);
      if (!run) continue;
      if (inboxIssueNotifyingStatuses.has(run.status) || notified.has(run.id)) {
        resolved.push(run);
      }
    }
    return resolved;
  }).pipe(
    Atom.withEquality<HuntRun[] | null>(shallowArrayEqual),
    Atom.withLabel(`inbox/team/${teamId}/runs`),
  ),
);

const sameInboxSource = (
  left: InboxSource | null,
  right: InboxSource | null,
) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.team === right.team &&
    left.runs === right.runs &&
    left.conversationNotifications === right.conversationNotifications &&
    left.channelNotifications === right.channelNotifications);

/**
 * The selected team as the inbox sees it, or `null` before it has a payload.
 * Each part keeps the reference the store holds, so the derivation over them
 * survives a tick that changed something else.
 */
export const inboxSourceAtom = Atom.make((get): InboxSource | null => {
  const teamId = get(activeTeamIdAtom);
  if (teamId === null) return null;
  const team = get(teamEntityAtom(teamId));
  const runs = get(inboxTeamRunsAtom(teamId));
  if (!team || !runs) return null;
  const notifications = get(teamNotificationsAtom(teamId));
  return {
    team,
    runs,
    conversationNotifications: notifications.conversation ?? undefined,
    channelNotifications: notifications.channel ?? undefined,
  };
}).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameInboxSource),
  Atom.withLabel("inbox/source"),
);

/** The signed-in account id, which names both the record and the messages. */
export const inboxUserIdAtom = Atom.make(
  (get): string | null => get(userAtom)?.id ?? null,
).pipe(Atom.keepAlive, Atom.withLabel("inbox/userId"));

/** Which `localStorage` record this window's inbox is. */
export const inboxStorageKeyAtom = Atom.make((get): string =>
  inboxStorageKey(get(inboxUserIdAtom)),
).pipe(Atom.keepAlive, Atom.withLabel("inbox/storageKey"));

/**
 * The stored record, read on first access rather than on mount, so the first
 * component to look has yesterday's inbox without waiting for an effect.
 *
 * The read body depends on the storage key, which is what makes signing in as
 * somebody else swap the whole record: the key changes, this recomputes, and
 * the writes the previous account made stay in its own key.
 */
export const inboxStateAtom = Atom.writable<InboxState, InboxState>(
  (get) => readInboxState(get(inboxStorageKeyAtom)),
  (ctx, value) => ctx.setSelf(value),
).pipe(Atom.keepAlive, Atom.withLabel("inbox/state"));

/** The account and record one read-state round trip belongs to. */
export type InboxReadSyncIdentity = {
  readonly storageKey: string;
  readonly token: string;
  readonly userId: string;
};

/** The account and organization one feed refresh belongs to. */
export type InboxFeedIdentity = {
  readonly scope: string;
  readonly token: string;
};

/**
 * The identity whose account read versions have arrived. Until it matches the
 * account on screen every message reads as read: showing an unread badge from a
 * stale local cache and taking it away a moment later is worse than waiting.
 */
export const inboxReadSyncIdentityAtom = Atom.make<InboxReadSyncIdentity | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("inbox/readSyncIdentity"));

/** The identity whose authoritative feed has arrived. */
export const inboxFeedIdentityAtom = Atom.make<InboxFeedIdentity | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("inbox/feedIdentity"));

/** The feed scope on screen, or `null` when there is not one yet. */
export const inboxFeedScopeAtom = Atom.make((get): string | null => {
  const userId = get(inboxUserIdAtom);
  const organizationId = get(activeOrganizationIdAtom);
  return userId && organizationId ? `${userId}:${organizationId}` : null;
}).pipe(Atom.keepAlive, Atom.withLabel("inbox/feedScope"));

/**
 * True once both account responses — the read versions and the authoritative
 * feed — have arrived for the account and organization on screen. Unread
 * markers, the app badge and system notifications all wait on it.
 */
export const inboxInitialSyncCompleteAtom = Atom.make((get): boolean => {
  const token = get(tokenAtom);
  const userId = get(inboxUserIdAtom);
  const organizationId = get(activeOrganizationIdAtom);
  const storageKey = get(inboxStorageKeyAtom);
  const feedScope = get(inboxFeedScopeAtom);
  const readSync = get(inboxReadSyncIdentityAtom);
  const feed = get(inboxFeedIdentityAtom);
  return Boolean(
    token &&
      userId &&
      organizationId &&
      readSync?.storageKey === storageKey &&
      readSync.token === token &&
      readSync.userId === userId &&
      feed?.scope === feedScope &&
      feed.token === token,
  );
}).pipe(Atom.keepAlive, Atom.withLabel("inbox/initialSyncComplete"));

/**
 * What a system notification baseline is keyed on: the account feed once it has
 * answered, and a local marker before that, so the first authoritative response
 * is a new baseline rather than a burst of alerts for everything already there.
 */
export const inboxNotificationBaselineIdAtom = Atom.make((get): string => {
  const feedScope = get(inboxFeedScopeAtom);
  const feed = get(inboxFeedIdentityAtom);
  return feed?.scope === feedScope && feedScope !== null
    ? feed.scope
    : `${get(inboxUserIdAtom) ?? "signed-out"}:local`;
}).pipe(Atom.keepAlive, Atom.withLabel("inbox/notificationBaselineId"));

/** The messages the open board and this device's sessions imply right now. */
export const currentInboxMessagesAtom = Atom.make((get): InboxMessage[] =>
  buildCurrentInboxMessages(
    get(inboxSourceAtom),
    get(agentSessionsAtom),
    get(teamsAtom),
    get(inboxUserIdAtom),
  ),
).pipe(
  Atom.keepAlive,
  Atom.withEquality<InboxMessage[]>(inboxMessageSnapshotsEqual),
  Atom.withLabel("inbox/currentMessages"),
);

/**
 * Everything the merge of board into store depends on, in one atom so a
 * subscriber wakes for the same four reasons the effect it replaced did.
 */
export interface InboxMergeSources {
  readonly currentMessages: readonly InboxMessage[];
  readonly projects: readonly Project[];
  readonly storageKey: string;
  readonly userId: string | null;
}

export const inboxMergeSourcesAtom = Atom.make((get) =>
  ({
    currentMessages: get(currentInboxMessagesAtom),
    projects: get(teamsAtom),
    storageKey: get(inboxStorageKeyAtom),
    userId: get(inboxUserIdAtom),
  }) satisfies InboxMergeSources
).pipe(Atom.keepAlive, Atom.withLabel("inbox/mergeSources"));

/**
 * Every message the inbox knows, across the account's teams: the stored record
 * scoped to the open organization, marked read and collapsed into threads.
 *
 * A message that would render identically keeps the object it had, so the row
 * atoms below compare equal and the rows they feed do not re-render.
 */
export const inboxMessagesAtom = Atom.make(
  (get): InboxMessageWithReadState[] => {
    const state = get(inboxStateAtom);
    const storageKey = get(inboxStorageKeyAtom);
    const initialSyncComplete = get(inboxInitialSyncCompleteAtom);
    const next = state.storageKey === storageKey
      ? collapseInboxThreadMessages(
          filterInboxMessagesByOrganization(
            state.messages,
            get(teamsAtom),
            get(activeOrganizationIdAtom),
          ).map((message) => ({
            ...message,
            isUnread:
              initialSyncComplete &&
              isInboxMessageUnread(message, state.readVersions),
          })),
        )
      : [];
    const previous = Option.getOrElse(
      get.self<InboxMessageWithReadState[]>(),
      (): InboxMessageWithReadState[] => [],
    );
    return reuseInboxMessageIdentities(previous, next);
  },
).pipe(
  Atom.keepAlive,
  Atom.withEquality<InboxMessageWithReadState[]>(shallowArrayEqual),
  Atom.withLabel("inbox/messages"),
);

/** Every message by id, so a row subscribes to one message rather than a list. */
export const inboxMessagesByIdAtom = Atom.make(
  (get): ReadonlyMap<string, InboxMessageWithReadState> =>
    new Map(get(inboxMessagesAtom).map((message) => [message.id, message])),
).pipe(Atom.keepAlive, Atom.withLabel("inbox/messagesById"));

/** One displayed message, or `null` when the list no longer has it. */
export const inboxMessageAtom = Atom.family((messageId: string) =>
  Atom.map(
    inboxMessagesByIdAtom,
    (messages) => messages.get(messageId) ?? null,
  ).pipe(Atom.withLabel(`inbox/message/${messageId}`)),
);

/** Unread count over every message, which the badge and the phone header use. */
export const inboxUnreadCountAtom = Atom.make((get): number =>
  countActionableUnread(get(inboxMessagesAtom)),
).pipe(Atom.keepAlive, Atom.withLabel("inbox/unreadCount"));

/**
 * What this window may show. A project window is pinned to one team and must
 * not surface another team's notifications; the main window shows everything.
 */
export const visibleInboxMessagesAtom = Atom.make(
  (get): InboxMessageWithReadState[] => {
    const messages = get(inboxMessagesAtom);
    const lockedTeamId = get(lockedTeamIdAtom);
    if (!lockedTeamId) return messages;
    return messages.filter((message) => message.projectId === lockedTeamId);
  },
).pipe(
  Atom.withEquality<InboxMessageWithReadState[]>(shallowArrayEqual),
  Atom.keepAlive,
  Atom.withLabel("inbox/visibleMessages"),
);

/**
 * Unread count over {@link visibleInboxMessagesAtom}. Activity messages are not
 * counted: they are a log of what happened, not something to act on.
 */
export const visibleInboxUnreadCountAtom = Atom.make((get): number =>
  countActionableUnread(get(visibleInboxMessagesAtom)),
).pipe(Atom.keepAlive, Atom.withLabel("inbox/visibleUnreadCount"));

/**
 * What the list needs of a message to filter, count, order and key it — and
 * nothing else. The rows read their own contents, so an edit to a message that
 * left its class and its read state alone does not reach the list at all.
 */
export interface InboxMessageSummary {
  readonly id: string;
  readonly projectId: string;
  readonly category: InboxCategory;
  readonly isUnread: boolean;
}

const sameInboxMessageSummary = (
  left: InboxMessageSummary,
  right: InboxMessageSummary,
) =>
  left.id === right.id &&
  left.projectId === right.projectId &&
  left.category === right.category &&
  left.isUnread === right.isUnread;

const summarizeInboxMessages = (
  previous: readonly InboxMessageSummary[],
  messages: readonly InboxMessageWithReadState[],
): InboxMessageSummary[] => {
  const previousById = new Map(
    previous.map((summary) => [summary.id, summary]),
  );
  return messages.map((message) => {
    const next: InboxMessageSummary = {
      id: message.id,
      projectId: message.projectId,
      category: classifyInboxMessage(message),
      isUnread: message.isUnread,
    };
    const stored = previousById.get(next.id);
    return stored && sameInboxMessageSummary(stored, next) ? stored : next;
  });
};

/** {@link visibleInboxMessagesAtom} as the list reads it. */
export const visibleInboxMessageSummariesAtom = Atom.make(
  (get): InboxMessageSummary[] =>
    summarizeInboxMessages(
      Option.getOrElse(
        get.self<InboxMessageSummary[]>(),
        (): InboxMessageSummary[] => [],
      ),
      get(visibleInboxMessagesAtom),
    ),
).pipe(
  Atom.keepAlive,
  Atom.withEquality<InboxMessageSummary[]>(shallowArrayEqual),
  Atom.withLabel("inbox/visibleMessageSummaries"),
);

function countActionableUnread(
  messages: readonly InboxMessageWithReadState[],
): number {
  return messages.filter(
    (message) =>
      message.isUnread && classifyInboxMessage(message) !== "activity",
  ).length;
}

/*
  The two signals a conversation view re-syncs on. They are strings so a view
  can put one in a dependency array: the inbox learning about a message the view
  has not fetched is the cue to fetch, and identical content is identical string.
*/

export const channelInboxSyncSignalAtom = Atom.make((get): string =>
  inboxConversationSyncSignal(get(inboxMessagesAtom), "channel"),
).pipe(Atom.keepAlive, Atom.withLabel("inbox/channelSyncSignal"));

export const conversationInboxSyncSignalAtom = Atom.make((get): string =>
  inboxConversationSyncSignal(get(inboxMessagesAtom), "conversation"),
).pipe(Atom.keepAlive, Atom.withLabel("inbox/conversationSyncSignal"));
