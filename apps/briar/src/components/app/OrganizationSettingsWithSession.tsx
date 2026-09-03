import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { isSidebarOpenAtom } from "../../state/dialogs/atoms";
import { useOrganizationActions } from "../../state/organization/actions";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { visibleTeamsAtom } from "../../state/team/atoms";
import { connectedTeamIdsAtom } from "../../state/workspace/atoms";
import { OrganizationSettings } from "../OrganizationSettings";

/**
 * `OrganizationSettings` wired to the session, team and workspace atoms. The
 * organization itself stays a prop: App resolves it from the settings target
 * and needs the same value to decide whether to render this screen at all.
 */
export function OrganizationSettingsWithSession(
  props: Omit<
    ComponentProps<typeof OrganizationSettings>,
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
  const { changeOrganizationLogo, renameOrganization } =
    useOrganizationActions();
  return (
    <OrganizationSettings
      {...props}
      connectedTeamIds={connectedTeamIds}
      isSidebarOpen={isSidebarOpen}
      onLogoChange={changeOrganizationLogo}
      onRename={renameOrganization}
      projects={projects}
      token={token ?? ""}
      userId={user?.id ?? ""}
    />
  );
}
