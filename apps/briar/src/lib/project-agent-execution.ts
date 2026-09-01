import type { ProjectAgentRunInput } from "./project-llm";
import type { ProjectAgentRunResponse } from "../generated/tauri";
import { projectAgentRunSnapshots } from "./project-llm";
import type {
  DashboardPayload,
  HuntRun,
} from "../types";
import type { StructuredAgentResult } from "./agent-result";
import { plannedUpdateContinuationMessage } from "./planned-update-recovery";

export type ProjectAgentTurnDependencies<DispatchResult> = {
  runAgent: (
    input: ProjectAgentRunInput,
  ) => Promise<ProjectAgentRunResponse>;
  dispatchAutoHunt: (
    response: ProjectAgentRunResponse,
  ) => DispatchResult | Promise<DispatchResult>;
};

/**
 * Execute a saved Agent turn and honor the action selected by that Agent.
 *
 * Manual and scheduled invocations share this decision boundary: the caller
 * supplies the message, while the saved Agent decides whether to respond in
 * place or hand Auto Hunt to the trusted local dispatcher.
 */
export async function executeProjectAgentTurn<DispatchResult>(
  dependencies: ProjectAgentTurnDependencies<DispatchResult>,
  input: ProjectAgentRunInput,
) {
  const response = await dependencies.runAgent(input);
  const dispatchResult =
    response.action === "dispatch_auto_hunt"
      ? await dependencies.dispatchAutoHunt(response)
      : null;
  return { response, dispatchResult };
}

export type ProjectAgentTaskSessionStart = {
  sessionId: string;
  request: string;
  skillId?: string | null;
  startedAt: string;
  isFollowUp?: boolean;
};

export type ProjectAgentTaskSessionSettlement = {
  status: "completed" | "failed" | "skipped";
  conversationId: string | null;
  workspaceRoot: string | null;
  summary: string | null;
  error: string | null;
};

export function projectAgentSessionStatusForOutcome(
  outcome: StructuredAgentResult["outcome"],
): "completed" | "failed" {
  return outcome === "completed" ? "completed" : "failed";
}

export type ProjectAgentTaskExecutionDependencies = {
  runAgent: (
    input: ProjectAgentRunInput,
  ) => Promise<ProjectAgentRunResponse>;
  startSession: (session: ProjectAgentTaskSessionStart) => void;
  settleSession: (
    sessionId: string,
    settlement: ProjectAgentTaskSessionSettlement,
  ) => void;
  startAutoHunt: (
    runs: HuntRun[],
    options: {
      coordinatorConversationId?: string | null;
      parentSessionId?: string;
      maxIssues?: number;
      targetRunIds?: string[];
      retryReason?: string | null;
    },
  ) => string | Promise<string>;
};

/**
 * Run a direct saved-Agent task and record its complete session lifecycle.
 *
 * Both the list-page quick action and the detail-page composer use this path,
 * so an Agent always gets the same decision and Auto Hunt dispatch behavior.
 */
export async function executeProjectAgentTask(
  dependencies: ProjectAgentTaskExecutionDependencies,
  input: {
    agent: ProjectAgentRunInput["agent"];
    dashboard: DashboardPayload;
    message: string;
    skillId?: string | null;
    sessionId?: string;
    startedAt?: string;
    conversationId?: string | null;
    workspaceRoot?: string | null;
    recoveringAfterUpdate?: boolean;
    isFollowUp?: boolean;
  },
) {
  const sessionId = input.sessionId ?? crypto.randomUUID();
  const startedAt = input.startedAt ?? new Date().toISOString();
  let sessionStarted = false;

  try {
    dependencies.startSession({
      sessionId,
      request: input.message,
      skillId: input.skillId,
      startedAt,
      isFollowUp: input.isFollowUp,
    });
    sessionStarted = true;
    const result = await executeProjectAgentTurn(
      {
        runAgent: dependencies.runAgent,
        dispatchAutoHunt: (decision) =>
          dependencies.startAutoHunt(input.dashboard.runs, {
            coordinatorConversationId: decision.conversationId,
            parentSessionId: sessionId,
            maxIssues: decision.maxIssues ?? undefined,
            ...(decision.targetRunIds?.length
              ? {
                  targetRunIds: decision.targetRunIds,
                  retryReason: decision.retryReason,
                }
              : {}),
          }),
      },
      {
        projectId: input.dashboard.project.id,
        agent: input.agent,
        message: input.recoveringAfterUpdate
          ? plannedUpdateContinuationMessage(input.message)
          : input.message,
        conversationId: input.conversationId ?? null,
        sessionId,
        runs: projectAgentRunSnapshots(input.dashboard.runs),
        resumeAfterUpdate: true,
      },
    );
    const outcome = result.response.action === "respond"
      ? result.response.structuredResult?.outcome ?? "failed"
      : "completed";
    dependencies.settleSession(sessionId, {
      status: projectAgentSessionStatusForOutcome(outcome),
      conversationId: result.response.conversationId,
      workspaceRoot: result.response.workspaceRoot,
      summary: result.response.message,
      error: null,
    });
    return { sessionId, ...result };
  } catch (caught) {
    if (sessionStarted) {
      dependencies.settleSession(sessionId, {
        status: "failed",
        conversationId: input.conversationId ?? null,
        workspaceRoot: input.workspaceRoot ?? null,
        summary: null,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
    throw caught;
  }
}
