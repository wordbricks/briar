import type { TeamAgentRunInput } from "./team-llm";
import type { ProjectAgentRunResponse } from "../generated/tauri";
import { teamAgentRunSnapshots } from "./team-llm";
import type {
  DashboardPayload,
  HuntRun,
} from "../types";
import type { StructuredAgentResult } from "./agent-result";
import { plannedUpdateContinuationMessage } from "./planned-update-recovery";

export type TeamAgentTurnDependencies<DispatchResult> = {
  runAgent: (
    input: TeamAgentRunInput,
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
export async function executeTeamAgentTurn<DispatchResult>(
  dependencies: TeamAgentTurnDependencies<DispatchResult>,
  input: TeamAgentRunInput,
) {
  const response = await dependencies.runAgent(input);
  const dispatchResult =
    response.action === "dispatch_auto_hunt"
      ? await dependencies.dispatchAutoHunt(response)
      : null;
  return { response, dispatchResult };
}

export type TeamAgentTaskSessionStart = {
  sessionId: string;
  request: string;
  skillId?: string | null;
  startedAt: string;
  isFollowUp?: boolean;
};

export type TeamAgentTaskSessionSettlement = {
  status: "completed" | "failed" | "skipped";
  conversationId: string | null;
  workspaceRoot: string | null;
  summary: string | null;
  error: string | null;
};

export function teamAgentSessionStatusForOutcome(
  outcome: StructuredAgentResult["outcome"],
): "completed" | "failed" {
  return outcome === "completed" ? "completed" : "failed";
}

export type TeamAgentTaskExecutionDependencies = {
  runAgent: (
    input: TeamAgentRunInput,
  ) => Promise<ProjectAgentRunResponse>;
  startSession: (session: TeamAgentTaskSessionStart) => void;
  settleSession: (
    sessionId: string,
    settlement: TeamAgentTaskSessionSettlement,
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
export async function executeTeamAgentTask(
  dependencies: TeamAgentTaskExecutionDependencies,
  input: {
    agent: TeamAgentRunInput["agent"];
    /** The team the task acts in, and the runs a dispatch may pick from. */
    board: Pick<DashboardPayload, "team" | "runs">;
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
    const result = await executeTeamAgentTurn(
      {
        runAgent: dependencies.runAgent,
        dispatchAutoHunt: (decision) =>
          dependencies.startAutoHunt(input.board.runs, {
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
        projectId: input.board.team.id,
        agent: input.agent,
        message: input.recoveringAfterUpdate
          ? plannedUpdateContinuationMessage(input.message)
          : input.message,
        conversationId: input.conversationId ?? null,
        sessionId,
        runs: teamAgentRunSnapshots(input.board.runs),
        resumeAfterUpdate: true,
      },
    );
    const outcome = result.response.action === "respond"
      ? result.response.structuredResult?.outcome ?? "failed"
      : "completed";
    dependencies.settleSession(sessionId, {
      status: teamAgentSessionStatusForOutcome(outcome),
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
