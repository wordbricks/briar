import type { AutoHuntAgentResponse } from "./auto-hunt-agent";
import {
  defaultAutoHuntMaxIssues,
  selectAutoHuntCandidates,
} from "./auto-hunt-automation";
import { executeProjectAgentTurn } from "./project-agent-execution";
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

export type ProjectAgentScheduleExecutionDependencies = {
  loadDashboard: (
    token: string,
    projectId: string,
  ) => Promise<DashboardPayload>;
  runAgent: (
    input: ProjectAgentRunInput,
  ) => Promise<ProjectAgentRunResponse>;
  startAutoHunt: (
    projectId: string,
    issues: HuntRun[],
    sessionId: string,
    agent: ClaimedProjectAgentScheduleRun["agent"],
    options: {
      coordinatorConversationId: string;
    },
  ) => Promise<AutoHuntAgentResponse>;
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
): Promise<ProjectLlmChatResponse> {
  const { response, dispatchResult } = await executeProjectAgentTurn(
    {
      runAgent: dependencies.runAgent,
      dispatchAutoHunt: async (decision) => {
        const dashboard = await dependencies.loadDashboard(
          token,
          run.projectId,
        );
        const candidates = selectAutoHuntCandidates(
          dashboard.runs,
          decision.maxIssues ?? defaultAutoHuntMaxIssues,
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
      sessionId: crypto.randomUUID(),
      agent: run.agent,
      message: [
        `Run the scheduled automation "${run.scheduleName}".`,
        `It was scheduled for ${run.scheduledFor}.`,
        "Fulfill your saved responsibility for this scheduled run:",
        run.agent.responsibility,
      ].join("\n"),
      conversationId: null,
    },
  );
  if (dispatchResult === null) return response;
  return {
    conversationId: dispatchResult.conversationId,
    message: dispatchResult.result.summary,
    workspaceRoot: dispatchResult.workspaceRoot,
  };
}
