import type { StructuredAgentResult } from "./agent-result";
import {
  agentProviderPolicies,
  agentProviders,
  modelEfforts,
  type AgentProvider,
  type ModelEffort,
} from "./agent-provider-contract";

export {
  agentProviderLabels,
  agentProviderPolicies,
  agentProviders,
  modelEfforts,
  type AgentProvider,
  type ModelEffort,
} from "./agent-provider-contract";

export type JsonSchema = Record<string, unknown> | boolean;

export const approvalPolicies = ["untrusted", "on-request", "never"] as const;
export type ApprovalPolicy = (typeof approvalPolicies)[number];

export type AppProviderSettings = Record<AgentProvider, boolean>;

export const defaultAppProviderSettings: AppProviderSettings = {
  codex: true,
  claude: true,
  grok: true,
  opencode: true,
};

export type AgentModelOption = {
  value: string;
  label: string;
};

export type AgentProviderModel = {
  id: string;
  label: string;
  isDefault?: boolean;
};

export type AgentProviderModelCatalogEntry = {
  models: AgentProviderModel[];
  error: string | null;
};

export type AgentProviderModelCatalog = Record<
  AgentProvider,
  AgentProviderModelCatalogEntry
>;

export const agentEfforts: Record<AgentProvider, readonly ModelEffort[]> = {
  codex: agentProviderPolicies.codex.efforts,
  claude: agentProviderPolicies.claude.efforts,
  grok: agentProviderPolicies.grok.efforts,
  opencode: agentProviderPolicies.opencode.efforts,
};

export const agentModels = Object.fromEntries(
  agentProviders.map((provider) => [
    provider,
    [
      { value: "", label: "Provider default" },
      ...agentProviderPolicies[provider].models.map((model) => ({
        value: model.id,
        label: model.label,
      })),
    ],
  ]),
) as Record<AgentProvider, AgentModelOption[]>;

export const defaultAgentProviderModelCatalog: AgentProviderModelCatalog =
  Object.fromEntries(
    agentProviders.map((provider) => [
      provider,
      {
        models: agentModels[provider]
          .filter((model) => model.value)
          .map((model) => ({ id: model.value, label: model.label })),
        error: null,
      },
    ]),
  ) as AgentProviderModelCatalog;

export type ProjectLlmSettings = {
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  approvalPolicy: ApprovalPolicy;
};

export type ProjectSandboxSettings = {
  fullAccess: boolean;
};

export const defaultProjectLlmSettings: ProjectLlmSettings = {
  provider: "codex",
  model: null,
  effort: null,
  approvalPolicy: "never",
};

export const defaultProjectSandboxSettings: ProjectSandboxSettings = {
  fullAccess: true,
};

export type ProjectLlmChatInput = {
  projectId: string;
  message: string;
  conversationId?: string | null;
  instructions?: string | null;
  outputSchema?: JsonSchema | null;
  fullAccess?: boolean;
  workspaceMode?:
    | "connected"
    | "latestRemoteBase"
    | "issueWorktree"
    | "issueContext";
  workspaceRunId?: string | null;
  workspaceBranch?: string | null;
  onProgress?: (progress: ProjectLlmProgress) => void;
};

export type ProjectLlmProgress = {
  provider: AgentProvider;
  messageId: string;
  phase: string | null;
  message: string;
};

type ProjectLlmProviderEvent =
  | { type: "conversationStarted"; conversationId: string }
  | { type: "messageStarted"; id: string; phase: string | null; text: string }
  | { type: "messageDelta"; id: string; delta: string }
  | { type: "messageCompleted"; id: string; phase: string | null; text: string }
  | {
      type: "activityStarted";
      id: string;
      kind: "command" | "fileChange" | "webSearch" | "tool";
      title: string;
      text: string;
    }
  | { type: "activityDelta"; id: string; delta: string }
  | {
      type: "activityCompleted";
      id: string;
      kind: "command" | "fileChange" | "webSearch" | "tool";
      title: string;
      text: string;
      status: "completed" | "failed" | "cancelled";
    }
  | { type: "turnCompleted"; status: string };

