import { useAtomValue } from "@effect/atom-react";
import { lazy, type ComponentProps } from "react";

import { localTeamConnectionState } from "../../lib/local-team-connection";
import { teamWorkersAtom } from "../../state/entities/workers";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import {
  loadingAtom,
  sessionErrorAtom,
  tokenAtom,
  userAtom,
} from "../../state/session/atoms";
import { remoteMode } from "../../state/platform";
import { isSidebarOpenAtom } from "../../state/dialogs/atoms";
import {
  activeTeamAtom,
  activeTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../../state/team/atoms";
import { useWorkflowActions } from "../../state/workflow/actions";
import { useWorkspaceActions } from "../../state/workspace/actions";
import {
  activeTeamConnectionStateAtom,
  connectedTeamIdsAtom,
  healthAtom,
  localInventoryErrorAtom,
  teamReadinessAtom,
} from "../../state/workspace/atoms";

/*
  The views that render what this device knows about a team's repository, wired
  to `state/workspace` instead of to `App.tsx`.

  Each of them took the health probe, the readiness records and a dozen
  workspace actions as props, so a probe of any team re-rendered the whole shell
  in order to hand values to the one view that reads them. They subscribe to
  exactly what they display now, and the shell keeps only the navigation
  callbacks it actually owns.

  The `lazy()` boundaries live inside these wrappers: `App.tsx` imports the
  wrapper statically, so the chunk split stays exactly where it was. Wrapping
  the wrapper in `lazy()` instead would add a second chunk around the first.
*/

const AppSettings = lazy(() =>
  import("../AppSettings").then((m) => ({ default: m.AppSettings })),
);
const ConnectionHealth = lazy(() =>
  import("../ConnectionHealth").then((m) => ({ default: m.ConnectionHealth })),
);
const TeamOnboarding = lazy(() =>
  import("../TeamOnboarding").then((m) => ({ default: m.TeamOnboarding })),
);
const TeamRepositorySetupDialog = lazy(() =>
  import("../TeamRepositorySetupDialog").then((m) => ({
    default: m.TeamRepositorySetupDialog,
  })),
);
const WorkerStatusBar = lazy(() =>
  import("../WorkerStatusBar").then((m) => ({ default: m.WorkerStatusBar })),
);

/**
 * The status bar's health indicator. The three fields it renders were three
 * `useState`s in the shell, so a probe re-rendered everything the shell drew;
 * they are one atom and one subscriber now.
 */
export function ConnectionHealthWithWorkspace({
  onReconnect,
}: Pick<ComponentProps<typeof ConnectionHealth>, "onReconnect">) {
  const health = useAtomValue(healthAtom);
  const { refreshHealth, repairHealth } = useWorkspaceActions();
  return (
    <ConnectionHealth
      error={health.error}
      health={health.value}
      loading={health.status === "loading"}
      onReconnect={onReconnect}
      onRefresh={() => void refreshHealth()}
      onRepair={() => void repairHealth()}
    />
  );
}

/**
 * The worker roster of the selected team. It reads the worker index rather than
 * the reassembled payload, so a run edit never reaches it.
 */
export function WorkerStatusBarWithTeam(
  props: Omit<
    ComponentProps<typeof WorkerStatusBar>,
    "organizationId" | "token" | "userId" | "workers"
  >,
) {
  const teamId = useAtomValue(activeTeamIdAtom);
  const workers = useAtomValue(teamWorkersAtom(teamId ?? ""));
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  return (
    <WorkerStatusBar
      {...props}
      organizationId={organizationId}
      token={token}
      userId={user?.id ?? null}
      workers={workers ?? []}
    />
  );
}

/**
 * The repository setup dialog for one team. `teamId` is the only thing the
 * shell decides; the readiness, its error and the probe in flight come from
 * that team's own family entry, so another team's probe leaves it alone.
 */
export function TeamRepositorySetupDialogWithWorkspace({
  onClose,
  teamId,
}: Pick<ComponentProps<typeof TeamRepositorySetupDialog>, "onClose"> & {
  readonly teamId: string | null;
}) {
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const teams = useAtomValue(teamsAtom);
  const readiness = useAtomValue(teamReadinessAtom(teamId ?? ""));
  const { refreshProjectReadiness, startWorkingOnProject } =
    useWorkspaceActions();
  if (!teamId) return null;
  return (
    <TeamRepositorySetupDialog
      connectionState={localTeamConnectionState(connectedTeamIds, teamId)}
      error={readiness.error}
      loading={readiness.loading}
      onClose={onClose}
      onRefresh={() => refreshProjectReadiness(teamId)}
      onStartWorking={() => startWorkingOnProject(teamId)}
      projectName={teams.find((team) => team.id === teamId)?.name ?? ""}
      readiness={readiness.readiness}
    />
  );
}

/**
 * The team creation and reconnect flow. It owns the gate too — the flow is open
 * exactly when the team connection atoms say so — so the shell no longer reads
 * those atoms to decide whether to render it.
 */
export function TeamOnboardingWithWorkspace({
  onCancel,
  onFinish,
  ...props
}: Pick<
  ComponentProps<typeof TeamOnboarding>,
  | "includeDeveloperTools"
  | "onCancel"
  | "onFinish"
  | "requireDeveloperAgent"
  | "startWithDeveloperTools"
>) {
  const user = useAtomValue(userAtom);
  const organizations = useAtomValue(organizationsAtom);
  const connection = useAtomValue(teamConnectionAtom);
  const isCreatingTeam = useAtomValue(isCreatingTeamAtom);
  const sessionError = useAtomValue(sessionErrorAtom);
  const localInventoryError = useAtomValue(localInventoryErrorAtom);
  const loading = useAtomValue(loadingAtom);
  const {
    addProject,
    connectProject,
    inspectLovableProject,
    inspectProjectRepository,
    preflightProjectConnection,
    prepareGithubProjectRepository,
    refreshHealth,
    resolveGithubProjectRepository,
    selectProjectRepository,
  } = useWorkspaceActions();
  const { analyzeWorkflowRequirements, reviseWorkflow } = useWorkflowActions();
  if (remoteMode || !user || (!isCreatingTeam && !connection)) return null;
  return (
    <TeamOnboarding
      {...props}
      canCancel={organizations.length > 0}
      connection={connection}
      error={sessionError ?? localInventoryError}
      loading={loading}
      onAnalyzeRequirements={async (teamId, onProgress) => {
        const workflow = await analyzeWorkflowRequirements(teamId, onProgress);
        // The analysis rewrote the required tools, so the probe that checks
        // them has to run before the review step lists what is missing.
        const health = await refreshHealth();
        return { workflow, requirements: health?.requirements ?? [] };
      }}
      onCancel={onCancel}
      onConnect={connectProject}
      onCreate={addProject}
      onFinish={onFinish}
      onInspectLovableRepository={inspectLovableProject}
      onPreflight={preflightProjectConnection}
      onPrepareGithubRepository={prepareGithubProjectRepository}
      onRepositoryInspect={inspectProjectRepository}
      onRepositorySelect={selectProjectRepository}
      onResolveGithubRepository={resolveGithubProjectRepository}
      onReviseWorkflow={reviseWorkflow}
    />
  );
}

/**
 * The application settings screen. Its "source control" section shows what this
 * device knows about the selected team's repository, which the shell used to
 * look up in three facade records — readiness, its error, and the set of probes
 * in flight — and hand over on every render.
 *
 * The `lazy()` boundary lives here, so the chunk split stays where the shell
 * had it.
 */
export function AppSettingsWithWorkspace(
  props: Omit<
    ComponentProps<typeof AppSettings>,
    | "connectionState"
    | "error"
    | "isSidebarOpen"
    | "loading"
    | "onRefresh"
    | "projectId"
    | "projectName"
    | "readiness"
    | "requiresLocalReadiness"
    | "usageScopeKey"
    | "user"
  >,
) {
  const user = useAtomValue(userAtom);
  const team = useAtomValue(activeTeamAtom);
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const connectionState = useAtomValue(activeTeamConnectionStateAtom);
  const readiness = useAtomValue(teamReadinessAtom(team?.id ?? ""));
  const isSidebarOpen = useAtomValue(isSidebarOpenAtom);
  const { refreshProjectReadiness } = useWorkspaceActions();
  if (!user) return null;
  return (
    <AppSettings
      {...props}
      connectionState={connectionState}
      error={team ? readiness.error : null}
      isSidebarOpen={isSidebarOpen}
      loading={team ? readiness.loading : false}
      onRefresh={() =>
        team ? refreshProjectReadiness(team.id) : Promise.resolve(null)}
      projectId={team?.id ?? ""}
      projectName={team?.name ?? ""}
      readiness={team ? readiness.readiness : null}
      requiresLocalReadiness={!remoteMode}
      usageScopeKey={organizationId ?? "none"}
      user={user}
    />
  );
}
