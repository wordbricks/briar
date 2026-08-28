import type { StructuredAgentResult } from "./agent-result";
import {
  emptyAgentProviderCapabilityCatalog,
  type AgentProviderCapabilityCatalog,
  type AgentModelCapability,
  type ModelEffort,
} from "./agent-provider-contract";
import {
  agentProviders,
  sortAgentProviders,
  type AgentProvider,
} from "./agent-provider";
import {
  commands,
  events,
  type AppProviderSettings,
  type ApprovalPolicy,
  type JsonValue,
  type OpenRouterCredentialStatus,
  type ProjectAgentRunResponse,
  type ProjectAgentRunSnapshot,
  type ProjectLlmProgressPayload,
  type ProjectLlmResponse,
  type ProjectSandboxSettings,
} from "../generated/tauri";

export {
  agentProviderLabels,
  agentProviders,
  sortAgentProviders,
  type AgentProvider,
} from "./agent-provider";
export type { ModelEffort } from "./agent-provider-contract";

export type JsonSchema = Record<string, unknown> | boolean;

export const approvalPolicies = ["untrusted", "on-request", "never"] as const;

export const defaultAppProviderSettings = {
  codex: true,
  claude: true,
  cursor: true,
  grok: true,
  agy: true,
  opencode: true,
  openrouter: true,
} satisfies AppProviderSettings;

export type AgentModelOption = {
  value: string;
  label: string;
};

export type AgentProviderModel = AgentModelCapability;
export type AgentProviderModelCatalogEntry =
  AgentProviderCapabilityCatalog[AgentProvider];
export type AgentProviderModelCatalog = AgentProviderCapabilityCatalog;

export const defaultAgentProviderModelCatalog: AgentProviderModelCatalog =
  emptyAgentProviderCapabilityCatalog();

const effortMenuPositions = new Map(
  ["low", "medium", "high", "xhigh", "max", "ultra"].map(
    (effort, index) => [effort, index],
  ),
);

function compareMenuText(left: string, right: string) {
  const leftFolded = left.normalize("NFKD").toLocaleLowerCase("en-US");
  const rightFolded = right.normalize("NFKD").toLocaleLowerCase("en-US");
  return leftFolded < rightFolded
    ? -1
    : leftFolded > rightFolded
      ? 1
      : left < right
        ? -1
        : left > right
          ? 1
          : 0;
}

function compareAgentModels(
  left: Pick<AgentModelCapability, "id" | "label">,
  right: Pick<AgentModelCapability, "id" | "label">,
) {
  return compareMenuText(left.label, right.label) ||
    compareMenuText(left.id, right.id);
}

export function sortAgentModelsByPreference<T extends { id: string }>(
  models: readonly T[],
  favoriteModels: readonly string[] = [],
): T[] {
  const favoriteOrder = new Map(
    favoriteModels.map((model, index) => [model, index]),
  );
  return models
    .map((model) => ({ model }))
    .sort((left, right) => {
      const leftFavorite = favoriteOrder.get(left.model.id);
      const rightFavorite = favoriteOrder.get(right.model.id);
      if (leftFavorite !== undefined && rightFavorite !== undefined) {
        return leftFavorite - rightFavorite;
      }
      if (leftFavorite !== undefined) return -1;
      if (rightFavorite !== undefined) return 1;
      if ("label" in left.model && "label" in right.model) {
        return compareAgentModels(
          left.model as T & { label: string },
          right.model as T & { label: string },
        );
      }
      return compareMenuText(left.model.id, right.model.id);
    })
    .map(({ model }) => model);
}

export function agentModelOptions(
  catalog: AgentProviderModelCatalog,
  provider: AgentProvider,
  providerDefaultLabel: string,
  selectedModel?: string | null,
  favoriteModels: readonly string[] = [],
) {
  const options = [
    { value: "", label: providerDefaultLabel },
    ...sortAgentModelsByPreference(
      catalog[provider].models,
      favoriteModels,
    ).map((model) => ({
      value: model.id,
      label: model.label,
      description: model.label === model.id ? undefined : model.id,
    })),
  ];
  return selectedModel && !options.some((option) => option.value === selectedModel)
    ? [{ value: selectedModel, label: selectedModel }, ...options]
    : options;
}

export function agentModelDisplayName(
  catalog: AgentProviderModelCatalog,
  provider: AgentProvider,
  model: string,
) {
  return (
    catalog[provider].models.find((candidate) => candidate.id === model)?.label ??
    model
  );
}

export function agentEffortOptions(
  catalog: AgentProviderModelCatalog,
  provider: AgentProvider,
  model?: string | null,
  selectedEffort?: string | null,
) {
  const entry = catalog[provider];
  const reportedModel = model
    ? entry.models.find((candidate) => candidate.id === model)
    : entry.models.find((candidate) => candidate.isDefault);
  const efforts = reportedModel?.efforts?.length
    ? reportedModel.efforts
    : (entry.defaultEfforts ?? []);
  const options = [...efforts].sort((left, right) => {
    const leftPosition = effortMenuPositions.get(left.id);
    const rightPosition = effortMenuPositions.get(right.id);
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return compareMenuText(left.label, right.label) ||
      compareMenuText(left.id, right.id);
  }).map((effort) => ({
    value: effort.id,
    label: effort.label,
    description: effort.description ?? undefined,
  }));
  return selectedEffort && !options.some((option) => option.value === selectedEffort)
    ? [{ value: selectedEffort, label: selectedEffort }, ...options]
    : options;
}

