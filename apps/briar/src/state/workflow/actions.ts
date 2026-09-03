import { useMemo } from "react";

import type { TeamLlmProgress } from "../../lib/team-llm";
import type { TeamSettings } from "../../types";
import { useRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { commitTeamSettings } from "../sync/commit";
import { activeDashboardAtom } from "../sync/view";
import {
  resolveWorkspaceApi,
  workspaceModes,
  type WorkspaceApi,
} from "../workspace/api";
import { refreshTeamHealth } from "../workspace/health";
import { refreshTeamReadiness } from "../workspace/readiness";

/*
  Everything that changes a team's Auto Hunt workflow.

  A workflow lives in two places: team settings on the server, and the local
  config of every machine that has the repository connected. Every write here
  keeps the same order — local first, then the server, and roll the local write
  back if the server refuses — because a machine whose config claims a workflow
  the team never accepted would run the wrong checks.

  These were five `useCallback`s in `useBriar`, each listing `dashboard` in its
  dependency array and so rebuilt on every polling tick. They read the rendered
  payload through the registry at call time instead, which makes their identity
  stable for the lifetime of the registry.
*/

export type WorkflowDraft = TeamSettings["workflow"];
export type CheckpointPolicy = NonNullable<TeamSettings["checkpointPolicy"]>;

export interface WorkflowActionDeps {
  readonly api?: Partial<WorkspaceApi> | undefined;
}

export interface WorkflowActions {
  /** Re-derives the required tools of the current workflow from the repository. */
  readonly analyzeWorkflowRequirements: (
    teamId: string,
    onProgress?: (progress: TeamLlmProgress) => void,
  ) => Promise<WorkflowDraft>;
  /** Persists a workflow locally and on the server, rolling back on failure. */
  readonly persistProjectWorkflow: (
    teamId: string,
    previousWorkflow: WorkflowDraft,
    nextWorkflow: WorkflowDraft,
  ) => Promise<WorkflowDraft>;
  /** Regenerates the whole workflow from the repository. */
  readonly regenerateWorkflow: (teamId: string) => Promise<WorkflowDraft>;
  /** Applies a natural language revision to the current workflow. */
  readonly reviseWorkflow: (
    teamId: string,
    requestedChange: string,
  ) => Promise<WorkflowDraft>;
  readonly saveCheckpointPolicy: (
    teamId: string,
    scope: "project" | "user",
    checkpoints: CheckpointPolicy["teamMandatory"],
    expectedRevision: number,
  ) => Promise<CheckpointPolicy>;
}

/*
  Repository workflow generations started automatically for a team whose
  settings still hold the pending placeholder, keyed by team.

  `useWorkflowAutoGeneration` records them and the reconnect flow reads them:
  opening reconnect while the boot generation is still running must join that
  generation instead of launching a second LLM run from the same pending
  snapshot. They were two refs on `useBriar` and are per registry state now,
  which is the same lifetime.
*/
const automaticGenerations = new WeakMap<
  AtomRegistry,
  Map<string, Promise<WorkflowDraft>>
>();

/** In-flight automatic generations for this registry. */
export function getAutomaticWorkflowGenerations(
  registry: AtomRegistry,
): Map<string, Promise<WorkflowDraft>> {
  let current = automaticGenerations.get(registry);
  if (!current) {
    current = new Map();
    automaticGenerations.set(registry, current);
  }
  return current;
}

/*
  Teams whose repository workflow was already generated once in this session.
  A generation that fails is not retried: the failure surfaces as an app error
  and the user regenerates from team settings, which is what stops a repository
  the LLM cannot analyse from starting a new run on every dashboard tick.
*/
const generationAttempts = new WeakMap<AtomRegistry, Set<string>>();

/** Teams already attempted in this registry. */
export function getWorkflowGenerationAttempts(
  registry: AtomRegistry,
): Set<string> {
  let current = generationAttempts.get(registry);
  if (!current) {
    current = new Set();
    generationAttempts.set(registry, current);
  }
  return current;
}

export function createWorkflowActions(
  registry: AtomRegistry,
  deps: WorkflowActionDeps = {},
): WorkflowActions {
  const api = () => resolveWorkspaceApi(registry, deps.api);

  /** The rendered team's settings, or `null` when another team is on screen. */
  const renderedSettings = (teamId: string): TeamSettings | null => {
    const dashboard = registry.get(activeDashboardAtom);
    return dashboard && dashboard.team.id === teamId ? dashboard.settings : null;
  };

  const requireSettings = (teamId: string, message: string) => {
    const settings = renderedSettings(teamId);
    if (!settings) throw new Error(message);
    return settings;
  };

  const requireToken = () => {
    const token = registry.get(tokenAtom);
    if (!token) throw new Error("로그인이 필요합니다.");
    return token;
  };

  const messageOf = (caught: unknown) =>
    caught instanceof Error ? caught.message : String(caught);

  const persistProjectWorkflow: WorkflowActions["persistProjectWorkflow"] =
    async (teamId, previousWorkflow, nextWorkflow) => {
      const token = registry.get(tokenAtom);
      const settings = renderedSettings(teamId);
      if (!token || !settings) {
        throw new Error("워크플로우를 갱신할 팀 설정이 없습니다.");
      }
      const remote = api();
      await remote.updateLocalTeamWorkflow(teamId, nextWorkflow);
      try {
        const result = await remote.updateTeamSettings(token, teamId, {
          ...settings,
          workflow: nextWorkflow,
        });
        commitTeamSettings(registry, teamId, result.settings);
        await Promise.all([
          refreshTeamReadiness(registry, teamId),
          refreshTeamHealth(registry),
        ]);
      } catch (caught) {
        try {
          await remote.updateLocalTeamWorkflow(teamId, previousWorkflow);
        } catch (rollbackError) {
          throw new Error(
            `워크플로우 저장에 실패했고 로컬 설정도 복구하지 못했습니다: ${messageOf(
              caught,
            )} (${messageOf(rollbackError)})`,
          );
        }
        throw caught;
      }
      return nextWorkflow;
    };

  /** The three generators differ only in which draft they produce. */
  const regenerate = async (
    teamId: string,
    unavailableMessage: string,
    missingSettingsMessage: string,
    generate: (
      previousWorkflow: WorkflowDraft,
    ) => Promise<WorkflowDraft>,
  ) => {
    if (workspaceModes(registry).demoMode) throw new Error(unavailableMessage);
    requireToken();
    const previousWorkflow = requireSettings(
      teamId,
      missingSettingsMessage,
    ).workflow;
    const nextWorkflow = await generate(previousWorkflow);
    return persistProjectWorkflow(teamId, previousWorkflow, nextWorkflow);
  };

  return {
    persistProjectWorkflow,

    regenerateWorkflow: (teamId) =>
      regenerate(
        teamId,
        "워크플로우 재생성은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
        "워크플로우를 갱신할 팀 설정이 없습니다.",
        (previousWorkflow) =>
          api().generateTeamWorkflow(teamId, previousWorkflow),
      ),

    analyzeWorkflowRequirements: (teamId, onProgress) =>
      regenerate(
        teamId,
        "필요 도구 분석은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
        "필요 도구를 분석할 팀 설정이 없습니다.",
        (previousWorkflow) =>
          api().analyzeTeamWorkflowRequirements(
            teamId,
            previousWorkflow,
            onProgress,
          ),
      ),

    reviseWorkflow: (teamId, requestedChange) =>
      regenerate(
        teamId,
        "워크플로우 수정은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
        "워크플로우를 갱신할 팀 설정이 없습니다.",
        (previousWorkflow) =>
          api().reviseTeamWorkflow(teamId, previousWorkflow, requestedChange),
      ),

    async saveCheckpointPolicy(teamId, scope, checkpoints, expectedRevision) {
      const token = requireToken();
      const settings = requireSettings(
        teamId,
        "체크포인트를 저장할 팀 설정이 없습니다.",
      );
      const result = await api().updateCheckpointPolicy(token, teamId, {
        scope,
        checkpoints,
        expectedRevision,
      });
      commitTeamSettings(registry, teamId, {
        ...settings,
        checkpointPolicy: result.checkpointPolicy,
      });
      return result.checkpointPolicy;
    },
  };
}

/**
 * Reports a failed automatic generation the way the effect that started it did:
 * as the app level error, prefixed so the user can tell it apart from a
 * generation they asked for.
 */
export function reportAutomaticWorkflowFailure(
  registry: AtomRegistry,
  caught: unknown,
): void {
  registry.set(
    sessionErrorAtom,
    `저장소 기반 워크플로우 생성에 실패했습니다: ${
      caught instanceof Error ? caught.message : String(caught)
    }`,
  );
}

export function useWorkflowActions(
  deps: WorkflowActionDeps = {},
): WorkflowActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => createWorkflowActions(registry, { api }),
    [api, registry],
  );
}