type ProjectLlmProgressPayload = {
  requestId: string;
  projectId: string;
  provider: AgentProvider;
  event: ProjectLlmProviderEvent;
};

export const projectLlmProgressEvent = "project-llm-progress";

export type ProjectLlmChatResponse = {
  conversationId: string;
  message: string;
  workspaceRoot: string;
};

export type ProjectAgentRunInput = {
  projectId: string;
  sessionId: string;
  agent: {
    id: string;
    name: string;
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    responsibility: string;
    skill: string;
  };
  message: string;
  conversationId?: string | null;
  runs?: ProjectAgentRunSnapshot[];
  resumeAfterUpdate?: boolean;
};

export type ProjectAgentRunSnapshot = {
  runId: string;
  sourceKey: string;
  title: string;
  status: string;
  currentAttempt: number;
  detail: string | null;
  resultSummary: string | null;
  updatedAt: string;
};

type ProjectAgentRunSnapshotSource = {
  id: string;
  sourceKey: string;
  title: string;
  status: string;
  currentAttempt: number;
  detail: string | null;
  resultSummary: string | null;
  updatedAt: string;
};

export function projectAgentRunSnapshots(
  runs: readonly ProjectAgentRunSnapshotSource[],
): ProjectAgentRunSnapshot[] {
  return runs
    .filter((run) => run.status === "blocked" || run.status === "failed")
    .slice(0, 500)
    .map((run) => ({
      runId: run.id,
      sourceKey: run.sourceKey,
      title: run.title,
      status: run.status,
      currentAttempt: run.currentAttempt,
      detail: run.detail,
      resultSummary: run.resultSummary,
      updatedAt: run.updatedAt,
    }));
}

