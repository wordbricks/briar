import { useStatusTray } from "../../hooks/useStatusTray";
import { useAgentSessionPersistence } from "../../state/agent-sessions/useAgentSessionPersistence";
import { useAgentSessionSync } from "../../state/agent-sessions/useAgentSessionSync";
import { useChannelCatalogSync } from "../../state/channels/useChannelCatalogSync";
import { useNavigationReconciliation } from "../../state/navigation/useNavigationReconciliation";
import { useActiveOrganizationPersistence } from "../../state/organization/useActiveOrganizationPersistence";
import { useHydration } from "../../state/persistence/useHydration";
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
 * (whose effects ran after a child's), and the reconciliation last. Hydration
 * is the exception and comes first — it opens the gate the session bootstrap
 * waits on, and it has to be open before that bootstrap's effect starts.
 *
 * The agent session sync sits with the other transports. Its own hydration is
 * not here at all: the sessions are read out of `localStorage` by the lazy body
 * of their atoms, so the first component to read them has them.
 */
export function AppEffects() {
  useHydration();
  useActiveOrganizationPersistence();
  useTeamSync();
  useChannelCatalogSync();
  useAgentSessionSync();
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
  // Same story for the session log, which is written to `localStorage` rather
  // than to the snapshot store: it only observes, and the sessions it records
  // are the ones the sync above has just settled.
  useAgentSessionPersistence();
  // Last, because the reconciliation used to be one of `App`'s own effects and
  // therefore ran after every hook mounted here.
  useNavigationReconciliation();
  return null;
}
