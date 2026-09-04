import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { isRepositoryWorkflowPending } from "../../lib/auto-hunt-contract";
import { hydratedFromSnapshotAtom } from "../persistence/hydration";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  activeTeamIdAtom,
  teamConnectionAtom,
  teamSettingsAtom,
  teamSyncedSinceBootAtom,
} from "../team/atoms";
import { workspaceModes } from "../workspace/api";
import { connectedTeamIdsAtom } from "../workspace/atoms";
import {
  getAutomaticWorkflowGenerations,
  getWorkflowGenerationAttempts,
  reportAutomaticWorkflowFailure,
  useWorkflowActions,
} from "./actions";

/**
 * Generates the repository workflow of a connected team whose settings still
 * carry the pending placeholder.
 *
 * This was a `useEffect` in `useBriar` that listed the whole dashboard as a
 * dependency, so every polling tick re-ran a body whose only inputs are the
 * team's settings and whether its repository is connected here. It watches
 * exactly those now: a run changing cannot reach it.
 *
 * Generation is an LLM analysis of the whole repository, so the one thing this
 * must never do is start one the team does not need. On a hydrated boot the
 * settings on screen came off the disk, and a workflow generated on another
 * machine — or by this one just before it was closed — still reads as pending
 * there. Such a team therefore waits for its first payload of the session before
 * the condition is even looked at; see {@link teamSyncedSinceBootAtom}.
 */
export function useWorkflowAutoGeneration(): void {
  const registry = useRegistry();
  const { regenerateWorkflow } = useWorkflowActions();
  const token = useAtomValue(tokenAtom);
  const teamId = useAtomValue(activeTeamIdAtom);
  // A team with no payload has `null` settings, which is the "not loaded yet"
  // case the dashboard null check used to cover.
  const settings = useAtomValue(teamSettingsAtom(teamId ?? ""));
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const teamConnection = useAtomValue(teamConnectionAtom);
  // Only a hydrated boot can be holding settings nothing confirmed, so a boot
  // that read no record never consults the flag and behaves as it always did.
  const hydratedBoot = useAtomValue(hydratedFromSnapshotAtom);
  const syncedSinceBoot = useAtomValue(teamSyncedSinceBootAtom(teamId ?? ""));

  useEffect(() => {
    const { demoMode, remoteMode } = workspaceModes(registry);
    const attempts = getWorkflowGenerationAttempts(registry);
    const generations = getAutomaticWorkflowGenerations(registry);
    if (
      demoMode ||
      remoteMode ||
      !token ||
      !teamId ||
      !settings ||
      !connectedTeamIds?.includes(teamId) ||
      // These settings are the ones the disk had. Whether the workflow is still
      // pending is the server's to say, and it has not said it yet.
      (hydratedBoot && !syncedSinceBoot) ||
      // The connection flow generates its own workflow; letting this one run
      // beside it would start two LLM analyses of the same repository.
      teamConnection?.project.id === teamId ||
      !isRepositoryWorkflowPending(settings.workflow) ||
      attempts.has(teamId)
    ) {
      return;
    }
    attempts.add(teamId);
    const generation = regenerateWorkflow(teamId);
    generations.set(teamId, generation);
    void generation
      .catch((caught) => reportAutomaticWorkflowFailure(registry, caught))
      .finally(() => {
        if (generations.get(teamId) === generation) generations.delete(teamId);
      });
  }, [
    connectedTeamIds,
    hydratedBoot,
    regenerateWorkflow,
    registry,
    settings,
    syncedSinceBoot,
    teamConnection,
    teamId,
    token,
  ]);
}
