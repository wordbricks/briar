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
  activeTeamIdAtom,
  teamAgentBoardAtom,
  teamExecutionPolicyAtom,
  teamSettingsAtom,
} from "../../state/team/atoms";
import { teamRunsAtom } from "../../state/entities/runs";
import { teamWorkersAtom } from "../../state/entities/workers";
import { useIntegrationActions } from "../../state/integrations/actions";
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

  Each page now reads the projections it actually draws rather than the whole
  payload: the settings page never wakes for a run, and the lobby never wakes
  for a worker heartbeat. The Agents page is the one that needs a set of four
  at once — a dispatch picks runs, checks them against the workers and the
  policy, and reports in the team's issue key — so it takes `teamAgentBoardAtom`.

  Everything else these views take — health, readiness, workflow and the
  navigation callbacks — is still a prop; Phase 3 owns those.
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
  props: Omit<ComponentProps<typeof TeamAgents>, "board">,
) {
  const teamId = useAtomValue(activeTeamIdAtom);
  const board = useAtomValue(teamAgentBoardAtom(teamId ?? ""));
  return <TeamAgents {...props} board={board} />;
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
    | "readiness"
    | "requiresLocalReadiness"
    | "runs"
    | "settingsRepository"
  >,
) {
  const connectionState = useAtomValue(activeTeamConnectionStateAtom);
  const teamId = useAtomValue(activeTeamIdAtom);
  const readiness = useAtomValue(teamReadinessAtom(teamId ?? ""));
  // The stat tiles and the usage summary are built from the runs; the
  // repository panel is the only thing the lobby reads out of team settings.
  const runs = useAtomValue(teamRunsAtom(teamId ?? ""));
  const settings = useAtomValue(teamSettingsAtom(teamId ?? ""));
  return (
    <TeamLobby
      {...props}
      connectionState={connectionState}
      readiness={readiness.readiness}
      requiresLocalReadiness={!remoteMode}
      runs={runs ?? []}
      settingsRepository={settings?.githubRepository ?? null}
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
    | "executionPolicy"
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
    | "settings"
    | "velen"
    | "workers"
  >,
) {
  const teamId = useAtomValue(activeTeamIdAtom);
  const settings = useAtomValue(teamSettingsAtom(teamId ?? ""));
  const executionPolicy = useAtomValue(teamExecutionPolicyAtom(teamId ?? ""));
  const workers = useAtomValue(teamWorkersAtom(teamId ?? ""));
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
      executionPolicy={executionPolicy ?? undefined}
      /*
        The repository the team is wired to comes from team settings, and falls
        back to what this device's checkout reports — but only while that
        checkout is actually connected, which is what `localTeamReadiness`
        enforces.
      */
      githubRepository={
        settings?.githubRepository ??
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
        githubRepository: settings?.githubRepository,
        repositoryPath: health.value?.repositoryPath,
      })}
      settings={settings}
      velen={velen}
      workers={workers ?? []}
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
