import { useChannelCatalogSync } from "../../state/channels/useChannelCatalogSync";
import { useActiveOrganizationPersistence } from "../../state/organization/useActiveOrganizationPersistence";
import { useTeamSync } from "../../state/sync/useTeamSync";
import { useWorkflowAutoGeneration } from "../../state/workflow/useWorkflowAutoGeneration";
import { useWorkspaceSync } from "../../state/workspace/useWorkspaceSync";

/**
 * Mount point for the domain effect hooks that were `useEffect` blocks inside
 * `useBriar`. Rendering nothing keeps their re-render cost off the app shell:
 * a hook here subscribes to the atoms it needs, and only this component
 * re-renders when they change.
 */
export function AppEffects() {
  useActiveOrganizationPersistence();
  useTeamSync();
  useChannelCatalogSync();
  useWorkspaceSync();
  useWorkflowAutoGeneration();
  return null;
}
