import {
  dispatchAutoHuntToWorkers,
  NoQueuedAutoHuntIssuesError,
} from "./auto-hunt-worker-dispatch";
import {
  executeProjectAgentTurn,
  projectAgentSessionStatusForOutcome,
} from "./project-agent-execution";
import { projectAgentRunSnapshots } from "./project-llm";
import type {
  ProjectAgentRunInput,
  ProjectAgentRunResponse,
  ProjectLlmChatResponse,
} from "./project-llm";
import type {
  ClaimedProjectAgentScheduleRun,
  DashboardPayload,
  HuntRun,
} from "../types";
import type { StructuredAgentResult } from "./agent-result";
import type { ModelEffort } from "./project-llm";
import {
  agentWithSkillsRuntime,
} from "./project-agent";
import {
  projectSupportsExecutionSelection,
  projectWorkerCapabilityCatalog,
} from "./project-worker-capabilities";

export type ProjectAgentScheduleExecutionDependencies = {
  loadDashboard: (
    token: string,
    projectId: string,
  ) => Promise<DashboardPayload>;
  runAgent: (
    input: ProjectAgentRunInput,
  ) => Promise<ProjectAgentRunResponse>;
  retryRun: (
    token: string,
    projectId: string,
    runId: string,
    reason: string | null,
  ) => Promise<unknown>;
  dispatchRun: (
    token: string,
    projectId: string,
    run: HuntRun,
    input: {
      agentId: string;
      provider: ClaimedProjectAgentScheduleRun["agent"]["provider"];
      model: string | null;
      effort: ModelEffort | null;
      workerId: null;
      reassign: boolean;
    },
  ) => Promise<unknown>;
  startSession?: (
    run: ClaimedProjectAgentScheduleRun,
  ) => string | null;
  settleSession?: (
    sessionId: string,
    input: {
      status: "completed" | "failed" | "skipped";
      conversationId: string | null;
      workspaceRoot: string | null;
      summary: string | null;
      error: string | null;
    },
  ) => void;
  startWorkerDispatchSession?: (
    parentSessionId: string,
    run: ClaimedProjectAgentScheduleRun,
    runs: readonly HuntRun[],
    dispatch: { dispatchId: string; runIds: string[] },
  ) => void;
};

/**
 * Run a schedule exactly like a direct saved-Agent turn. The schedule supplies
 * the invocation message, and the Agent remains responsible for selecting
 * `respond` or `dispatch_auto_hunt`.
 */
export async function executeScheduledProjectAgent(
  dependencies: ProjectAgentScheduleExecutionDependencies,
  token: string,
  run: ClaimedProjectAgentScheduleRun,
): Promise<
  ProjectLlmChatResponse & { structuredResult: StructuredAgentResult }
> {
  const sessionId = dependencies.startSession?.(run) ?? null;
  const runtimeAgent = agentWithSkillsRuntime(run.agent);
  try {
    const initialDashboard = await dependencies.loadDashboard(
      token,
      run.projectId,
    );
    let dispatchRuns = initialDashboard.runs;
    let skippedNoQueuedDispatch = false;
    const { response, dispatchResult } = await executeProjectAgentTurn(
      {
        runAgent: dependencies.runAgent,
        dispatchAutoHunt: async (decision) => {
          const dashboard = decision.targetRunIds?.length
            ? initialDashboard
            : await dependencies.loadDashboard(token, run.projectId);
          dispatchRuns = dashboard.runs;
          try {
            return await dispatchAutoHuntToWorkers(
              {
                dispatch: (candidate, dispatchInput) =>
                  dependencies.dispatchRun(
                    token,
                    run.projectId,
                    candidate,
                    dispatchInput,
                  ),
                retry: (candidate, reason) =>
                  dependencies.retryRun(
                    token,
                    run.projectId,
                    candidate.id,
                    reason,
                  ),
              },
              {
                agent: runtimeAgent,
                runs: dashboard.runs,
                providerModels: projectWorkerCapabilityCatalog(
                  dashboard.workers ?? [],
                  dashboard.executionPolicy,
                ),
                selectionAvailable: (selection) =>
                  projectSupportsExecutionSelection(
                    dashboard.workers ?? [],
                    dashboard.executionPolicy,
                    selection.provider,
                    selection.model,
                    selection.effort,
                  ),
                maxIssues: decision.maxIssues ?? undefined,
                targetRunIds: decision.targetRunIds ?? undefined,
                retryReason: decision.retryReason,
              },
            );
          } catch (caught) {
            if (
              caught instanceof NoQueuedAutoHuntIssuesError &&
              !dashboard.runs.some((candidate) => candidate.status === "queued")
            ) {
              skippedNoQueuedDispatch = true;
              return null;
            }
            throw caught;
          }
        },
      },
      {
        projectId: run.projectId,
        sessionId: sessionId ?? crypto.randomUUID(),
        agent: runtimeAgent,
        message: [
          `Run the scheduled automation "${run.scheduleName}".`,
          `It was scheduled for ${run.scheduledFor}.`,
          "Fulfill your saved responsibility for this scheduled run:",
          run.agent.responsibility,
        ].join("\n"),
        conversationId: null,
        runs: projectAgentRunSnapshots(initialDashboard.runs),
      },
    );
    let result: ProjectLlmChatResponse & {
      structuredResult: StructuredAgentResult;
    };
    if (skippedNoQueuedDispatch) {
      const summary = "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.";
      result = {
        conversationId: response.conversationId,
        message: summary,
        workspaceRoot: response.workspaceRoot,
        structuredResult: {
          summary,
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
      };
    } else if (dispatchResult === null) {
      if (!response.structuredResult) {
        throw new Error("에이전트가 구조화된 실행 결과를 제출하지 않았습니다.");
      }
      result = {
        conversationId: response.conversationId,
        message: response.message,
        workspaceRoot: response.workspaceRoot,
        structuredResult: response.structuredResult,
      };
    } else {
      if (sessionId) {
        dependencies.startWorkerDispatchSession?.(
          sessionId,
          run,
          dispatchRuns,
          dispatchResult,
        );
      }
      const dispatchedCount = dispatchResult.runIds.length;
      const summary = `${dispatchedCount}개 이슈를 등록 Worker에 배정했습니다.`;
      result = {
        conversationId: response.conversationId,
        message: summary,
        workspaceRoot: response.workspaceRoot,
        structuredResult: {
          summary,
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: dispatchedCount > 1 ? "project" : "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
      };
    }
    if (sessionId) {
      dependencies.settleSession?.(sessionId, {
        status: skippedNoQueuedDispatch
          ? "skipped"
          : projectAgentSessionStatusForOutcome(result.structuredResult.outcome),
        conversationId: result.conversationId,
        workspaceRoot: result.workspaceRoot,
        summary: result.message,
        error: null,
      });
    }
    return result;
  } catch (caught) {
    if (sessionId) {
      dependencies.settleSession?.(sessionId, {
        status: "failed",
        conversationId: null,
        workspaceRoot: null,
        summary: null,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
    throw caught;
  }
}
