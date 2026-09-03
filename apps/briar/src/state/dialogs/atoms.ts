import * as Atom from "effect/unstable/reactivity/Atom";

import { loadKeyboardNavigationPreferences } from "../../lib/keybindings";
import type { HuntRun } from "../../types";

/*
  What is open on top of the app, and the transient state of the flows that put
  it there.

  None of it is server state and none of it survives a reload; it is here so the
  dialog that shows it and the handler that opens it can reach it without the
  shell holding a `useState` for each one and re-rendering every view whenever
  any of them moves.
*/

/** The create-issue dialog, and the team the issue is created in. */
export const isIssueDialogOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/issueDialogOpen"),
);

export const createIssueTeamIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/createIssueTeamId"),
);

/*
  The planning project dialog. It is open for either of two reasons — creating
  one inside a team, or editing an existing one — so the pair of ids is what
  says which, and `null` in both is what closes it.
*/
export const planningProjectTeamIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/planningProjectTeamId"),
);

export const planningProjectEditIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/planningProjectEditId"),
);

/** The planning project the issue list is filtered to, if any. */
export const activePlanningProjectIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/activePlanningProjectId"),
);

/*
  The worker dispatch flow: which run the dialog is for, whether its dispatch is
  in flight, whether it just succeeded, and the error it reports. They are four
  atoms rather than one union because the dialog reads them independently and
  the success marker outlives the request by one animation.
*/
export const dispatchRunAtom = Atom.make<HuntRun | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/dispatchRun"),
);

export const quickStartingRunIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/quickStartingRunId"),
);

export const completedDispatchRunIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/completedDispatchRunId"),
);

export const quickProcessErrorAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/quickProcessError"),
);

/** The team whose repository setup dialog is open. */
export const repositorySetupTeamIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/repositorySetupTeamId"),
);

/** The sidebar, which starts open and is toggled by a shortcut or the palette. */
export const isSidebarOpenAtom = Atom.make(true).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/sidebarOpen"),
);

/** The command palette, and the query a shortcut pre-filled it with. */
export const isCommandPaletteOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/commandPaletteOpen"),
);

export const commandPaletteInitialQueryAtom = Atom.make("").pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/commandPaletteInitialQuery"),
);

/** The navigation history popover in the window controls. */
export const isNavigationHistoryOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/navigationHistoryOpen"),
);

/** The keyboard shortcut cheat sheet. */
export const isKeyboardShortcutsOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("dialogs/keyboardShortcutsOpen"),
);

/**
 * Whether the two-key sequence shortcuts are enabled. It is a stored preference
 * the shortcut scope subscribes to, and the cheat sheet renders differently
 * depending on it, so it lives here rather than inside either of them.
 */
export const sequenceShortcutsEnabledAtom = Atom.make(
  loadKeyboardNavigationPreferences().sequenceShortcutsEnabled,
).pipe(Atom.keepAlive, Atom.withLabel("dialogs/sequenceShortcutsEnabled"));
