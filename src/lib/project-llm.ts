export type JsonSchema = Record<string, unknown> | boolean;

export const approvalPolicies = ["untrusted", "on-request", "never"] as const;
export type ApprovalPolicy = (typeof approvalPolicies)[number];

export const agentProviders = ["codex", "claude", "grok"] as const;
export type AgentProvider = (typeof agentProviders)[number];

export type AppProviderSettings = Record<AgentProvider, boolean>;

export const defaultAppProviderSettings: AppProviderSettings = {
  codex: true,
  claude: true,
  grok: true,
};

export type AgentModelOption = {
  value: string;
  label: string;
};

export const modelEfforts = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type ModelEffort = (typeof modelEfforts)[number];

export const agentEfforts: Record<AgentProvider, readonly ModelEffort[]> = {
  codex: modelEfforts,
  claude: modelEfforts.filter((effort) => effort !== "ultra"),
  grok: modelEfforts.filter(
    (effort) => effort !== "ultra" && effort !== "xhigh" && effort !== "max",
  ),
};

export const agentModels: Record<AgentProvider, AgentModelOption[]> = {
  codex: [
    { value: "", label: "Provider default" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
  claude: [
    { value: "", label: "Provider default" },
    { value: "sonnet", label: "Claude Sonnet" },
    { value: "opus", label: "Claude Opus" },
    { value: "haiku", label: "Claude Haiku" },
    { value: "fable", label: "Claude Fable" },
  ],
  grok: [
    { value: "", label: "Provider default" },
    { value: "grok-4.5", label: "Grok 4.5" },
    { value: "grok-build", label: "Grok Build" },
  ],
};

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

export type ProjectLlmChatInput = {
  projectId: string;
  message: string;
  conversationId?: string | null;
  instructions?: string | null;
  outputSchema?: JsonSchema | null;
  fullAccess?: boolean;
  workspaceMode?: "connected" | "latestRemoteBase";
};

export type ProjectLlmChatResponse = {
  conversationId: string;
  message: string;
  workspaceRoot: string;
};

export type ProjectChatMessage = {
  message: string;
  instructions?: string | null;
  outputSchema?: JsonSchema | null;
};

export type ProjectChat = {
  readonly projectId: string;
  readonly conversationId: string | null;
  send(input: string | ProjectChatMessage): Promise<ProjectLlmChatResponse>;
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * The only Briar frontend gateway for model-backed project features.
 * The native layer resolves projectId to the connected Git root and talks to
 * the selected local agent backend; callers cannot supply or override a
 * filesystem workspace.
 */
export async function chatWithProjectLlm(
  input: ProjectLlmChatInput,
): Promise<ProjectLlmChatResponse> {
  if (!isTauri()) {
    throw new Error("프로젝트 LLM은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectLlmChatResponse>("project_llm_chat", {
    projectId: input.projectId,
    fullAccess: input.fullAccess ?? false,
    workspaceMode: input.workspaceMode ?? "connected",
    request: {
      message: input.message,
      conversationId: input.conversationId ?? null,
      instructions: input.instructions ?? null,
      outputSchema: input.outputSchema ?? null,
    },
  });
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

/**
 * Creates a stateful project chat while keeping the provider conversation id opaque.
 * Sends are serialized so two turns cannot race on the same conversation.
 */
export function createProjectChat(
  projectId: string,
  conversationId: string | null = null,
): ProjectChat {
  let activeConversationId = conversationId;
  let queue: Promise<void> = Promise.resolve();

  return {
    projectId,
    get conversationId() {
      return activeConversationId;
    },
    send(input) {
      const message = typeof input === "string" ? { message: input } : input;
      const pending = queue.then(async () => {
        const response = await chatWithProjectLlm({
          projectId,
          conversationId: activeConversationId,
          ...message,
        });
        activeConversationId = response.conversationId;
        return response;
      });
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  };
}
