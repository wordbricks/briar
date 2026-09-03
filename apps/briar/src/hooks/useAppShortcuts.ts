import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import type { ActivePage } from "../lib/app-navigation";
import type { AppKeyboardShortcutCommandId } from "../lib/app-keyboard-shortcuts";
import type { AppZoomCommands } from "../lib/app-zoom";
import { subscribeKeyboardNavigationPreferences } from "../lib/keybindings";
import { hasOpenKeyboardShortcutOverlay } from "../lib/keyboard-shortcuts";
import { isTeamScheduleTabEnabled } from "../lib/team-tabs";
import {
  createIssueTeamIdAtom,
  isCommandPaletteOpenAtom,
  isIssueDialogOpenAtom,
  isKeyboardShortcutsOpenAtom,
  isNavigationHistoryOpenAtom,
  isSidebarOpenAtom,
  sequenceShortcutsEnabledAtom,
} from "../state/dialogs/atoms";
import {
  agentListRequestKeyAtom,
  issueListRequestKeyAtom,
  requestedRunIdAtom,
  requestedSessionIdAtom,
} from "../state/navigation/atoms";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import {
  activeOrganizationTeamsAtom,
  activeTeamAtom,
} from "../state/team/atoms";
import { useAppKeyboardCommandScope } from "./appKeyboardCommands";

/*
  The application wide keyboard scope.

  Every binding here either navigates, opens an overlay or toggles the sidebar,
  which is why it was written inline next to the state it moves. The state is
  atoms now, so the scope reads and writes it directly and the shell hands over
  only the navigation it owns and the zoom commands the window supplies.

  The two effects that came with it belong to the same contract: the stored
  sequence-shortcut preference, and closing both overlays the moment a gate
  (login, onboarding, the launch intro) takes the screen.
*/

export interface UseAppShortcutsInput {
  readonly activePage: ActivePage;
  /** False while a gate owns the screen: nothing here may fire. */
  readonly commandPaletteAvailable: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly goBack: () => void;
  readonly goForward: () => void;
  readonly navigateToPage: (page: ActivePage, teamId?: string | null) => void;
  readonly openAppSettings: () => void;
  /** Opens the palette, optionally pre-filled with a scope prefix. */
  readonly openCommandPalette: (initialQuery?: string) => void;
  readonly closeCommandPalette: () => void;
  readonly appZoomCommands: AppZoomCommands | null;
}