let agentProviderModelsRequest: Promise<AgentProviderModelCatalog> | null = null;

export type ProjectLlmSettings = {
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  approvalPolicy: ApprovalPolicy;
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
  activityKind?: "command" | "fileChange" | "webSearch" | "tool";
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

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const projectLlmChatRequest = (
  input: ProjectLlmChatInput,
  progressId: string | null,
) => ({
  message: input.message,
  progressId,
  conversationId: input.conversationId ?? null,
  instructions: input.instructions ?? null,
  outputSchema:
    input.outputSchema === undefined || input.outputSchema === null
      ? null
      : JSON.parse(JSON.stringify(input.outputSchema)) as JsonValue,
});

export const projectAgentRunRequest = (input: ProjectAgentRunInput) => ({
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
});

/**
 * The only Briar frontend gateway for model-backed project features.
 * The native layer resolves projectId and optional issue identity to a
 * registered Git workspace and talks to the selected local agent backend;
 * callers cannot supply or override a filesystem path.
 */
export async function chatWithProjectLlm(
  input: ProjectLlmChatInput,
): Promise<ProjectLlmResponse> {
  if (!isTauri()) {
    throw new Error("프로젝트 LLM은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const progressId = input.onProgress
    ? globalThis.crypto?.randomUUID?.() ??
      `project-llm-${Date.now()}-${Math.random().toString(36).slice(2)}`
    : null;
  let unlisten: (() => void) | undefined;

  if (progressId && input.onProgress) {
    const messages = new Map<string, string>();
    const phases = new Map<string, string | null>();
    unlisten = await events.projectLlmProgress.listen(
      ({ payload }) => {
        if (
          payload.requestId !== progressId ||
          payload.projectId !== input.projectId
        ) {
          return;
        }
        const { event } = payload;
        if (
          event.type === "activityStarted" ||
          event.type === "activityCompleted"
        ) {
          const message = event.title.trim() || event.text.trim();
          input.onProgress?.({
            provider: payload.provider,
            messageId: event.id,
            phase: "activity",
            message: message || event.kind,
            activityKind: event.kind,
          });
          return;
        }
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
    return await commands.projectLlmChat(
      input.projectId,
      input.fullAccess ?? false,
      input.workspaceMode ?? "connected",
      input.workspaceRunId ?? null,
      input.workspaceBranch ?? null,
      projectLlmChatRequest(input, progressId),
    );
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
  return commands.runProjectAgent(
    input.projectId,
    projectAgentRunRequest(input),
  );
}

export async function stopProjectAgentSession(
  sessionId: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  return commands.stopProjectAgentSession(sessionId);
}

export async function loadProjectLlmSettings(
  projectId: string,
): Promise<ProjectLlmSettings> {
  if (!isTauri()) return defaultProjectLlmSettings;
  const settings = await commands.loadProjectLlmSettings(projectId);
  return {
    ...settings,
    model: settings.model ?? null,
    effort: settings.effort ?? null,
  };
}

export async function loadAppProviderSettings(): Promise<AppProviderSettings> {
  if (!isTauri()) return defaultAppProviderSettings;
  return commands.loadAppProviderSettings();
}

export function loadAgentProviderModels({
  refresh = false,
}: {
  refresh?: boolean;
} = {}): Promise<AgentProviderModelCatalog> {
  if (!isTauri()) return Promise.resolve(defaultAgentProviderModelCatalog);
  if (!refresh && agentProviderModelsRequest) return agentProviderModelsRequest;

  const request: Promise<AgentProviderModelCatalog> = commands
    .loadAgentProviderModels()
    .catch((error) => {
      if (agentProviderModelsRequest === request) {
        agentProviderModelsRequest = null;
      }
      throw error;
    });
  agentProviderModelsRequest = request;
  return request;
}

export async function updateAppProviderSettings(
  settings: AppProviderSettings,
): Promise<AppProviderSettings> {
  if (!isTauri()) return settings;
  return commands.updateAppProviderSettings(settings);
}

export async function loadOpenRouterCredentialStatus(): Promise<OpenRouterCredentialStatus> {
  if (!isTauri()) return { configured: false };
  return commands.loadOpenrouterCredentialStatus();
}

export async function updateOpenRouterApiKey(
  apiKey: string | null,
): Promise<OpenRouterCredentialStatus> {
  if (!isTauri()) return { configured: Boolean(apiKey?.trim()) };
  return commands.updateOpenrouterApiKey(apiKey);
}

export async function updateProjectLlmSettings(
  projectId: string,
  settings: ProjectLlmSettings,
): Promise<ProjectLlmSettings> {
  if (!isTauri()) return settings;
  const saved = await commands.updateProjectLlmSettings(projectId, settings);
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
  return commands.loadProjectSandboxSettings(projectId);
}

export async function updateProjectSandboxSettings(
  projectId: string,
  settings: ProjectSandboxSettings,
): Promise<ProjectSandboxSettings> {
  if (!isTauri()) return settings;
  return commands.updateProjectSandboxSettings(projectId, settings);
}
