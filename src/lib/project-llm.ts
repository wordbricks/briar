export type JsonSchema = Record<string, unknown> | boolean;

export const approvalPolicies = ["untrusted", "on-request", "never"] as const;
export type ApprovalPolicy = (typeof approvalPolicies)[number];

export type ProjectLlmSettings = {
  approvalPolicy: ApprovalPolicy;
};

export const defaultProjectLlmSettings: ProjectLlmSettings = {
  approvalPolicy: "never",
};

export type ProjectLlmChatInput = {
  projectId: string;
  message: string;
  conversationId?: string | null;
  instructions?: string | null;
  outputSchema?: JsonSchema | null;
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
 * Codex App Server; callers cannot supply or override a filesystem workspace.
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
  return invoke<ProjectLlmSettings>("load_project_llm_settings", { projectId });
}

export async function updateProjectLlmSettings(
  projectId: string,
  settings: ProjectLlmSettings,
): Promise<ProjectLlmSettings> {
  if (!isTauri()) return settings;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectLlmSettings>("update_project_llm_settings", {
    projectId,
    settings,
  });
}

/**
 * Creates a stateful project chat while keeping the Codex thread id opaque.
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
