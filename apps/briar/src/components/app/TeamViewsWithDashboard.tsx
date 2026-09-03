import { useAtomValue } from "@effect/atom-react";
import { lazy, type ComponentProps } from "react";

import { isRepositoryConnectedForImport } from "../../lib/linear-import";
import { localTeamReadiness } from "../../lib/local-team-connection";
import {
  teamExecutionPolicyAtom,
  activeTeamIdAtom,
} from "../../state/team/atoms";
import { teamWorkersAtom } from "../../state/entities/workers";
import { useIntegrationActions } from "../../state/integrations/actions";
import { activeDashboardAtom } from "../../state/sync/view";
import { useWorkflowActions } from "../../state/workflow/actions";
import { useWorkspaceActions } from "../../state/workspace/actions";
import {
  activeTeamConnectionStateAtom,
  connectedTeamIdsAtom,
  healthAtom,
  teamReadinessAtom,
} from "../../state/workspace/atoms";
import { velenAtom } from "../../state/integrations/atoms";

/*
  The three team scoped pages and the dispatch dialog, wired to the store.

  Each of them took the whole `DashboardPayload` from `App.tsx`, which meant a
  polling tick that changed one run re-rendered the app shell so the shell could
  hand them a payload they mostly ignore. Reading it here keeps the tick inside
  the view that displays it.

  Everything else these views take — health, readiness, workflow, workers and
  the navigation callbacks — is still a prop; Phase 3 owns those.
*/

const TeamAgents = lazy(() =>
  import("../TeamAgents").then((m) => ({ default: m.TeamAgents })),
);
const TeamLobby = lazy(() =>
  import("../TeamLobby").then((m) => ({ default: m.TeamLobby })),
);
const TeamSettings = lazy(() =>
  import("../TeamSettings").then((m) => ({ default: m.TeamSettings })),
);
const WorkerDispatchDialog = lazy(() =>
  import("../WorkerDispatchDialog").then((m) => ({
    default: m.WorkerDispatchDialog,
  })),
);

export function TeamAgentsWithDashboard(
  props: Omit<ComponentProps<typeof TeamAgents>, "dashboard">,
) {
  const dashboard = useAtomValue(activeDashboardAtom);
  return <TeamAgents {...props} dashboard={dashboard} />;
}

export function TeamLobbyWithDashboard(
  props: Omit<ComponentProps<typeof TeamLobby>, "dashboard">,
) {
  const dashboard = useAtomValue(activeDashboardAtom);
  return <TeamLobby {...props} dashboard={dashboard} />;
}

/**
 * Team settings, which is where every Phase 3 domain surfaces at once: the
 * repository the team is wired to, the health of this device's install, the
 * workflow editor and the two integrations. All of it came through `App.tsx`
 * as fifteen props, so a health probe re-rendered the shell to reach a panel
 * that may not even be open.
 */
export function TeamSettingsWithDashboard(
  props: Omit<
    ComponentProps<typeof TeamSettings>,
    | "dashboard"
    | "githubRepository"
    | "health"
    | "onAnalyzeWorkflowRequirements"
    | "onConnectLinearImport"
    | "onImportLinearIssues"
    | "onLoadLinearImportStates"
    | "onRefreshHealth"
    | "onRefreshVelen"
    | "onRegenerateWorkflow"
    | "onReviseWorkflow"
    | "onSaveCheckpointPolicy"
    | "onUpdateVelenOrg"
    | "repositoryConnected"
    | "velen"
  >,
) {
  const teamId = useAtomValue(activeTeamIdAtom);
  const dashboard = useAtomValue(activeDashboardAtom);
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const connectionState = useAtomValue(activeTeamConnectionStateAtom);
  const health = useAtomValue(healthAtom);
  const readiness = useAtomValue(teamReadinessAtom(teamId ?? ""));
  const velen = useAtomValue(velenAtom);
  const { refreshHealth } = useWorkspaceActions();
  const {
    analyzeWorkflowRequirements,
    regenerateWorkflow,
    reviseWorkflow,
    saveCheckpointPolicy,
  } = useWorkflowActions();
  const {
    connectLinearForImport,
    loadLinearStatesForImport,
    refreshVelen,
    runLinearIssueImport,
    saveVelenIntegration,
  } = useIntegrationActions();
  const settingsTeamId = teamId ?? "";
  return (
    <TeamSettings
      {...props}
      dashboard={dashboard}
      /*
        The repository the team is wired to comes from team settings, and falls
        back to what this device's checkout reports — but only while that
        checkout is actually connected, which is what `localTeamReadiness`
        enforces.
      */
      githubRepository={
        dashboard?.settings.githubRepository ??
        localTeamReadiness(connectionState, readiness.readiness)
          ?.githubRepository ??
        null
      }
      health={health.value}
      onAnalyzeWorkflowRequirements={() =>
        analyzeWorkflowRequirements(settingsTeamId)
      }
      onConnectLinearImport={(apiKey) =>
        connectLinearForImport(settingsTeamId, apiKey)
      }
      onImportLinearIssues={(input) =>
        runLinearIssueImport(settingsTeamId, input)
      }
      onLoadLinearImportStates={(input) =>
        loadLinearStatesForImport(settingsTeamId, input)
      }
      onRefreshHealth={refreshHealth}
      onRefreshVelen={refreshVelen}
      onRegenerateWorkflow={() => regenerateWorkflow(settingsTeamId)}
      onReviseWorkflow={(requestedChange) =>
        reviseWorkflow(settingsTeamId, requestedChange)
      }
      onSaveCheckpointPolicy={(scope, checkpoints, expectedRevision) =>
        saveCheckpointPolicy(
          settingsTeamId,
          scope,
          checkpoints,
          expectedRevision,
        )
      }
      onUpdateVelenOrg={(org) => saveVelenIntegration(settingsTeamId, org)}
      repositoryConnected={isRepositoryConnectedForImport({
        projectId: settingsTeamId,
        connectedTeamIds,
        githubRepository: dashboard?.settings.githubRepository,
        repositoryPath: health.value?.repositoryPath,
      })}
      velen={velen}
    />
  );
}

/**
 * The dispatch dialog only needs the team's workers and execution policy, so it
 * reads those two families rather than the reassembled payload: a run edit
 * leaves both alone and never reaches the dialog.
 */
export function WorkerDispatchDialogWithTeam(
  props: Omit<ComponentProps<typeof WorkerDispatchDialog>, "policy" | "workers">,
) {
  const teamId = useAtomValue(activeTeamIdAtom);
  const policy = useAtomValue(teamExecutionPolicyAtom(teamId ?? ""));
  const workers = useAtomValue(teamWorkersAtom(teamId ?? ""));
  return (
    <WorkerDispatchDialog
      {...props}
      policy={policy ?? undefined}
      workers={workers ?? []}
    />
  );
}
