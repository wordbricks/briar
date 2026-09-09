import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { isSidebarOpenAtom } from "../../state/dialogs/atoms";
import { useWorkspaceActions } from "../../state/workspace/actions";
import { useLocalWorkspaceActions } from "../../state/local-workspace/actions";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { visibleTeamsAtom } from "../../state/team/atoms";
import { connectedTeamIdsAtom } from "../../state/local-workspace/atoms";
import { WorkspaceSettings } from "../WorkspaceSettings";

/**
 * `WorkspaceSettings` wired to the session, team and workspace atoms. The
 * workspace itself stays a prop: App resolves it from the settings target
 * and needs the same value to decide whether to render this screen at all.
 */
export function WorkspaceSettingsWithSession(
  props: Omit<
    ComponentProps<typeof WorkspaceSettings>,
    | "connectedTeamIds"
    | "isSidebarOpen"
    | "onLogoChange"
    | "onRename"
    | "projects"
    | "token"
    | "userId"
  >,
) {
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const isSidebarOpen = useAtomValue(isSidebarOpenAtom);
  const projects = useAtomValue(visibleTeamsAtom);
  const { changeWorkspaceLogo, renameWorkspace } =
    useWorkspaceActions();
  return (
    <WorkspaceSettings
      {...props}
      connectedTeamIds={connectedTeamIds}
      isSidebarOpen={isSidebarOpen}
      onLogoChange={changeWorkspaceLogo}
      onRename={renameWorkspace}
      projects={projects}
      token={token ?? ""}
      userId={user?.id ?? ""}
    />
  );
}
