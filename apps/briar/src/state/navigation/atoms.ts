import * as Atom from "effect/unstable/reactivity/Atom";

import type { CompanionStatusFilter } from "../../components/CompanionBottomNavigation";
import type { UnifiedSettingsTarget } from "../../components/UnifiedSettingsSidebar";
import type { InboxNotificationTarget } from "../../generated/tauri";
import {
  channelIdFromNavigationLocation,
  organizationIdFromNavigationLocation,
  pageFromNavigationLocation,
  projectIdFromNavigationLocation,
  runIdFromNavigationLocation,
  settingsTargetFromNavigationLocation,
  type AppNavigationLocation,
} from "../../lib/app-navigation";
import type { IssueDetailTab } from "../../lib/issue-detail-tab";
import { parseWebAppIssuePath, type BriarLinkTarget } from "../../lib/issue-links";
import { activeChannelIdAtom } from "../channels/atoms";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { shallowArrayEqual } from "../entities/upsert";
import { webMode } from "../platform";
import { userAtom } from "../session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { createNavigationHistory } from "./history";

/*
  Where the app is, and what it was asked to show next.

  The bottom half of this file is the navigation location itself: one atom
  holding the visit stack, and a derived atom for every question the shell used
  to answer out of it. The top half is the "please show me this next" state
  around it — a deep link waiting for the session to settle, a run a
  notification asked for, the tab the companion shell is on. Each of those is
  produced in one place and consumed in another, which is exactly what made them
  shell `useState`s and what makes them atoms now.
*/

/** The run a link, a notification or a list asked to open. */
export const requestedRunIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("navigation/requestedRunId"),
);

/** A conversation message inside that run to scroll to. */
export const requestedRunMessageIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("navigation/requestedRunMessageId"),
);

/** The detail tab that run should open on. */
export const requestedRunInitialTabAtom = Atom.make<IssueDetailTab | null>(
  null,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/requestedRunInitialTab"));

/** The agent session a link or a list asked to open. */
export const requestedSessionIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("navigation/requestedSessionId"),
);

/*
  Two counters that mean "show the list, even if it is already the page".

  Bumping them is how the sidebar, the palette and the keyboard shortcuts ask a
  list view to reset its own selection without the shell reaching into it.
*/
export const issueListRequestKeyAtom = Atom.make(0).pipe(
  Atom.keepAlive,
  Atom.withLabel("navigation/issueListRequestKey"),
);

export const agentListRequestKeyAtom = Atom.make(0).pipe(
  Atom.keepAlive,
  Atom.withLabel("navigation/agentListRequestKey"),
);

/** Which settings screen the settings page shows. */
export const settingsTargetAtom = Atom.make<UnifiedSettingsTarget>({
  scope: "application",
  section: "source-control",
}).pipe(Atom.keepAlive, Atom.withLabel("navigation/settingsTarget"));

/** The companion shell's tab, and the status filter of its issue list. */
export const companionPageAtom = Atom.make<
  "issues" | "dms" | "home" | "inbox" | "lobby" | "settings"
>("issues").pipe(Atom.keepAlive, Atom.withLabel("navigation/companionPage"));

export const companionStatusAtom = Atom.make<CompanionStatusFilter>("all").pipe(
  Atom.keepAlive,
  Atom.withLabel("navigation/companionStatus"),
);

/**
 * The deep link waiting to be resolved. The web app starts with whatever its
 * own path pointed at, which is a window scoped fact and therefore the atom's
 * initial value rather than something the shell seeds.
 */
export const pendingBriarLinkAtom = Atom.make<BriarLinkTarget | null>(
  initialWebAppLink(),
).pipe(Atom.keepAlive, Atom.withLabel("navigation/pendingBriarLink"));

function initialWebAppLink(): BriarLinkTarget | null {
  if (!webMode || typeof window === "undefined") return null;
  const target = parseWebAppIssuePath(window.location.pathname);
  return target ? { kind: "issue", ...target } : null;
}

/** The inbox notification the user clicked, waiting for the session to settle. */
export const pendingInboxNotificationTargetAtom =
  Atom.make<InboxNotificationTarget | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("navigation/pendingInboxNotificationTarget"),
  );

/*
  Where the app is.

  The visit stack was a `useReducer` inside `useNavigationHistory`, read through
  the app shell and pushed back down as a dozen props. It is one atom now, and
  every question the views used to ask the shell — which page, which run, which
  team the location names — is a derived atom over it. A view that cares about
  the page subscribes to the page, not to the shell that owns the stack.
*/

/** The visit stack and the position in it. */
export const navigationHistoryAtom = Atom.make(
  createNavigationHistory<AppNavigationLocation>("lobby"),
).pipe(Atom.keepAlive, Atom.withLabel("navigation/history"));

/** The location on screen. */
export const navigationLocationAtom = Atom.map(
  navigationHistoryAtom,
  (history): AppNavigationLocation => history.entries[history.index] ?? "lobby",
).pipe(Atom.keepAlive, Atom.withLabel("navigation/location"));

/** Every visited location, oldest first, for the history popover. */
export const navigationHistoryEntriesAtom = Atom.map(
  navigationHistoryAtom,
  (history): readonly AppNavigationLocation[] => history.entries,
).pipe(
  Atom.keepAlive,
  Atom.withEquality<readonly AppNavigationLocation[]>(shallowArrayEqual),
  Atom.withLabel("navigation/historyEntries"),
);

/** What the history popover prints for an issue it visited. */
export interface NavigationHistoryRunLabel {
  readonly runNumber: number;
  readonly title: string;
}

