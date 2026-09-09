import * as Atom from "effect/unstable/reactivity/Atom";

import type { Workspace } from "../../types";
import { demoWorkspace, demoSelectionApplies } from "../demo-fixtures";
import { demoMode } from "../platform";

/*
  The workspaces the signed-in account belongs to, and which one the app is
  currently scoped to. Teams, channels and members all hang off the active
  workspace, so this pair is read almost everywhere and written only by the
  workspace actions and the session bootstrap.
*/

/** Every workspace the account is a member of. */
export const workspacesAtom = Atom.make<Workspace[]>(
  demoMode ? [demoWorkspace] : [],
).pipe(Atom.keepAlive, Atom.withLabel("workspace/list"));

/**
 * The workspace the app is scoped to. Demo mode preselects its own, except
 * in a project window pinned to a team that is not the demo team's — which is
 * what {@link demoSelectionApplies} decides.
 */
export const activeWorkspaceIdAtom = Atom.make<string | null>(
  demoSelectionApplies ? demoWorkspace.id : null,
).pipe(Atom.keepAlive, Atom.withLabel("workspace/activeId"));

/**
 * The active workspace resolved against the list. The result is an element
 * of `workspacesAtom`, never a fresh object, so subscribers are notified
 * only when the selected workspace itself changes.
 */
export const activeWorkspaceAtom = Atom.make((get) => {
  const activeWorkspaceId = get(activeWorkspaceIdAtom);
  if (!activeWorkspaceId) return null;
  return (
    get(workspacesAtom).find(
      (workspace) => workspace.id === activeWorkspaceId,
    ) ?? null
  );
}).pipe(Atom.keepAlive, Atom.withLabel("workspace/active"));
