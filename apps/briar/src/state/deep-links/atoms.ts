import * as Atom from "effect/unstable/reactivity/Atom";

import { listenForAppMenuSettings } from "../../lib/app-menu";
import { listenForClickedIssueLinks } from "../../lib/external-links";
import { listenForBriarLinks } from "../../lib/issue-links";
import { isDesktopTauri, isMacDesktopTauri } from "../../lib/platform";
import { listenForStatusTrayOpenRun } from "../../lib/status-tray";
import { createNavigationActions } from "../navigation/actions";
import { pendingBriarLinkAtom } from "../navigation/atoms";
import { lockedTeamIdAtom } from "../platform";

/*
  The four ways the outside world asks the app to open something.

  Each one is a listener with a matching unsubscribe and no state of its own, so
  each is an atom that registers on first observation and unregisters through
  its finalizer when the last observer goes away. What they do is identical to
  the effects they replace — write a pending target, or open the settings screen
  — but a listener now outlives a re-render and dies with the last reader rather
  than with whichever component happened to hold it.

  The idle TTL is a few seconds so that remounting a view does not tear a native
  listener down and build it back up in the same frame.
*/

/** The listeners themselves, so a test can hand the atoms its own. */
export interface DeepLinkListenerApi {
  readonly listenForBriarLinks: typeof listenForBriarLinks;
  readonly listenForClickedIssueLinks: typeof listenForClickedIssueLinks;
  readonly listenForStatusTrayOpenRun: typeof listenForStatusTrayOpenRun;
  readonly listenForAppMenuSettings: typeof listenForAppMenuSettings;
  /** The tray listener only exists in the packaged macOS app. */
  readonly macDesktop: boolean;
  /** The application menu only exists in a desktop build. */
  readonly desktop: boolean;
}

export const liveDeepLinkListenerApi: DeepLinkListenerApi = {
  listenForBriarLinks,
  listenForClickedIssueLinks,
  listenForStatusTrayOpenRun,
  listenForAppMenuSettings,
  macDesktop: isMacDesktopTauri(),
  desktop: isDesktopTauri(),
};

export const deepLinkListenerApiAtom = Atom.make<DeepLinkListenerApi>(
  liveDeepLinkListenerApi,
).pipe(Atom.keepAlive, Atom.withLabel("deepLinks/api"));

/** How long a listener survives having no observer. */
export const DEEP_LINK_LISTENER_IDLE_TTL_MS = 5_000;

/** A `briar://` link the operating system handed to this window. */
export const briarLinkListenerAtom = Atom.make((get) => {
  const api = get(deepLinkListenerApiAtom);
  const registry = get.registry;
  // A project window is pinned to one team and must not follow a link out of
  // it; the main window picks the link up instead.
  if (get(lockedTeamIdAtom)) return false;
  get.addFinalizer(
    api.listenForBriarLinks((link) =>
      registry.set(pendingBriarLinkAtom, link),
    ),
  );
  return true;
}).pipe(
  Atom.setIdleTTL(DEEP_LINK_LISTENER_IDLE_TTL_MS),
  Atom.withLabel("deepLinks/briarLink"),
);

/** An issue link clicked inside the app's own rendered content. */
export const clickedIssueLinkListenerAtom = Atom.make((get) => {
  const api = get(deepLinkListenerApiAtom);
  const registry = get.registry;
  get.addFinalizer(
    api.listenForClickedIssueLinks((target) =>
      registry.set(pendingBriarLinkAtom, { kind: "issue", ...target }),
    ),
  );
  return true;
}).pipe(
  Atom.setIdleTTL(DEEP_LINK_LISTENER_IDLE_TTL_MS),
  Atom.withLabel("deepLinks/clickedIssueLink"),
);

/** A run opened from the macOS menu bar tray. */
export const statusTrayOpenRunListenerAtom = Atom.make((get) => {
  const api = get(deepLinkListenerApiAtom);
  const registry = get.registry;
  if (!api.macDesktop || get(lockedTeamIdAtom)) return false;
  get.addFinalizer(
    api.listenForStatusTrayOpenRun((payload) =>
      registry.set(pendingBriarLinkAtom, {
        kind: "issue",
        projectId: payload.projectId,
        runId: payload.runId,
      }),
    ),
  );
  return true;
}).pipe(
  Atom.setIdleTTL(DEEP_LINK_LISTENER_IDLE_TTL_MS),
  Atom.withLabel("deepLinks/statusTrayOpenRun"),
);

/** The desktop application menu's "Settings…", the same screen the gear opens. */
export const appMenuSettingsListenerAtom = Atom.make((get) => {
  const api = get(deepLinkListenerApiAtom);
  const registry = get.registry;
  if (!api.desktop) return false;
  const { openAppSettings } = createNavigationActions(registry);
  get.addFinalizer(api.listenForAppMenuSettings(openAppSettings));
  return true;
}).pipe(
  Atom.setIdleTTL(DEEP_LINK_LISTENER_IDLE_TTL_MS),
  Atom.withLabel("deepLinks/appMenuSettings"),
);
