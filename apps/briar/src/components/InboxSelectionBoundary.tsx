import { useAtomValue } from "@effect/atom-react";
import { useCallback, type ComponentProps, type ReactNode } from "react";

import {
  inboxDetailTargetAtom,
  selectedInboxMessageIdAtom,
} from "../state/inbox-selection";
import { useInboxActions } from "../state/inbox/actions";
import {
  visibleInboxMessageSummariesAtom,
  visibleInboxUnreadCountAtom,
} from "../state/inbox/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import { useRegistry } from "../state/registry";
import type { InboxNotificationTarget } from "../generated/tauri";
import { Inbox } from "./Inbox";

/*
  Where the inbox list meets the store.

  The shells used to read the message list and the unread count and hand both
  down, which put every notification on the page's own render path. They live
  here instead: this boundary subscribes to the summaries and the count, the
  rows below subscribe to their own messages, and the page around it subscribes
  to neither.
*/

type ConnectedInboxProps = Omit<
  ComponentProps<typeof Inbox>,
  | "messages"
  | "onMarkAllRead"
  | "onMarkRead"
  | "onMarkUnread"
  | "selectedMessageId"
  | "unreadCount"
> & { readonly selectedMessageId?: string | null };

function ConnectedInbox(props: ConnectedInboxProps) {
  const messages = useAtomValue(visibleInboxMessageSummariesAtom);
  const unreadCount = useAtomValue(visibleInboxUnreadCountAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const registry = useRegistry();
  const { markAllRead, markRead, markUnread } = useInboxActions();
  const onMarkAllRead = useCallback(() => {
    if (!lockedTeamId) {
      markAllRead();
      return;
    }
    /*
      A project window may only read what it can see. "Mark all read" there is
      one read per visible unread row rather than the account-wide write, which
      would clear notifications for teams this window never showed.
    */
    for (const message of registry.get(visibleInboxMessageSummariesAtom)) {
      if (message.isUnread) markRead(message.id);
    }
  }, [lockedTeamId, markAllRead, markRead, registry]);

  return (
    <Inbox
      {...props}
      messages={messages}
      onMarkAllRead={onMarkAllRead}
      onMarkRead={markRead}
      onMarkUnread={markUnread}
      unreadCount={unreadCount}
    />
  );
}

/** The desktop inbox, which also highlights whatever the detail pane opened. */
export function InboxWithSelection(props: Omit<ConnectedInboxProps, "selectedMessageId">) {
  const selectedMessageId = useAtomValue(selectedInboxMessageIdAtom);
  return <ConnectedInbox {...props} selectedMessageId={selectedMessageId} />;
}

/** The phone inbox, which has no detail pane beside it to select into. */
export function CompanionInbox(
  props: Omit<ConnectedInboxProps, "selectedMessageId">,
) {
  return <ConnectedInbox {...props} />;
}

export function InboxDetailTargetBoundary({
  children,
}: {
  children: (target: InboxNotificationTarget | null) => ReactNode;
}) {
  const target = useAtomValue(inboxDetailTargetAtom);
  return children(target);
}
