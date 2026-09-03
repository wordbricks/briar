import { useAtom } from "@effect/atom-react";
import { lazy, Suspense } from "react";

import { useI18n } from "../../i18n";
import { appKeyboardShortcutSpecs } from "../../lib/app-keyboard-shortcuts";
import { formatShortcut, loadKeybindings } from "../../lib/keybindings";
import { useAppKeyboardCommandState } from "../../hooks/appKeyboardCommands";
import { useWorkerDispatch } from "../../hooks/useWorkerDispatch";
import { KeyboardShortcutModeHint } from "../KeyboardShortcutModeHint";
import {
  commandPaletteInitialQueryAtom,
  isCommandPaletteOpenAtom,
} from "../../state/dialogs/atoms";
import { companionMode } from "../../state/platform";
import {
  KeyboardShortcutsDialogWithPreferences,
  PlanningProjectDialogWithPlanning,
} from "./AppDialogViews";
import { CommandPaletteWithContext } from "./CommandPaletteWithContext";
import { TeamOnboardingWithWorkspace } from "./WorkspaceViews";
import { WorkerDispatchDialogWithTeam } from "./TeamViewsWithDashboard";
import type { CommandPaletteItem } from "../CommandPalette";

/*
  Everything that floats above the shell, in one place.

  These eight overlays were the tail of `App.tsx` and, because the companion
  branch returned before that tail, only one of them ever reached a phone —
  the dispatch dialog, rendered a second time inside the companion tree. That
  is the split this component keeps: the same single mount serves both shells,
  and `companionMode` decides which overlays a phone actually gets.

  Each overlay's `lazy()` boundary lives in the wrapper that renders it, so the
  chunk layout is unchanged; the two declared here are the two that had no
  wrapper of their own.
*/

const FirstRunTutorial = lazy(() =>
  import("../FirstRunTutorial").then((m) => ({
    default: m.FirstRunTutorial,
  })),
);
const LaunchIntro = lazy(() =>
  import("../LaunchIntro").then((m) => ({ default: m.LaunchIntro })),
);

/** The team creation flow, whose steps the invitation progress can require. */
export interface TeamOnboardingDialogState {
  readonly includeDeveloperTools: boolean;
  readonly requireDeveloperAgent: boolean;
  readonly startWithDeveloperTools: boolean;
  readonly onCancel: () => void;
  readonly onFinish: () => void;
}

/** The first-run tour, which a joined collaborator gets a shorter version of. */
export interface FirstRunTutorialState {
  readonly open: boolean;
  readonly collaborator: boolean;
  readonly onCollaboratorComplete: () => void;
  readonly onDeveloperSelect: () => void;
}

export interface LaunchIntroState {
  readonly visible: boolean;
  readonly preview: boolean;
  readonly onComplete: () => void;
}

export interface AppDialogsProps {
  /** False while a gate owns the screen, exactly as the shell decided before. */
  readonly commandPaletteAvailable: boolean;
  readonly commandPaletteItems: CommandPaletteItem[];
  readonly teamOnboarding: TeamOnboardingDialogState;
  readonly firstRunTutorial: FirstRunTutorialState;
  readonly launchIntro: LaunchIntroState;
}

export function AppDialogs({
  commandPaletteAvailable,
  commandPaletteItems,
  firstRunTutorial,
  launchIntro,
  teamOnboarding,
}: AppDialogsProps) {
  const { t } = useI18n();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useAtom(
    isCommandPaletteOpenAtom,
  );
  const [initialQuery, setInitialQuery] = useAtom(
    commandPaletteInitialQueryAtom,
  );
  const { submitWorkerDispatch } = useWorkerDispatch();
  const keyboardCommandState = useAppKeyboardCommandState();
  const pendingShortcut = keyboardCommandState.pending;

  const dispatchDialog = (
    <Suspense fallback={null}>
      <WorkerDispatchDialogWithTeam
        onSubmit={(input) => void submitWorkerDispatch(input)}
      />
    </Suspense>
  );

  // The companion shell showed only this one, and it is the same mount now.
  if (companionMode) return dispatchDialog;

  const configuredKeybindings = loadKeybindings();
  const pendingShortcutSpec = pendingShortcut
    ? appKeyboardShortcutSpecs.find(
        ({ id }) => id === pendingShortcut.candidateIds[0],
      )
    : undefined;
  const pendingShortcutPrefix = pendingShortcut
    ? pendingShortcutSpec?.sequence.slice(0, pendingShortcut.sequence.length) ??
      pendingShortcut.sequence
    : [];
  const pendingShortcutChoices = pendingShortcut
    ? pendingShortcut.candidateIds.flatMap((id) => {
        const shortcut = appKeyboardShortcutSpecs.find(
          (candidate) => candidate.id === id,
        );
        const key = shortcut?.sequence[pendingShortcut.sequence.length];
        return shortcut && key
          ? [{ id, key: key.toUpperCase(), label: t(shortcut.labelKey) }]
          : [];
      })
    : [];

  return (
    <Suspense fallback={null}>
      <PlanningProjectDialogWithPlanning />
      {commandPaletteAvailable && isCommandPaletteOpen ? (
        <CommandPaletteWithContext
          initialQuery={initialQuery}
          items={commandPaletteItems}
          onOpenChange={(open) => {
            setIsCommandPaletteOpen(open);
            if (!open) setInitialQuery("");
          }}
          open={isCommandPaletteOpen}
          shortcutLabel={formatShortcut(configuredKeybindings.commandPalette)}
        />
      ) : null}
      <KeyboardShortcutsDialogWithPreferences
        available={commandPaletteAvailable}
      />
      {pendingShortcut ? (
        <KeyboardShortcutModeHint
          choices={pendingShortcutChoices}
          label={t(
            pendingShortcutPrefix[0] === "g"
              ? "keyboardShortcuts.section.go"
              : "keyboardShortcuts.section.open",
          )}
          prefix={pendingShortcutPrefix.join(" ").toUpperCase()}
        />
      ) : null}
      <TeamOnboardingWithWorkspace
        includeDeveloperTools={teamOnboarding.includeDeveloperTools}
        onCancel={teamOnboarding.onCancel}
        onFinish={teamOnboarding.onFinish}
        requireDeveloperAgent={teamOnboarding.requireDeveloperAgent}
        startWithDeveloperTools={teamOnboarding.startWithDeveloperTools}
      />
      <WorkerDispatchDialogWithTeam
        onSubmit={(input) => void submitWorkerDispatch(input)}
      />
      <FirstRunTutorial
        initialPhase={
          firstRunTutorial.collaborator ? "collaborator-demo" : "purpose"
        }
        onCollaboratorComplete={firstRunTutorial.onCollaboratorComplete}
        onDeveloperSelect={firstRunTutorial.onDeveloperSelect}
        open={firstRunTutorial.open}
      />
      {launchIntro.visible ? (
        <LaunchIntro
          onComplete={launchIntro.onComplete}
          preview={launchIntro.preview}
        />
      ) : null}
    </Suspense>
  );
}
