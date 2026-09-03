import { useStatusTray } from "../../hooks/useStatusTray";
import { useChannelCatalogSync } from "../../state/channels/useChannelCatalogSync";
import { useNavigationReconciliation } from "../../state/navigation/useNavigationReconciliation";
import { useActiveOrganizationPersistence } from "../../state/organization/useActiveOrganizationPersistence";
import { useSnapshotWriter } from "../../state/persistence/useSnapshotWriter";
import { usePlanningProjectsSync } from "../../state/planning/usePlanningProjectsSync";
import { useAuthReturnListener } from "../../state/session/useAuthReturnListener";
import { useSessionBootstrap } from "../../state/session/useSessionBootstrap";
import { useTeamSync } from "../../state/sync/useTeamSync";
import { useWorkflowAutoGeneration } from "../../state/workflow/useWorkflowAutoGeneration";
import { useWorkspaceSync } from "../../state/workspace/useWorkspaceSync";

/**
 * Mount point for every domain effect: what used to be `useEffect` blocks
 * inside `useBriar` and `App`. Rendering nothing keeps their re-render cost off
 * the app shell — a hook here subscribes to the atoms it needs, and only this
 * component re-renders when they change.
 *
 * The order below is the order React runs them in, and it is the order they ran
 * in before: the six that were already here, then the three the facade owned
 * (whose effects ran after a child's), and the reconciliation last.
 */
export function AppEffects() {
  useActiveOrganizationPersistence();
  useTeamSync();
  useChannelCatalogSync();
  useWorkspaceSync();
  useWorkflowAutoGeneration();
  useStatusTray();
  usePlanningProjectsSync();
  useAuthReturnListener();
  useSessionBootstrap();
  // Only observes, so its position among the writers above does not matter; it
  // sits after the bootstrap because the first record of a boot is the account
  // the bootstrap just committed.
  useSnapshotWriter();
  // Last, because the reconciliation used to be one of `App`'s own effects and
  // therefore ran after every hook mounted here.
  useNavigationReconciliation();
  return null;
}
