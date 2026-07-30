import type { AutoHuntAgentResponse } from "./auto-hunt-agent";
import {
  defaultAutoHuntMaxIssues,
  selectAutoHuntCandidates,
} from "./auto-hunt-automation";
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
  startAutoHunt: (
    projectId: string,
    issues: HuntRun[],
    sessionId: string,
    agent: ClaimedProjectAgentScheduleRun["agent"],
    options: {
      coordinatorConversationId: string;
    },
  ) => Promise<AutoHuntAgentResponse>;
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
          const targetRunIds = decision.targetRunIds ?? [];
          for (const runId of targetRunIds) {
            await dependencies.retryRun(
              token,
              run.projectId,
              runId,
              decision.retryReason ?? null,
            );
          }
          const dashboard = await dependencies.loadDashboard(
            token,
            run.projectId,
          );
          const availableRuns =
            targetRunIds.length === 0
              ? dashboard.runs
              : dashboard.runs.filter((candidate) =>
                  targetRunIds.includes(candidate.id)
                );
          const candidates = selectAutoHuntCandidates(
            availableRuns,
            targetRunIds.length > 0
              ? targetRunIds.length
              : decision.maxIssues ?? defaultAutoHuntMaxIssues,
          );
          if (candidates.length === 0) {
            throw new Error("대기 상태인 이슈가 없습니다.");
          }
          return dependencies.startAutoHunt(
            run.projectId,
            candidates,
            crypto.randomUUID(),
            run.agent,
            { coordinatorConversationId: decision.conversationId },
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
      const needsAction = dispatchResult.result.issues.some((issue) =>
        ["blocked", "failed"].includes(issue.outcome),
      );
      const completedCount = dispatchResult.result.issues.filter(
        (issue) => issue.outcome === "completed",
      ).length;
      const outcome: StructuredAgentResult["outcome"] = needsAction
        ? completedCount > 0
          ? "partial"
          : dispatchResult.result.issues.some(
                (issue) => issue.outcome === "failed",
              )
            ? "failed"
            : "blocked"
        : "completed";
      result = {
          conversationId: dispatchResult.conversationId,
          message: dispatchResult.result.summary,
          workspaceRoot: dispatchResult.workspaceRoot,
          structuredResult: {
            summary: dispatchResult.result.summary,
            outcome,
            importance: needsAction ? "important" : "routine",
            urgency: needsAction ? "time_sensitive" : "normal",
            impact:
              dispatchResult.result.issues.length > 1 ? "project" : "issue",
            humanActionRequired: needsAction,
            nextAction: needsAction
              ? "차단되거나 실패한 이슈를 확인하고 후속 조치를 결정하세요."
              : null,
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
