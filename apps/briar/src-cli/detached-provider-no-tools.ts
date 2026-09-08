import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { DetachedProviderTurnInput, DetachedProviderTurnResult } from "./detached-provider-turn";
import { supportsDetachedProviderClassification } from "../src/lib/detached-provider-capabilities";
import { runCodexClassificationTurn } from "./codex-classification-turn";

/** Call the SDK directly so an older runner bundle cannot ignore the tool restriction. */
export async function runDetachedProviderClassification(
  input: DetachedProviderTurnInput,
  invoke: typeof query = query,
): Promise<DetachedProviderTurnResult> {
  if (!supportsDetachedProviderClassification(input.agent.provider)) {
    throw new Error("detached_provider_no_tools_unsupported");
  }
  if (input.fullAccess || !input.readOnly || input.conversationId || input.attachments?.length ||
    input.organizationContextManifestPath || input.delegationTargets?.length || input.skillCatalog ||
    input.computerUseBinding || input.dmMessagePublicationBinding || input.runKind === "computerUse") {
    throw new Error("detached_provider_no_tools_invalid_context");
  }
  input.signal.throwIfAborted();
  if (input.agent.provider === "codex") return runCodexClassificationTurn(input);
  const abortController = new AbortController();
  const abort = () => abortController.abort(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  const options: Options = {
    cwd: input.workspacePath,
    env: input.environment,
    abortController,
    tools: [],
    allowedTools: [],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [],
    skills: [],
    plugins: [],
    permissionMode: "dontAsk",
    canUseTool: async () => ({ behavior: "deny", message: "Tools are disabled for this turn." }),
    systemPrompt: input.agent.responsibility,
    ...(input.agent.model ? { model: input.agent.model } : {}),
    ...(input.agent.effort ? { effort: input.agent.effort as Options["effort"] } : {}),
    ...(input.outputSchema != null ? { outputFormat: { type: "json_schema", schema:
      typeof input.outputSchema === "boolean" ? input.outputSchema ? {} : { not: {} } : input.outputSchema } } : {}),
  };
  try {
    const response = invoke({ prompt: input.prompt, options });
    try {
      for await (const message of response) {
        input.signal.throwIfAborted();
        if (message.type !== "result") continue;
        if (message.subtype !== "success") throw new Error("detached_provider_no_tools_failed");
        return { completed: true, exitCode: 0, stderr: "", runnerError: null,
          resultText: message.structured_output === undefined ? message.result : JSON.stringify(message.structured_output),
          conversationId: null };
      }
      throw new Error("detached_provider_no_tools_missing_result");
    } finally { response.close(); }
  } finally { input.signal.removeEventListener("abort", abort); }
}
