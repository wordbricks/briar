import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { isRepositoryWorkflowPending } from "../../lib/auto-hunt-contract";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { activeTeamIdAtom, teamConnectionAtom, teamSettingsAtom } from "../team/atoms";
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
    regenerateWorkflow,
    registry,
    settings,
    teamConnection,
    teamId,
    token,
  ]);
}
