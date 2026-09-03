import { useStatusTray } from "../../hooks/useStatusTray";
import { useChannelCatalogSync } from "../../state/channels/useChannelCatalogSync";
import { useNavigationReconciliation } from "../../state/navigation/useNavigationReconciliation";
import { useActiveOrganizationPersistence } from "../../state/organization/useActiveOrganizationPersistence";
import { useTeamSync } from "../../state/sync/useTeamSync";
import { useWorkflowAutoGeneration } from "../../state/workflow/useWorkflowAutoGeneration";
import { useWorkspaceSync } from "../../state/workspace/useWorkspaceSync";

export interface AppEffectsProps {
  /** Selecting a team, which the navigation reconciliation still delegates. */
  readonly selectTeam: (teamId: string) => void;
}

/**
 * Mount point for the domain effect hooks that were `useEffect` blocks inside
 * `useBriar` and `App`. Rendering nothing keeps their re-render cost off the
 * app shell: a hook here subscribes to the atoms it needs, and only this
 * component re-renders when they change.
 */
export function AppEffects({ selectTeam }: AppEffectsProps) {
  useActiveOrganizationPersistence();
  useTeamSync();
  useChannelCatalogSync();
  useWorkspaceSync();
  useWorkflowAutoGeneration();
  useStatusTray();
  // Last, because the reconciliation used to be one of `App`'s own effects and
  // therefore ran after every hook mounted here.
  useNavigationReconciliation({ selectTeam });
  return null;
}
