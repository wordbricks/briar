import { useAtomValue } from "@effect/atom-react";
import { useCallback } from "react";

import { useI18n } from "../i18n";
import { dispatchHuntRun } from "../lib/api";
import {
  completedDispatchRunIdAtom,
  dispatchRunAtom,
  quickProcessErrorAtom,
  quickStartingRunIdAtom,
} from "../state/dialogs/atoms";
import { useRegistry } from "../state/registry";
import { tokenAtom } from "../state/session/atoms";
import { useTeamSyncLoader } from "../state/sync/loader";
import { activeTeamAtom } from "../state/team/atoms";
import type { AgentProvider, ModelEffort } from "../lib/team-llm";
import type { HuntRun } from "../types";

/*
  Dispatching one run to a worker, from the issue board's "process now".

  Both halves write only `state/dialogs`, and the dialog reads it from there, so
  the shell no longer holds either the four values or the two callbacks. What
  keeps this a hook rather than an action module is the localized message the
  readiness check reports.
*/

export interface WorkerDispatchInput {
  readonly provider: AgentProvider;
  readonly model: string | null;
  readonly effort: ModelEffort | null;
  readonly workerId: string | null;
}

export interface WorkerDispatch {
  /** Opens the dispatch dialog for a run, unless it is still waiting. */
  readonly processIssueNow: (run: HuntRun) => void;
  readonly submitWorkerDispatch: (input: WorkerDispatchInput) => Promise<void>;
}

/** How long the confirmed state stays on screen before the dialog closes. */
const DISPATCH_CONFIRMATION_MS = 400;

export function useWorkerDispatch(): WorkerDispatch {
  const { t } = useI18n();
  const registry = useRegistry();
  const loader = useTeamSyncLoader();
  const team = useAtomValue(activeTeamAtom);

  const processIssueNow = useCallback(
    (run: HuntRun) => {
      if (!team) return;
      registry.set(quickProcessErrorAtom, null);
      registry.set(completedDispatchRunIdAtom, null);
      if (run.executionReadiness === "waiting") {
        registry.set(
          quickProcessErrorAtom,
          t("issue.waitingOnPrerequisites", {
            count: run.waitingOnPrerequisiteCount ?? 0,
          }),
        );
        return;
      }
      registry.set(dispatchRunAtom, run);
    },
    [registry, t, team],
  );

  const submitWorkerDispatch = useCallback(
    async (input: WorkerDispatchInput) => {
      const token = registry.get(tokenAtom);
      const run = registry.get(dispatchRunAtom);
      if (
        !team ||
        !token ||
        !run ||
        registry.get(quickStartingRunIdAtom) ||
        registry.get(completedDispatchRunIdAtom)
      ) return;
      registry.set(quickStartingRunIdAtom, run.id);
      registry.set(quickProcessErrorAtom, null);
      try {
        await dispatchHuntRun(token, team.id, run.id, {
          ...input,
          workerId: input.workerId || null,
          persistPreferences: true,
          reassign: Boolean(run.dispatchedAt || run.workerId),
        });
        registry.set(completedDispatchRunIdAtom, run.id);
        try {
          await loader.refresh(team.id, "delta");
        } catch (caught) {
          registry.set(
            quickProcessErrorAtom,
            caught instanceof Error ? caught.message : String(caught),
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, DISPATCH_CONFIRMATION_MS),
        );
        registry.set(dispatchRunAtom, null);
        registry.set(completedDispatchRunIdAtom, null);
      } catch (caught) {
        registry.set(
          quickProcessErrorAtom,
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        registry.set(quickStartingRunIdAtom, null);
      }
    },
    [loader, registry, team],
  );

  return { processIssueNow, submitWorkerDispatch };
}