export function useAppShortcuts({
  activePage,
  commandPaletteAvailable,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  navigateToPage,
  openAppSettings,
  openCommandPalette,
  closeCommandPalette,
  appZoomCommands,
}: UseAppShortcutsInput): void {
  const activeTeam = useAtomValue(activeTeamAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const activeOrganizationTeams = useAtomValue(activeOrganizationTeamsAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const sequenceShortcutsEnabled = useAtomValue(sequenceShortcutsEnabledAtom);
  const setSequenceShortcutsEnabled = useAtomSet(sequenceShortcutsEnabledAtom);
  const [isCommandPaletteOpen] = useAtom(isCommandPaletteOpenAtom);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useAtom(
    isKeyboardShortcutsOpenAtom,
  );
  const [isNavigationHistoryOpen, setIsNavigationHistoryOpen] = useAtom(
    isNavigationHistoryOpenAtom,
  );
  const setIsSidebarOpen = useAtomSet(isSidebarOpenAtom);
  const setIsIssueDialogOpen = useAtomSet(isIssueDialogOpenAtom);
  const setCreateIssueProjectId = useAtomSet(createIssueTeamIdAtom);
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);
  const setIssueListRequestKey = useAtomSet(issueListRequestKeyAtom);
  const setAgentListRequestKey = useAtomSet(agentListRequestKeyAtom);

  useEffect(
    () => subscribeKeyboardNavigationPreferences((preferences) => {
      setSequenceShortcutsEnabled(preferences.sequenceShortcutsEnabled);
    }),
    [setSequenceShortcutsEnabled],
  );

  useEffect(() => {
    if (commandPaletteAvailable) return;
    closeCommandPalette();
    setIsKeyboardShortcutsOpen(false);
  }, [closeCommandPalette, commandPaletteAvailable, setIsKeyboardShortcutsOpen]);

  const keyboardShortcutTriggers = {
    createIssue: () => {
      if (!activeTeam) return;
      setCreateIssueProjectId(activeTeam.id);
      navigateToPage("issues");
      setIsIssueDialogOpen(true);
    },
    goAgents: () => {
      setRequestedSessionId(null);
      setAgentListRequestKey((key) => key + 1);
      navigateToPage("agents");
    },
    goChannels: () => navigateToPage("channels"),
    goDms: () => navigateToPage("dms"),
    goInbox: () => navigateToPage("inbox"),
    goIssues: () => {
      setRequestedRunId(null);
      setIssueListRequestKey((key) => key + 1);
      navigateToPage("issues");
    },
    goProjectHome: () => navigateToPage("lobby"),
    goSchedule: () => navigateToPage("schedule"),
    goSettings: openAppSettings,
    openChannel: () => openCommandPalette("c:"),
    openCommandPalette: () => openCommandPalette(),
    openDm: () => openCommandPalette("d:"),
    openIssue: () => openCommandPalette("i:"),
    openProject: () => openCommandPalette("p:"),
    openSession: () => openCommandPalette("s:"),
    showKeyboardShortcuts: () => setIsKeyboardShortcutsOpen(true),
    toggleSidebar: () => setIsSidebarOpen((open) => !open),
  } satisfies Record<AppKeyboardShortcutCommandId, () => void>;
  const keyboardShortcutDisabled = {
    createIssue: !activeTeam,
    goAgents: !activeTeam,
    goChannels: !activeOrganizationId,
    goDms: !activeOrganizationId || Boolean(lockedTeamId),
    goInbox: !activeOrganizationId,
    goIssues: !activeTeam,
    goProjectHome: !activeTeam,
    goSchedule: !activeTeam || !isTeamScheduleTabEnabled(activeTeam),
    goSettings: false,
    openChannel: !activeOrganizationId,
    openCommandPalette: false,
    openDm: !activeOrganizationId || Boolean(lockedTeamId),
    openIssue: !activeTeam,
    openProject: activeOrganizationTeams.length === 0,
    openSession: !activeTeam,
    showKeyboardShortcuts: false,
    toggleSidebar: false,
  } satisfies Record<AppKeyboardShortcutCommandId, boolean>;
  const sequenceShortcutShellAvailable =
    commandPaletteAvailable &&
    sequenceShortcutsEnabled &&
    !isCommandPaletteOpen &&
    !isKeyboardShortcutsOpen;
  const sequenceCommandAvailable = (id: AppKeyboardShortcutCommandId) =>
    sequenceShortcutShellAvailable &&
    !keyboardShortcutDisabled[id] &&
    !hasOpenKeyboardShortcutOverlay(document);
  const sequenceHandler = (id: AppKeyboardShortcutCommandId) => ({
    isAvailable: () => sequenceCommandAvailable(id),
    run: () => {
      keyboardShortcutTriggers[id]();
      return "handled" as const;
    },
  });
  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      createIssue: sequenceHandler("createIssue"),
      goAgents: sequenceHandler("goAgents"),
      goChannels: sequenceHandler("goChannels"),
      goDms: sequenceHandler("goDms"),
      goInbox: sequenceHandler("goInbox"),
      goIssues: sequenceHandler("goIssues"),
      goProjectHome: sequenceHandler("goProjectHome"),
      goSchedule: sequenceHandler("goSchedule"),
      goSettings: sequenceHandler("goSettings"),
      historyBack: {
        isAvailable: () => commandPaletteAvailable,
        run: () => {
          if (canGoBack) goBack();
          return "consume";
        },
      },
      historyForward: {
        isAvailable: () => commandPaletteAvailable,
        run: () => {
          if (canGoForward) goForward();
          return "consume";
        },
      },
      openNavigationHistory: {
        isAvailable: () =>
          commandPaletteAvailable &&
          (isNavigationHistoryOpen || !hasOpenKeyboardShortcutOverlay(document)),
        run: () => {
          setIsNavigationHistoryOpen((open) => !open);
          return "handled";
        },
      },
      openChannel: sequenceHandler("openChannel"),
      openCommandPalette: {
        run: ({ input }) => {
          const configured = Boolean(
            input.altKey ||
              input.controlKey ||
              input.ctrlKey ||
              input.metaKey,
          );
          if (!configured && !sequenceCommandAvailable("openCommandPalette")) {
            return "pass";
          }
          const anotherDialogOpen = !isCommandPaletteOpen &&
            hasOpenKeyboardShortcutOverlay(document);
          if (!commandPaletteAvailable || anotherDialogOpen) {
            return configured ? "consume" : "pass";
          }
          if (isCommandPaletteOpen) closeCommandPalette();
          else openCommandPalette();
          return "handled";
        },
      },
      openDm: sequenceHandler("openDm"),
      openIssue: sequenceHandler("openIssue"),
      openProject: sequenceHandler("openProject"),
      openSession: sequenceHandler("openSession"),
      openSettings: {
        isAvailable: () => commandPaletteAvailable,
        run: () => {
          openAppSettings();
          return "handled";
        },
      },
      showKeyboardShortcuts: {
        run: ({ input }) => {
          const primaryModifier =
            Boolean(input.metaKey) !==
              Boolean(input.controlKey || input.ctrlKey) &&
            Boolean(input.metaKey || input.controlKey || input.ctrlKey) &&
            !input.altKey &&
            !input.shiftKey;
          if (!primaryModifier) {
            if (!sequenceCommandAvailable("showKeyboardShortcuts")) {
              return "pass";
            }
            setIsKeyboardShortcutsOpen(true);
            return "handled";
          }
          const anotherDialogOpen = !isKeyboardShortcutsOpen &&
            hasOpenKeyboardShortcutOverlay(document);
          if (!commandPaletteAvailable || anotherDialogOpen) return "pass";
          setIsKeyboardShortcutsOpen((open) => !open);
          return "handled";
        },
      },
      toggleSidebar: {
        run: ({ input }) => {
          const configured = Boolean(
            input.altKey ||
              input.controlKey ||
              input.ctrlKey ||
              input.metaKey,
          );
          if (!configured && !sequenceCommandAvailable("toggleSidebar")) {
            return "pass";
          }
          if (hasOpenKeyboardShortcutOverlay(document)) {
            return configured ? "consume" : "pass";
          }
          setIsSidebarOpen((open) => !open);
          return "handled";
        },
      },
      ...(appZoomCommands
        ? {
            zoomIn: {
              run: () => {
                appZoomCommands.zoomIn();
                return "handled" as const;
              },
            },
            zoomOut: {
              run: () => {
                appZoomCommands.zoomOut();
                return "handled" as const;
              },
            },
          }
        : {}),
    },
    id: "app-global",
    priority: 0,
  });
}