export type ProjectAgentRunResponse = {
  conversationId: string;
  workspaceRoot: string;
  action: "respond" | "dispatch_auto_hunt";
  message: string;
  maxIssues: number | null;
  structuredResult: StructuredAgentResult | null;
  targetRunIds?: string[];
  retryReason?: string | null;
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * The only Briar frontend gateway for model-backed project features.
 * The native layer resolves projectId and optional issue identity to a
 * registered Git workspace and talks to the selected local agent backend;
 * callers cannot supply or override a filesystem path.
 */
export async function chatWithProjectLlm(
  input: ProjectLlmChatInput,
): Promise<ProjectLlmChatResponse> {
  if (!isTauri()) {
    throw new Error("프로젝트 LLM은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const progressId = input.onProgress
    ? globalThis.crypto?.randomUUID?.() ??
      `project-llm-${Date.now()}-${Math.random().toString(36).slice(2)}`
    : null;
  let unlisten: (() => void) | undefined;

  if (progressId && input.onProgress) {
    const { listen } = await import("@tauri-apps/api/event");
    const messages = new Map<string, string>();
    const phases = new Map<string, string | null>();
    unlisten = await listen<ProjectLlmProgressPayload>(
      projectLlmProgressEvent,
      ({ payload }) => {
        if (
          payload.requestId !== progressId ||
          payload.projectId !== input.projectId
        ) {
          return;
        }
        const { event } = payload;
        if (event.type === "messageStarted") {
          messages.set(event.id, event.text);
          phases.set(event.id, event.phase);
        } else if (event.type === "messageDelta") {
          messages.set(event.id, `${messages.get(event.id) ?? ""}${event.delta}`);
        } else if (event.type === "messageCompleted") {
          messages.set(event.id, event.text || messages.get(event.id) || "");
          phases.set(event.id, event.phase);
        } else {
          return;
        }
        const message = messages.get(event.id)?.trim();
        if (!message) return;
        input.onProgress?.({
          provider: payload.provider,
          messageId: event.id,
          phase: phases.get(event.id) ?? null,
          message,
        });
      },
    );
  }

  try {
    return await invoke<ProjectLlmChatResponse>("project_llm_chat", {
      projectId: input.projectId,
      fullAccess: input.fullAccess ?? false,
      workspaceMode: input.workspaceMode ?? "connected",
      workspaceRunId: input.workspaceRunId ?? null,
      workspaceBranch: input.workspaceBranch ?? null,
      request: {
        message: input.message,
        progressId,
        conversationId: input.conversationId ?? null,
        instructions: input.instructions ?? null,
        outputSchema: input.outputSchema ?? null,
      },
    });
  } finally {
    unlisten?.();
  }
}

/**
 * Run one turn for a saved Agent. Direct and scheduled callers provide the
 * invocation message through this same gateway. The Agent either responds in
 * this conversation or explicitly asks the Briar host to dispatch Auto Hunt;
 * it never claims queue work itself.
 */
export async function runProjectAgent(
  input: ProjectAgentRunInput,
): Promise<ProjectAgentRunResponse> {
  if (!isTauri()) {
    throw new Error("에이전트는 Briar 데스크톱 앱에서 실행할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectAgentRunResponse>("run_project_agent", {
    projectId: input.projectId,
    request: {
      sessionId: input.sessionId,
      agentId: input.agent.id,
      agentName: input.agent.name,
      agentProvider: input.agent.provider,
      agentModel: input.agent.model,
      agentEffort: input.agent.effort,
      responsibility: input.agent.responsibility,
      skill: input.agent.skill,
      message: input.message,
      conversationId: input.conversationId ?? null,
      runs: input.runs ?? [],
      resumeAfterUpdate: input.resumeAfterUpdate ?? false,
    },
  });
}

export async function stopProjectAgentSession(
  sessionId: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("stop_project_agent_session", { sessionId });
}

export async function loadProjectLlmSettings(
  projectId: string,
): Promise<ProjectLlmSettings> {
  if (!isTauri()) return defaultProjectLlmSettings;
  const { invoke } = await import("@tauri-apps/api/core");
  const settings = await invoke<ProjectLlmSettings>("load_project_llm_settings", {
    projectId,
  });
  return {
    ...settings,
    model: settings.model ?? null,
    effort: settings.effort ?? null,
  };
}

export async function loadAppProviderSettings(): Promise<AppProviderSettings> {
  if (!isTauri()) return defaultAppProviderSettings;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppProviderSettings>("load_app_provider_settings");
}

export async function loadAgentProviderModels(): Promise<AgentProviderModelCatalog> {
  if (!isTauri()) return defaultAgentProviderModelCatalog;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentProviderModelCatalog>("load_agent_provider_models");
}

export async function updateAppProviderSettings(
  settings: AppProviderSettings,
): Promise<AppProviderSettings> {
  if (!isTauri()) return settings;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppProviderSettings>("update_app_provider_settings", {
    settings,
  });
}

export async function updateProjectLlmSettings(
  projectId: string,
  settings: ProjectLlmSettings,
): Promise<ProjectLlmSettings> {
  if (!isTauri()) return settings;
  const { invoke } = await import("@tauri-apps/api/core");
  const saved = await invoke<ProjectLlmSettings>("update_project_llm_settings", {
    projectId,
    settings,
  });
  return {
    ...saved,
    model: saved.model ?? null,
    effort: saved.effort ?? null,
  };
}

export async function loadProjectSandboxSettings(
  projectId: string,
): Promise<ProjectSandboxSettings> {
  if (!isTauri()) return defaultProjectSandboxSettings;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectSandboxSettings>("load_project_sandbox_settings", {
    projectId,
  });
}

export async function updateProjectSandboxSettings(
  projectId: string,
  settings: ProjectSandboxSettings,
): Promise<ProjectSandboxSettings> {
  if (!isTauri()) return settings;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectSandboxSettings>("update_project_sandbox_settings", {
    projectId,
    settings,
  });
}
