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
import { setInboxCallbacks } from "../../state/inbox/actions";
import {
  inboxMessagesAtom,
  inboxUnreadCountAtom,
} from "../../state/inbox/atoms";
import { pendingInboxNotificationTargetAtom } from "../../state/navigation/atoms";
import { activeOrganizationIdAtom } from "../../state/organization/atoms";
import { lockedTeamIdAtom } from "../../state/platform";
import { useRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { activeDashboardAtom } from "../../state/sync/view";
import { teamsAtom } from "../../state/team/atoms";
import type { AutoHuntSession, HuntRun } from "../../types";

/*
  Everything below `App` that still needs the whole open board.

  `useInbox` derives a team's issue notifications from its runs, and the auto
  hunt sessions reconcile their worker dispatches against the same runs. Both
  were `App`'s, which is why every polling tick that changed one run re-rendered
  the entire tree on its way to the inbox.

  They live here instead, in a component that renders nothing: the board
  subscription is this component's, the inbox result is published to
  `state/inbox`, and the shells subscribe to what they actually read. `App`
  itself now subscribes to no run.

  What still arrives as props is `useAutoHuntSessions`'s, which is not atom
  state yet and whose owner is `App`.
*/

export interface InboxBridgeProps {
  /** Agent sessions, whose completions become inbox messages. */
  readonly sessions: AutoHuntSession[];
  /** Re-points in-flight worker dispatches at the runs that are on the board. */
  readonly reconcileWorkerDispatches: (
    teamId: string,
    runs: readonly HuntRun[],
  ) => void;
}

export function InboxBridge({
  reconcileWorkerDispatches,
  sessions,
}: InboxBridgeProps) {
  const registry = useRegistry();
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const teams = useAtomValue(teamsAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const dashboard = useAtomValue(activeDashboardAtom);
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

  useEffect(() => {
    if (!dashboard) return;
    reconcileWorkerDispatches(dashboard.team.id, dashboard.runs);
  }, [dashboard, reconcileWorkerDispatches]);

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
    dashboard,
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
