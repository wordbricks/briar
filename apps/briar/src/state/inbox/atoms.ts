import * as Atom from "effect/unstable/reactivity/Atom";

import { inboxConversationSyncSignal } from "../../hooks/useInboxNotifications";
import {
  classifyInboxMessage,
  inboxIssueNotifyingStatuses,
  type InboxMessageWithReadState,
  type InboxSource,
} from "../../hooks/useInbox";
import type { HuntRun } from "../../types";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { shallowArrayEqual } from "../entities/upsert";
import { lockedTeamIdAtom } from "../platform";
import { activeTeamIdAtom, teamNotificationsAtom } from "../team/atoms";

/*
  The inbox, published rather than passed.

  `useInbox` is still a hook with its own storage, feed sync and realtime
  transport — converting it is not this phase's work. What changed is where its
  result lands: a bridge component below `App` writes it here, and the shells
  and pages subscribe. `App` therefore no longer re-renders when a run changes,
  which is what made every inbox tick cost a whole-tree render.
*/

/*
  What `useInbox` reads of the open team.

  The hook still takes a payload-shaped argument — converting it is follow-up
  F4 — but it only ever reads four projections of one, and of the run list only
  the runs that can *become* a message: one whose status notifies, or one a
  conversation notification points at. Filtering to those here is what lets the
  bridge sit still through a polling tick that moved a running run's progress
  bar, which is most of them.
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
 * Each part keeps the reference the store holds, so the hook's own memo over
 * them survives a tick that changed something else.
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

/** Every message the inbox knows, across the account's teams. */
export const inboxMessagesAtom = Atom.make<InboxMessageWithReadState[]>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("inbox/messages"),
);

/** Unread count over every message, which the badge and the phone header use. */
export const inboxUnreadCountAtom = Atom.make(0).pipe(
  Atom.keepAlive,
  Atom.withLabel("inbox/unreadCount"),
);

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
  get(visibleInboxMessagesAtom).filter(
    (message) =>
      message.isUnread && classifyInboxMessage(message) !== "activity",
  ).length,
).pipe(Atom.keepAlive, Atom.withLabel("inbox/visibleUnreadCount"));

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
