import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useRef } from "react";

import { useI18n } from "../../i18n";
import type { InboxNotificationTarget } from "../../generated/tauri";
import { syncAppBadgeCount } from "../../lib/app-badge";
import {
  androidPushRegistrationEvents,
  inboxNotificationLabelKey,
  listenForInboxNotificationClicks,
  readInboxNotificationPreferences,
  sendInboxNotification,
  synchronizeAndroidPushRegistration,
} from "../../lib/inbox-notifications";
import {
  viewingChannelIdAtom,
  viewingChannelThreadRootMessageIdAtom,
  viewingIssueConversationRunIdAtom,
} from "../channels/atoms";
import { pendingInboxNotificationTargetAtom } from "../navigation/atoms";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  inboxInitialSyncCompleteAtom,
  inboxMessagesAtom,
  inboxNotificationBaselineIdAtom,
  inboxUnreadCountAtom,
  inboxUserIdAtom,
} from "./atoms";
import {
  classifyInboxMessage,
  findChangedInboxMessages,
  inboxNotificationIdentity,
  shouldSuppressInboxNotification,
  type InboxMessageWithReadState,
} from "./model";

/*
  What the inbox does outside the window: raise a system notification for a
  message that changed, keep the launcher badge in step, and hand a clicked
  notification back to navigation.

  All three subscribe through the registry rather than rendering, because none
  of them draws anything — `AppEffects` mounts this hook and must not commit
  because a message arrived. That is the same reason the dispatch reconciliation
  moved to a subscription: a callback-only consumer needs no render.

  A project window is deliberately silent. It is pinned to one team, so its
  alerts would duplicate the main window's and its badge would disagree with it.
*/

type NotificationBaseline = {
  userId: string;
  organizationId: string;
  baselineId: string;
  versions: Record<string, string>;
};

/**
 * Everything a notification pass reads. One atom so the subscription wakes for
 * the same reasons the effect this replaced re-ran.
 */
const inboxNotificationInputsAtom = Atom.make((get) => ({
  baselineId: get(inboxNotificationBaselineIdAtom),
  initialSyncComplete: get(inboxInitialSyncCompleteAtom),
  messages: get(inboxMessagesAtom),
  organizationId: get(activeOrganizationIdAtom),
  userId: get(inboxUserIdAtom),
  viewingChannelId: get(viewingChannelIdAtom),
  viewingChannelThreadRootMessageId: get(
    viewingChannelThreadRootMessageIdAtom,
  ),
  viewingIssueConversationRunId: get(viewingIssueConversationRunIdAtom),
})).pipe(Atom.keepAlive, Atom.withLabel("inbox/notificationInputs"));

const appIsFocused = () =>
  typeof document !== "undefined" &&
  document.visibilityState === "visible" &&
  document.hasFocus();

export interface InboxNotificationDeps {
  /** The alert sender, so a test can watch what would have been raised. */
  readonly send?: typeof sendInboxNotification | undefined;
  /** The launcher badge writer. */
  readonly syncBadge?: typeof syncAppBadgeCount | undefined;
  /** The native click listener. */
  readonly listenForClicks?: typeof listenForInboxNotificationClicks | undefined;
  /** The Android push registration synchronizer. */
  readonly synchronizePushRegistration?:
    | typeof synchronizeAndroidPushRegistration
    | undefined;
}

