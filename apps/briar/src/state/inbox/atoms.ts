import * as Atom from "effect/unstable/reactivity/Atom";

import { inboxConversationSyncSignal } from "../../hooks/useInboxNotifications";
import {
  classifyInboxMessage,
  type InboxMessageWithReadState,
} from "../../hooks/useInbox";
import { shallowArrayEqual } from "../entities/upsert";
import { lockedTeamIdAtom } from "../platform";

/*
  The inbox, published rather than passed.

  `useInbox` is still a hook with its own storage, feed sync and realtime
  transport — converting it is not this phase's work. What changed is where its
  result lands: a bridge component below `App` writes it here, and the shells
  and pages subscribe. `App` therefore no longer re-renders when a run changes,
  which is what made every inbox tick cost a whole-tree render.
*/

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
