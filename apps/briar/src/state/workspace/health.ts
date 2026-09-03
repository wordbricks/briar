import type { AutoHuntHealth } from "../../generated/tauri";
import { isTeamConnectedLocally } from "../../lib/local-team-connection";
import { shouldSyncSharedWorkflow } from "../../lib/shared-workflow-sync";
import type { AtomRegistry } from "../registry";
import { loadedDashboardTeamIdAtom } from "../sync/view";
import { activeTeamIdAtom, teamSettingsAtom } from "../team/atoms";
import {
  beginHealthRequest,
  getSharedWorkflowKeys,
  isCurrentHealthRequest,
  resolveWorkspaceApi,
  workspaceModes,
} from "./api";
import {
  beginHealthProbe,
  connectedTeamIdsAtom,
  resetHealth,
  setHealthError,
  setHealthResult,
} from "./atoms";
import { refreshTeamReadiness } from "./readiness";

/*
  The local install probe for the selected team.

  Two guards decide whether a result may be committed: a generation counter that
  a newer probe bumps, and the selected team, so a probe that outlived its team
  is dropped rather than shown under another team's name. A dropped probe also
  leaves the loading flag up, because the newer probe that superseded it owns it.
*/

const messageOf = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * Probes the selected team's local install, first mirroring the team's shared
 * workflow into this device so the probe checks the tools the team actually
 * requires. Returns `null` when there was nothing to probe or the probe was
 * superseded.
 */
export async function refreshTeamHealth(
  registry: AtomRegistry,
): Promise<AutoHuntHealth | null> {
  const request = beginHealthRequest(registry);
  const teamId = registry.get(activeTeamIdAtom);
  const { demoMode, remoteMode } = workspaceModes(registry);
  if (
    demoMode ||
    remoteMode ||
    !teamId ||
    // 이 기기에 저장소를 연결하기 전에는 로컬 상태를 검사할 대상이 없습니다.
    !isTeamConnectedLocally(registry.get(connectedTeamIdsAtom), teamId)
  ) {
    resetHealth(registry);
    return null;
  }
  const api = resolveWorkspaceApi(registry);
  const sharedWorkflowKeys = getSharedWorkflowKeys(registry);
  const isCurrent = () =>
    isCurrentHealthRequest(registry, request) &&
    registry.get(activeTeamIdAtom) === teamId;
  beginHealthProbe(registry);
  try {
    // Team workflow tools are shared via team settings. Mirror them into the
    // local config so this worker machine can probe readiness.
    const sharedWorkflow =
      registry.get(loadedDashboardTeamIdAtom) === teamId
        ? (registry.get(teamSettingsAtom(teamId))?.workflow ?? null)
        : null;
    const syncPlan = shouldSyncSharedWorkflow({
      connectedLocally: true,
      sharedWorkflow,
      lastSyncedKey: sharedWorkflowKeys.get(teamId) ?? null,
      projectId: teamId,
    });
    if (syncPlan.sync && sharedWorkflow) {
      try {
        await api.updateLocalTeamWorkflow(teamId, sharedWorkflow);
        if (syncPlan.key) sharedWorkflowKeys.set(teamId, syncPlan.key);
        if (!isCurrent()) return null;
        await refreshTeamReadiness(registry, teamId);
      } catch (syncError) {
        console.warn(
          "Failed to mirror shared project workflow for tool checks",
          syncError,
        );
      }
    } else if (syncPlan.key) {
      sharedWorkflowKeys.set(teamId, syncPlan.key);
    }

    if (!isCurrent()) return null;
    const result = await api.loadAutoHuntHealth(teamId);
    if (!isCurrent()) return null;
    setHealthResult(registry, result);
    return result;
  } catch (caught) {
    if (!isCurrent()) return null;
    setHealthError(registry, messageOf(caught));
    return null;
  }
}

/**
 * Reinstalls whatever the probe found missing. Unlike a failed probe this keeps
 * the last known health on screen, which is what the panel renders the repair
 * button from.
 */
export async function repairTeamHealth(
  registry: AtomRegistry,
): Promise<AutoHuntHealth | null> {
  const teamId = registry.get(activeTeamIdAtom);
  if (!teamId) throw new Error("복구할 프로젝트가 없습니다.");
  const request = beginHealthRequest(registry);
  const isCurrent = () =>
    isCurrentHealthRequest(registry, request) &&
    registry.get(activeTeamIdAtom) === teamId;
  beginHealthProbe(registry, { clearError: true });
  try {
    const result = await resolveWorkspaceApi(registry).repairAutoHunt(teamId);
    if (!isCurrent()) return null;
    setHealthResult(registry, result);
    return result;
  } catch (caught) {
    if (!isCurrent()) return null;
    setHealthError(registry, messageOf(caught), { keepValue: true });
    return null;
  }
}
