import { useAtomValue } from "@effect/atom-react";
import { lazy, type ComponentProps } from "react";

import {
  teamExecutionPolicyAtom,
  activeTeamIdAtom,
} from "../../state/team/atoms";
import { teamWorkersAtom } from "../../state/entities/workers";
import { activeDashboardAtom } from "../../state/sync/view";

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

export function TeamSettingsWithDashboard(
  props: Omit<ComponentProps<typeof TeamSettings>, "dashboard">,
) {
  const dashboard = useAtomValue(activeDashboardAtom);
  return <TeamSettings {...props} dashboard={dashboard} />;
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
