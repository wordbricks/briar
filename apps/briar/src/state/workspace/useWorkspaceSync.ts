import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useRef } from "react";

import { isTeamConnectedLocally } from "../../lib/local-team-connection";
import { lockedTeamIdAtom } from "../platform";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { activeTeamIdAtom, teamSettingsAtom, teamsAtom } from "../team/atoms";
import {
  getSharedWorkflowKeys,
  getWorkspaceScheduleBridge,
  resolveWorkspaceApi,
  workspaceModes,
} from "./api";
import { connectedTeamIdsAtom } from "./atoms";
import { refreshTeamHealth } from "./health";
import { inspectTeamReadiness, refreshTeamReadiness } from "./readiness";

/**
 * Everything this device does on its own about the repositories behind the
 * account's teams: inspect each checkout, mirror the team owned workflow into
 * the local config of every connected one, probe the local install of the
 * selected team, and claim the scheduled agent runs those repositories are due.
 *
 * These were four `useEffect` blocks in `useBriar`, so each of them re-ran on
 * anything that re-rendered the app shell. They read their keys from atoms now,
 * and mounting them from `AppEffects` costs the shell no re-renders.
 */
export function useWorkspaceSync(): void {
  const registry = useRegistry();
  const token = useAtomValue(tokenAtom);
  const teams = useAtomValue(teamsAtom);
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const activeTeamSettings = useAtomValue(teamSettingsAtom(activeTeamId ?? ""));
  const { demoMode, remoteMode } = workspaceModes(registry);

  /*
    The teams whose repository is connected to this device.

    The two effects below claim work and write to disk, so the array they
    restart on has to keep its identity while the set does. The inventory writer
    preserves the previous array when a re-read finds the same teams, which is
    what makes this memo hold across a polling cycle.
  */
  const connectedIds = useMemo(
    () =>
      teams
        .map((team) => team.id)
        .filter((teamId) => isTeamConnectedLocally(connectedTeamIds, teamId)),
    [connectedTeamIds, teams],
  );

  /*
    Claim and execute the scheduled agent runs of every connected team.

    The poller is restarted only by the three things that change what it may
    claim. The session callbacks it hands to each run used to be dependencies
    too, and they change identity on every shell render, so the poller was torn
    down and restarted constantly — and a restart claims immediately. They are
    read from the registry bridge at execution time instead.
  */
  useEffect(() => {
    if (lockedTeamId || demoMode || remoteMode || !token) return;
    if (connectedIds.length === 0) return;
    const api = resolveWorkspaceApi(registry);
    return api.startTeamAgentSchedulePolling(
      {
        claim: (claimTeamIds) =>
          api.claimProjectAgentScheduleRuns(token, claimTeamIds),
        complete: (teamId, runId, input) =>
          api.completeProjectAgentScheduleRun(token, teamId, runId, input),
        renew: (teamId, runId, claimToken) =>
          api.renewProjectAgentScheduleRun(token, teamId, runId, claimToken),
        execute: (run) => {
          const bridge = getWorkspaceScheduleBridge(registry);
          return api.executeScheduledTeamAgent(
            {
              loadDashboard: api.loadDashboard,
              dispatchRun: (currentToken, teamId, candidate, input) =>
                api.dispatchHuntRun(currentToken, teamId, candidate.id, input),
              retryRun: (currentToken, teamId, runId, reason) =>
                api.retryHuntRun(currentToken, teamId, runId, reason),
              runAgent: api.runTeamAgent,
              startSession: bridge.startScheduledAgentSession,
              startWorkerDispatchSession:
                bridge.startScheduledAgentWorkerDispatch,
              settleSession: bridge.settleScheduledAgentSession,
            },
            token,
            run,
          );
        },
        log: (message, caught) => console.error(message, caught),
      },
      connectedIds,
    );
  }, [connectedIds, demoMode, lockedTeamId, registry, remoteMode, token]);

  /*
    Mirror the team owned workflow into every repository connected here.

    Each team is independent so an offline or deleted one cannot block the app
    or leave the others with stale worker settings.
  */
  useEffect(() => {
    if (lockedTeamId || demoMode || remoteMode || !token) return;
    if (connectedIds.length === 0) return;
    const api = resolveWorkspaceApi(registry);
    const lastSyncedKeys = getSharedWorkflowKeys(registry);

    let cancelled = false;
    void api
      .syncSharedProjectWorkflows({
        projectIds: [...connectedIds],
        lastSyncedKeys,
        loadSharedWorkflow: async (teamId) =>
          (await api.loadDashboard(token, teamId)).settings.workflow,
        updateLocalWorkflow: api.updateLocalTeamWorkflow,
      })
      .then((results) => {
        if (cancelled) return;
        for (const result of results) {
          if (result.status === "synced" || result.status === "unchanged") {
            lastSyncedKeys.set(result.projectId, result.key);
            if (result.status === "synced") {
              void refreshTeamReadiness(registry, result.projectId);
            }
          } else if (result.status === "failed") {
            console.warn(
              `Failed to mirror shared project workflow for ${result.projectId}`,
              result.error,
            );
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectedIds, demoMode, lockedTeamId, registry, remoteMode, token]);

  /*
    Probe the selected team's local install, and probe it again whenever the
    team's workflow content changes — those tools are what the probe checks, so
    "Not checked" would otherwise stay on screen until the next team switch.
    Keyed by content rather than object identity so snapshot polling does not
    re-probe every cycle.
  */
  const sharedWorkflowSyncKey =
    activeTeamId && activeTeamSettings?.workflow
      ? `${activeTeamId}:${JSON.stringify(activeTeamSettings.workflow)}`
      : null;
  useEffect(() => {
    void refreshTeamHealth(registry);
  }, [activeTeamId, connectedTeamIds, registry, sharedWorkflowSyncKey]);

  /*
    Inspect every team's checkout. A project window inspects only the team it is
    pinned to.

    A probe reports the inventory it read, so the first sweep changes the very
    dependency that triggers it. Each team therefore records which inventory its
    last probe answered for, and a sweep skips the teams already answered for
    the current one — an inventory that changes for any other reason still
    re-probes every team.
  */
  const inspected = useRef({
    /** The inventory each team's last finished probe answered for. */
    answeredFor: new Map<string, string[] | null>(),
    /** Teams with a probe in flight, which the sweep must not duplicate. */
    inFlight: new Set<string>(),
  });
  useEffect(() => {
    if (demoMode || remoteMode || teams.length === 0) return;
    const relevantTeams = lockedTeamId
      ? teams.filter((team) => team.id === lockedTeamId)
      : teams;
    const { answeredFor, inFlight } = inspected.current;
    for (const team of relevantTeams) {
      if (inFlight.has(team.id)) continue;
      if (
        answeredFor.has(team.id) &&
        answeredFor.get(team.id) === connectedTeamIds
      ) {
        continue;
      }
      inFlight.add(team.id);
      void inspectTeamReadiness(registry, team.id).finally(() => {
        inFlight.delete(team.id);
        answeredFor.set(team.id, registry.get(connectedTeamIdsAtom));
      });
    }
  }, [connectedTeamIds, demoMode, lockedTeamId, registry, remoteMode, teams]);
}