export function useInboxNotifications(
  deps: InboxNotificationDeps = {},
): void {
  const registry = useRegistry();
  const { t } = useI18n();
  const token = useAtomValue(tokenAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const translate = useRef(t);
  translate.current = t;
  const send = deps.send ?? sendInboxNotification;
  const syncBadge = deps.syncBadge ?? syncAppBadgeCount;
  const listenForClicks = deps.listenForClicks ?? listenForInboxNotificationClicks;
  const synchronizePushRegistration =
    deps.synchronizePushRegistration ?? synchronizeAndroidPushRegistration;

  useEffect(() => {
    if (!token) return;
    const synchronize = () => {
      void synchronizePushRegistration(token).catch((error) => {
        console.error("Failed to synchronize Android push registration", error);
      });
    };
    const synchronizeWhenVisible = () => {
      if (document.visibilityState === "visible") synchronize();
    };
    synchronize();
    window.addEventListener(
      androidPushRegistrationEvents.preferencesChanged,
      synchronize,
    );
    window.addEventListener(
      androidPushRegistrationEvents.tokenChanged,
      synchronize,
    );
    window.addEventListener("online", synchronize);
    document.addEventListener("visibilitychange", synchronizeWhenVisible);
    return () => {
      window.removeEventListener(
        androidPushRegistrationEvents.preferencesChanged,
        synchronize,
      );
      window.removeEventListener(
        androidPushRegistrationEvents.tokenChanged,
        synchronize,
      );
      window.removeEventListener("online", synchronize);
      document.removeEventListener("visibilitychange", synchronizeWhenVisible);
    };
  }, [synchronizePushRegistration, token]);

  useEffect(() => {
    let baseline: NotificationBaseline | null = null;
    const evaluate = () => {
      const {
        baselineId,
        initialSyncComplete,
        messages,
        organizationId,
        userId: accountId,
        viewingChannelId,
        viewingChannelThreadRootMessageId,
        viewingIssueConversationRunId,
      } = registry.get(inboxNotificationInputsAtom);
      const userId = lockedTeamId ? null : accountId;
      if (!userId || !organizationId || !initialSyncComplete) {
        baseline = null;
        return;
      }

      const versions = Object.fromEntries(
        messages.map((message: InboxMessageWithReadState) => [
          inboxNotificationIdentity(message),
          message.version,
        ]),
      );
      if (
        !baseline ||
        baseline.userId !== userId ||
        baseline.organizationId !== organizationId ||
        baseline.baselineId !== baselineId
      ) {
        baseline = { userId, organizationId, baselineId, versions };
        return;
      }

      const changedMessages = findChangedInboxMessages(
        baseline.versions,
        messages,
      );
      baseline = { userId, organizationId, baselineId, versions };
      if (changedMessages.length === 0) return;

      const preferences = readInboxNotificationPreferences();
      for (const message of changedMessages) {
        if (
          shouldSuppressInboxNotification(
            message,
            viewingChannelId,
            viewingChannelThreadRootMessageId,
            viewingIssueConversationRunId,
            appIsFocused(),
          )
        ) continue;
        const category = classifyInboxMessage(message);
        if (!preferences[category]) continue;
        void send(
          message,
          translate.current(inboxNotificationLabelKey(message, category)),
        ).catch((error) => {
          console.error("Failed to send inbox notification", error);
        });
      }
    };

    return registry.subscribe(inboxNotificationInputsAtom, evaluate, {
      immediate: true,
    });
  }, [lockedTeamId, registry, send]);

  useEffect(() => {
    if (lockedTeamId) return;
    return registry.subscribe(
      inboxUnreadCountAtom,
      (count) => {
        void syncBadge(count).catch(() => {
          // An unsupported desktop environment or Android launcher must not
          // block the app.
        });
      },
      { immediate: true },
    );
  }, [lockedTeamId, registry, syncBadge]);

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void | Promise<void>) | null = null;

    void listenForClicks((target: InboxNotificationTarget) => {
      // A project window has no inbox of its own to open a notification into.
      if (lockedTeamId) return;
      registry.set(pendingInboxNotificationTargetAtom, target);
    })
      .then((stop) => {
        if (disposed) void stop();
        else stopListening = stop;
      })
      .catch((error) => {
        console.error("Failed to listen for inbox notification clicks", error);
      });

    return () => {
      disposed = true;
      void stopListening?.();
    };
  }, [listenForClicks, lockedTeamId, registry]);
}
