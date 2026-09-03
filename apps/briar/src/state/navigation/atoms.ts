import * as Atom from "effect/unstable/reactivity/Atom";

import type { CompanionStatusFilter } from "../../components/CompanionBottomNavigation";
import type { UnifiedSettingsTarget } from "../../components/UnifiedSettingsSidebar";
import type { InboxNotificationTarget } from "../../generated/tauri";
import type { IssueDetailTab } from "../../lib/issue-detail-tab";
import { parseWebAppIssuePath, type BriarLinkTarget } from "../../lib/issue-links";
import { webMode } from "../platform";

/*
  Requests, not routes.

  The navigation history itself still belongs to `useNavigationHistory` and the
  reconciliation effects in the shell; what lives here is the "please show me
  this next" state around it — a deep link waiting for the session to settle, a
  run a notification asked for, the tab the companion shell is on. Each of them
  is produced in one place and consumed in another, which is exactly what made
  them shell `useState`s and what makes them atoms now.
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
