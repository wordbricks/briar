import { useAtom, useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, useMemo } from "react";

import { settingsAccountSelection } from "../../lib/settings-account-selection";
import {
  visibleOrganizations as scopedOrganizations,
  visibleTeams,
} from "../../lib/team-window-scope";
import { settingsNavigationLocation } from "../../lib/app-navigation";
import { isSidebarOpenAtom } from "../../state/dialogs/atoms";
import { settingsTargetAtom } from "../../state/navigation/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { lockedTeamIdAtom } from "../../state/platform";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import type { AppNavigationLocation } from "../../lib/app-navigation";
import type { UnifiedSettingsTarget } from "../UnifiedSettingsSidebar";

/*
  The navigation column the three settings pages share.

  It is passed down as an element rather than rendered by each page, so the
  shell used to rebuild it — with the organization and team lists, the open
  target and the sidebar flag — on every render. All four are in the store, so
  the column reads them itself and the shell hands the pages one stable node.

  The `lazy()` boundary moves here with it, so the chunk split is unchanged.
*/

const UnifiedSettingsSidebar = lazy(() =>
  import("../UnifiedSettingsSidebar").then((m) => ({
    default: m.UnifiedSettingsSidebar,
  })),
);

export interface AppSettingsSidebarProps {
  /** Leaves the settings page, still the shell's history call. */
  readonly onBack: () => void;
  /** Records the chosen section in history, still the shell's. */
  readonly onNavigate: (location: AppNavigationLocation) => void;
  /** Selecting an organization, still the session facade's. */
  readonly onSelectOrganization: (organizationId: string) => void;
  /** Selecting a team, still the session facade's. */
  readonly onSelectTeam: (teamId: string) => void;
}

export function AppSettingsSidebar({
  onBack,
  onNavigate,
  onSelectOrganization,
  onSelectTeam,
}: AppSettingsSidebarProps) {
  const [activeTarget, setActiveTarget] = useAtom(settingsTargetAtom);
  const isOpen = useAtomValue(isSidebarOpenAtom);
  const organizations = useAtomValue(organizationsAtom);
  const teams = useAtomValue(teamsAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const scopedTeams = useMemo(
    () => visibleTeams(teams, lockedTeamId),
    [lockedTeamId, teams],
  );
  const organizationOptions = useMemo(
    () => scopedOrganizations(organizations, teams, lockedTeamId),
    [lockedTeamId, organizations, teams],
  );
  return (
    <Suspense fallback={<div className="lazy-view-placeholder h-full w-full" />}>
      <UnifiedSettingsSidebar
        activeTarget={activeTarget}
        isOpen={isOpen}
        onBack={onBack}
        onNavigate={(target: UnifiedSettingsTarget) => {
          setActiveTarget(target);
          onNavigate(settingsNavigationLocation(target));
          const selection = settingsAccountSelection(
            target,
            activeOrganizationId,
            activeTeamId,
          );
          if (selection?.scope === "organization") {
            onSelectOrganization(selection.organizationId);
          } else if (selection?.scope === "project") {
            onSelectTeam(selection.projectId);
          }
        }}
        organizations={organizationOptions}
        projects={scopedTeams}
      />
    </Suspense>
  );
}