const sameRunLabels = (
  left: ReadonlyMap<string, NavigationHistoryRunLabel>,
  right: ReadonlyMap<string, NavigationHistoryRunLabel>,
) =>
  left === right ||
  (left.size === right.size &&
    [...left].every(([runId, label]) => {
      const other = right.get(runId);
      return (
        other !== undefined &&
        other.runNumber === label.runNumber &&
        other.title === label.title
      );
    }));

/**
 * The issue key and title of every run the visit stack points at, for the rows
 * the window's history popover draws.
 *
 * The popover is the only thing above the page that reads a run at all, and it
 * reads two fields of the handful of runs it has actually visited. Resolving
 * them here — against the board on screen, which is where the labels came from
 * before — means an edit to any other run, or to any other field, produces an
 * equal map and wakes nobody.
 */
export const navigationHistoryRunLabelsAtom = Atom.make(
  (get): ReadonlyMap<string, NavigationHistoryRunLabel> => {
    const labels = new Map<string, NavigationHistoryRunLabel>();
    const teamId = get(activeTeamIdAtom);
    if (teamId === null) return labels;
    const runIds = get(teamRunIdsAtom(teamId));
    if (!runIds) return labels;
    const runs = get(runsByIdAtom);
    for (const location of get(navigationHistoryEntriesAtom)) {
      if (projectIdFromNavigationLocation(location) !== teamId) continue;
      const runId = runIdFromNavigationLocation(location);
      if (!runId || labels.has(runId) || !runIds.includes(runId)) continue;
      const run = runs.get(runId);
      if (run) labels.set(runId, { runNumber: run.runNumber, title: run.title });
    }
    return labels;
  },
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameRunLabels),
  Atom.withLabel("navigation/historyRunLabels"),
);

/** Where the location on screen sits in {@link navigationHistoryEntriesAtom}. */
export const navigationHistoryIndexAtom = Atom.map(
  navigationHistoryAtom,
  (history) => history.index,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/historyIndex"));

export const canGoBackAtom = Atom.map(
  navigationHistoryAtom,
  (history) => history.index > 0,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/canGoBack"));

export const canGoForwardAtom = Atom.map(
  navigationHistoryAtom,
  (history) => history.index < history.entries.length - 1,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/canGoForward"));

/** The page the location resolves to, which is what every view branches on. */
export const activePageAtom = Atom.map(
  navigationLocationAtom,
  pageFromNavigationLocation,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/activePage"));

/** The run the location names, on an issue location. */
export const activeRunIdAtom = Atom.map(
  navigationLocationAtom,
  runIdFromNavigationLocation,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/activeRunId"));

/**
 * The team the location names, which may differ from the selected one while
 * the reconciliation catches up.
 */
export const navigationTeamIdAtom = Atom.map(
  navigationLocationAtom,
  projectIdFromNavigationLocation,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/teamId"));

/** The organization the location names. */
export const navigationOrganizationIdAtom = Atom.map(
  navigationLocationAtom,
  organizationIdFromNavigationLocation,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/organizationId"));

/** The channel the location names, on a channel location. */
export const navigationChannelIdAtom = Atom.map(
  navigationLocationAtom,
  channelIdFromNavigationLocation,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/channelId"));

/** The settings screen the location names, on a settings location. */
export const navigationSettingsTargetAtom = Atom.map(
  navigationLocationAtom,
  settingsTargetFromNavigationLocation,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/locationSettingsTarget"));

/**
 * The location is a channel page carrying an organization, which is what makes
 * the location — rather than the selection — the source of the open channel on
 * the desktop.
 */
const navigationHasChannelPageContextAtom = Atom.make((get) => {
  const page = get(activePageAtom);
  return (
    (page === "channels" || page === "dms") &&
    get(navigationOrganizationIdAtom) !== null
  );
}).pipe(Atom.keepAlive, Atom.withLabel("navigation/hasChannelPageContext"));

/** The channel the desktop is looking at, resolved from the location. */
export const desktopActiveChannelIdAtom = Atom.make((get) =>
  get(navigationHasChannelPageContextAtom)
    ? get(navigationChannelIdAtom)
    : get(activeChannelIdAtom),
).pipe(Atom.keepAlive, Atom.withLabel("navigation/desktopActiveChannelId"));

/**
 * The team whose tabs the page chain shows: the one the location names, and
 * otherwise the selected one.
 */
export const activeTeamForTabsAtom = Atom.make((get) => {
  const teamId = get(navigationTeamIdAtom) ?? get(activeTeamIdAtom);
  return get(teamsAtom).find((team) => team.id === teamId);
}).pipe(Atom.keepAlive, Atom.withLabel("navigation/activeTeamForTabs"));

/*
  Which account the visit stack belongs to.

  This was a ref the shell assigned during its own render: `undefined` until the
  first effect ran, then the signed-in id, and a mismatch meant "a different
  account just took over, reconcile nothing this render". The reconciliation
  reads it from here now, and so does everything else that has to hold still for
  that one render.
*/
export const navigationHistoryUserIdAtom = Atom.make<string | null | undefined>(
  undefined,
).pipe(Atom.keepAlive, Atom.withLabel("navigation/historyUserId"));

/** True on the render a different account took over the history. */
export const navigationUserBoundaryChangedAtom = Atom.make((get) => {
  const owner = get(navigationHistoryUserIdAtom);
  return owner !== undefined && owner !== (get(userAtom)?.id ?? null);
}).pipe(Atom.keepAlive, Atom.withLabel("navigation/userBoundaryChanged"));
