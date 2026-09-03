import { useAtom, useAtomValue } from "@effect/atom-react";
import { lazy, type ComponentProps } from "react";

import { isRepositoryConnectedForImport } from "../../lib/linear-import";
import {
  completedDispatchRunIdAtom,
  dispatchRunAtom,
  quickProcessErrorAtom,
  quickStartingRunIdAtom,
} from "../../state/dialogs/atoms";
import { localTeamReadiness } from "../../lib/local-team-connection";
import { remoteMode } from "../../state/platform";
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

/**
 * The team home. Besides the payload it reads what this device knows about the
 * team's repository, which the shell used to look up in the readiness record
 * and hand over on every render.
 */
export function TeamLobbyWithDashboard(
  props: Omit<
    ComponentProps<typeof TeamLobby>,
    | "connectionState"
    | "dashboard"
    | "readiness"
    | "requiresLocalReadiness"
  >,
) {
  const dashboard = useAtomValue(activeDashboardAtom);
  const connectionState = useAtomValue(activeTeamConnectionStateAtom);
  const teamId = useAtomValue(activeTeamIdAtom);
  const readiness = useAtomValue(teamReadinessAtom(teamId ?? ""));
  return (
    <TeamLobby
      {...props}
      connectionState={connectionState}
      dashboard={dashboard}
      readiness={readiness.readiness}
      requiresLocalReadiness={!remoteMode}
    />
  );
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
 *
 * The dispatch flow's own state — which run is being dispatched, whether the
 * request is in flight, whether it just succeeded and what it reported — comes
 * from `state/dialogs`. Only submitting is still the shell's: it is the one
 * step that needs the token and a dashboard refresh.
 */
export function WorkerDispatchDialogWithTeam({
  onSubmit,
}: Pick<ComponentProps<typeof WorkerDispatchDialog>, "onSubmit">) {
  const teamId = useAtomValue(activeTeamIdAtom);
  const policy = useAtomValue(teamExecutionPolicyAtom(teamId ?? ""));
  const workers = useAtomValue(teamWorkersAtom(teamId ?? ""));
  const [run, setRun] = useAtom(dispatchRunAtom);
  const dispatchingRunId = useAtomValue(quickStartingRunIdAtom);
  const completedRunId = useAtomValue(completedDispatchRunIdAtom);
  const error = useAtomValue(quickProcessErrorAtom);
  return (
    <WorkerDispatchDialog
      didDispatchSuccessfully={completedRunId === run?.id}
      error={error}
      isDispatching={Boolean(dispatchingRunId)}
      onOpenChange={(open) => {
        // A dispatch in flight, and the moment of success after it, own the
        // dialog: closing it there would drop the confirmation mid-animation.
        if (!open && !dispatchingRunId && !completedRunId) setRun(null);
      }}
      onSubmit={onSubmit}
      open={Boolean(run)}
      policy={policy ?? undefined}
      run={run}
      workers={workers ?? []}
    />
  );
}
