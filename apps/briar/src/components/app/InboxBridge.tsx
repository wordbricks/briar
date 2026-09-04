import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useCallback, useEffect, useMemo } from "react";

import { useInbox } from "../../hooks/useInbox";
import {
  useInboxNotificationClicks,
  useInboxNotifications,
} from "../../hooks/useInboxNotifications";
import { syncAppBadgeCount } from "../../lib/app-badge";
import { createInboxRealtimeTransport } from "../../lib/channel-realtime";
import type { InboxNotificationTarget } from "../../generated/tauri";
import {
  viewingChannelIdAtom,
  viewingChannelThreadRootMessageIdAtom,
  viewingIssueConversationRunIdAtom,
} from "../../state/channels/atoms";
import { agentSessionsAtom } from "../../state/agent-sessions/atoms";
import { setInboxCallbacks } from "../../state/inbox/actions";
import {
  inboxMessagesAtom,
  inboxSourceAtom,
  inboxUnreadCountAtom,
} from "../../state/inbox/atoms";
import { pendingInboxNotificationTargetAtom } from "../../state/navigation/atoms";
import { activeOrganizationIdAtom } from "../../state/organization/atoms";
import { lockedTeamIdAtom } from "../../state/platform";
import { useRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { teamsAtom } from "../../state/team/atoms";

/*
  Everything below `App` that still reads a whole team's board.

  `useInbox` derives a team's issue notifications from its runs. It was `App`'s,
  which is why every polling tick that changed one run re-rendered the entire
  tree on its way to the inbox.

  It lives here instead, in a component that renders nothing: the inbox result
  is published to `state/inbox`, and the shells subscribe to what they actually
  read. `App` itself subscribes to no run.

  `useInbox` takes a payload-shaped argument, which `inboxSourceAtom` builds out
  of the store: the team, the runs that can actually become a message, and the
  two notification feeds, each keeping the reference the store holds. A tick
  that touched none of them therefore does not render this component. Follow-up
  F4 replaces the argument with the atoms themselves and this bridge with
  nothing.

  The worker dispatch reconciliation subscribed here for the same reason. It
  moved to `state/agent-sessions/useAgentSessionSync` with the rest of that
  domain, so the open board has one reader here now instead of two.

  The agent sessions a completion becomes a message from are read here too,
  rather than handed down by `App`: that is the last reason the shell had to
  subscribe to them.
*/

export function InboxBridge() {
  const registry = useRegistry();
  const sessions = useAtomValue(agentSessionsAtom);
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const teams = useAtomValue(teamsAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const inboxSource = useAtomValue(inboxSourceAtom);
  const viewingChannelId = useAtomValue(viewingChannelIdAtom);
  const viewingChannelThreadRootMessageId = useAtomValue(
    viewingChannelThreadRootMessageIdAtom,
  );
  const viewingIssueConversationRunId = useAtomValue(
    viewingIssueConversationRunIdAtom,
  );
  const setPendingInboxNotificationTarget = useAtomSet(
    pendingInboxNotificationTargetAtom,
  );

  const inboxRealtime = useMemo(
    () =>
      token && activeOrganizationId && user?.id
        ? createInboxRealtimeTransport(token, activeOrganizationId)
        : null,
    [activeOrganizationId, token, user?.id],
  );

  const inbox = useInbox(
    user?.id ?? null,
    activeOrganizationId,
    inboxSource,
    sessions,
    teams,
    token,
    inboxRealtime,
  );

  /*
    Published in one batch so a subscriber never sees a message list and an
    unread count that disagree. The callbacks go through a registry holder
    rather than an atom: they change identity whenever the message list does,
    and a view that re-rendered for that would be back where this started.
  */
  useEffect(() => {
    setInboxCallbacks(registry, {
      markAllRead: inbox.markAllRead,
      markIssueRead: inbox.markIssueRead,
      markRead: inbox.markRead,
      markUnread: inbox.markUnread,
    });
  });

  useEffect(() => {
    Atom.batch(() => {
      registry.set(inboxMessagesAtom, inbox.messages);
      registry.set(inboxUnreadCountAtom, inbox.unreadCount);
    });
  }, [inbox.messages, inbox.unreadCount, registry]);

  useInboxNotifications(
    lockedTeamId ? null : (user?.id ?? null),
    activeOrganizationId,
    inbox.messages,
    inbox.notificationBaselineId,
    viewingChannelId,
    viewingChannelThreadRootMessageId,
    viewingIssueConversationRunId,
    inbox.initialSyncComplete,
    token,
  );

  const handleInboxNotificationClick = useCallback(
    (target: InboxNotificationTarget) => {
      // A project window has no inbox of its own to open a notification into.
      if (!lockedTeamId) setPendingInboxNotificationTarget(target);
    },
    [lockedTeamId, setPendingInboxNotificationTarget],
  );
  useInboxNotificationClicks(handleInboxNotificationClick);

  useEffect(() => {
    if (lockedTeamId) return;
    void syncAppBadgeCount(inbox.unreadCount).catch(() => {
      // An unsupported desktop environment or Android launcher must not block
      // the app.
    });
  }, [inbox.unreadCount, lockedTeamId]);

  return null;
}
