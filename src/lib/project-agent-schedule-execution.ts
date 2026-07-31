import { dispatchAutoHuntToWorkers } from "./auto-hunt-worker-dispatch";
import { executeProjectAgentTurn } from "./project-agent-execution";
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
      status: "completed" | "failed";
      conversationId: string | null;
      workspaceRoot: string | null;
      summary: string | null;
      error: string | null;
    },
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
  try {
    const initialDashboard = await dependencies.loadDashboard(
      token,
      run.projectId,
    );
    const { response, dispatchResult } = await executeProjectAgentTurn(
      {
        runAgent: dependencies.runAgent,
        dispatchAutoHunt: async (decision) => {
          const dashboard = decision.targetRunIds?.length
            ? initialDashboard
            : await dependencies.loadDashboard(token, run.projectId);
          return dispatchAutoHuntToWorkers(
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
              agent: run.agent,
              runs: dashboard.runs,
              maxIssues: decision.maxIssues ?? undefined,
              targetRunIds: decision.targetRunIds ?? undefined,
              retryReason: decision.retryReason,
            },
          );
        },
      },
      {
        projectId: run.projectId,
        sessionId: sessionId ?? crypto.randomUUID(),
        agent: run.agent,
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
    if (dispatchResult === null) {
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
        status: "completed",
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
