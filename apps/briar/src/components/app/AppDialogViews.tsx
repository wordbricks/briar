import { useAtom, useAtomValue, useAtomSet } from "@effect/atom-react";
import { lazy } from "react";

import { useI18n } from "../../i18n";
import { createKeyboardShortcutHelpSections } from "../../lib/app-keyboard-shortcuts";
import { formatShortcut, isMacPlatform, loadKeybindings } from "../../lib/keybindings";
import {
  activePlanningProjectIdAtom,
  isKeyboardShortcutsOpenAtom,
  planningProjectEditIdAtom,
  planningProjectTeamIdAtom,
  sequenceShortcutsEnabledAtom,
} from "../../state/dialogs/atoms";
import { usePlanningActions } from "../../state/planning/actions";
import { planningProjectsAtom } from "../../state/planning/atoms";
import { teamsAtom } from "../../state/team/atoms";

/*
  Two overlays that read only their own state.

  The planning project dialog took five props the shell assembled out of the
  two ids that decide why it is open plus the planning project and team lists.
  The shortcut cheat sheet took the sections the shell built out of the stored
  keybindings and one preference. Neither needs anything the shell knows, so
  neither is a reason for the shell to re-render.

  Their `lazy()` boundaries move here with them, so the chunk split is unchanged.
*/

const PlanningProjectDialog = lazy(() =>
  import("../PlanningProjectDialog").then((m) => ({
    default: m.PlanningProjectDialog,
  })),
);
const KeyboardShortcutsDialog = lazy(() =>
  import("../KeyboardShortcutsDialog").then((m) => ({
    default: m.KeyboardShortcutsDialog,
  })),
);

/** The modifier the cheat sheet and the palette both label this shortcut with. */
export const keyboardShortcutsModifierLabel = () =>
  isMacPlatform() ? "⌘/" : "Ctrl+/";

/**
 * The create / edit planning project dialog. Open means "one of the two ids is
 * set": a team id creates one inside that team, a planning project id edits
 * that one.
 */
export function PlanningProjectDialogWithPlanning() {
  const [teamId, setTeamId] = useAtom(planningProjectTeamIdAtom);
  const [editId, setEditId] = useAtom(planningProjectEditIdAtom);
  const setActivePlanningProjectId = useAtomSet(activePlanningProjectIdAtom);
  const planningProjects = useAtomValue(planningProjectsAtom);
  const teams = useAtomValue(teamsAtom);
  const { addPlanningProject, editPlanningProject, removePlanningProject } =
    usePlanningActions();
  const project =
    planningProjects.find((candidate) => candidate.id === editId) ?? null;
  return (
    <PlanningProjectDialog
      onCreate={(input) => {
        if (!teamId) {
          return Promise.reject(new Error("프로젝트를 추가할 팀이 없습니다."));
        }
        return addPlanningProject(teamId, input);
      }}
      onUpdate={editPlanningProject}
      onDelete={async (projectId) => {
        await removePlanningProject(projectId);
        setActivePlanningProjectId((current) =>
          current === projectId ? null : current,
        );
      }}
      onOpenChange={(open) => {
        if (open) return;
        setTeamId(null);
        setEditId(null);
      }}
      open={teamId !== null || editId !== null}
      project={project}
      teamName={
        teams.find((team) => team.id === (teamId ?? project?.teamId))?.name ?? ""
      }
    />
  );
}

/**
 * The keyboard shortcut cheat sheet. `open` is still gated by the shell's
 * "is the palette available at all" check, which depends on the login and
 * onboarding gates the shell owns.
 */
export function KeyboardShortcutsDialogWithPreferences({
  available,
}: {
  /** False while a gate owns the screen, exactly as the shell decided before. */
  readonly available: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useAtom(isKeyboardShortcutsOpenAtom);
  const sequenceShortcutsEnabled = useAtomValue(sequenceShortcutsEnabledAtom);
  const keybindings = loadKeybindings();
  if (!available) return null;
  return (
    <KeyboardShortcutsDialog
      onOpenChange={setOpen}
      open={open}
      sections={createKeyboardShortcutHelpSections({
        commandPaletteShortcut: formatShortcut(keybindings.commandPalette),
        keyboardShortcutsShortcut: keyboardShortcutsModifierLabel(),
        sequenceShortcutsEnabled,
        sidebarShortcut: formatShortcut(keybindings.sidebarToggle),
        t,
      })}
    />
  );
}
