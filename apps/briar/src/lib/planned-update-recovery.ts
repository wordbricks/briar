import type {
  AgentProvider,
  ModelEffort,
  ProjectAgentRunInput,
  ProjectAgentRunSnapshot,
} from "./project-llm";

export type PlannedUpdateAgentRecovery = {
  version: number;
  projectId: string;
  startedAt: string;
  request: {
    sessionId: string;
    agentId: string;
    agentName: string;
    agentProvider: AgentProvider;
    agentModel: string | null;
    agentEffort: ModelEffort | null;
    responsibility: string;
    skill: string;
    message: string;
    conversationId: string | null;
    runs: ProjectAgentRunSnapshot[];
  };
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function prepareForAppUpdate(): Promise<number> {
  if (!isTauri()) return 0;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<number>("prepare_for_app_update");
}

export async function takePlannedUpdateAgentRecoveries(): Promise<
  PlannedUpdateAgentRecovery[]
> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PlannedUpdateAgentRecovery[]>(
    "take_planned_update_agent_recoveries",
  );
}

export function plannedUpdateContinuationMessage(originalRequest: string) {
  return [
    "Briar restarted briefly to install an app update while the previous turn was still running.",
    "Continue the same request from the existing conversation and workspace.",
    "First inspect the current files, Git state, and prior tool results. Do not repeat side effects or completed work. Resume only the remaining work, then validate and report the final result.",
    "",
    "Original request:",
    originalRequest,
  ].join("\n");
}

export function recoveryAgent(
  recovery: PlannedUpdateAgentRecovery,
): ProjectAgentRunInput["agent"] {
  return {
    id: recovery.request.agentId,
    name: recovery.request.agentName,
    provider: recovery.request.agentProvider,
    model: recovery.request.agentModel,
    effort: recovery.request.agentEffort,
    responsibility: recovery.request.responsibility,
    skill: recovery.request.skill,
  };
}
