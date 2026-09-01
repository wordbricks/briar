import type { ProjectAgentRunInput } from "./project-llm";
import {
  commands,
  type PlannedUpdateAgentRecovery,
} from "../generated/tauri";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function prepareForAppUpdate(): Promise<number> {
  if (!isTauri()) return 0;
  return commands.prepareForAppUpdate();
}

export async function takePlannedUpdateAgentRecoveries(): Promise<
  PlannedUpdateAgentRecovery[]
> {
  if (!isTauri()) return [];
  return commands.takePlannedUpdateAgentRecoveries();
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
    effort: recovery.request.agentEffort ?? null,
    responsibility: recovery.request.responsibility,
    skill: recovery.request.skill,
  };
}
