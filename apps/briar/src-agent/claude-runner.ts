import {
  query,
  type CanUseTool,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  approvalResult,
  claudeOptions,
  claudePrompt,
  createClaudeEventState,
  normalizeClaudeMessage,
  type ClaudeRunnerOutput,
} from "./claude-runner-lib";
import { createRunnerIo } from "./runner-io";

const runnerIo = createRunnerIo<ClaudeRunnerOutput>({
  closeError: "Briar closed the Claude runner input.",
});
const { emit, request: requestPromise, waitForApproval } = runnerIo;

async function main() {
  const request = await requestPromise;
  let approvalSequence = 0;
  const canUseTool: CanUseTool = async (toolName, input, options) => {
    const id = String(++approvalSequence);
    emit({
      type: "approval",
      id,
      toolName,
      input,
      ...(options.title ? { title: options.title } : {}),
    });
    const approved = await waitForApproval(id, options.signal);
    return approvalResult(approved, input);
  };
  const state = createClaudeEventState();
  let result:
    | Extract<SDKMessage, { type: "result"; subtype: "success" }>
    | undefined;

  for await (const message of query({
    prompt:
      request.attachments?.length
        ? claudePrompt(request)
        : request.message,
    options: claudeOptions(request, canUseTool),
  })) {
    if (message.type === "system" && message.subtype === "init") {
      const sessionId = (message as unknown as { session_id?: unknown }).session_id;
      if (typeof sessionId === "string" && sessionId.trim()) {
        emit({ type: "session", sessionId });
      }
    }
    const normalizedEvents = normalizeClaudeMessage(message, state);
    if (normalizedEvents.length === 0) {
      emit({ type: "event", raw: message });
    } else {
      for (const event of normalizedEvents) {
        emit({ type: "event", raw: message, event });
      }
    }
    if (message.type === "result") {
      if (message.subtype !== "success") {
        throw new Error(
          message.errors.join("\n") || `Claude failed: ${message.subtype}`,
        );
      }
      result = message;
    }
  }

  if (!result) {
    throw new Error("Claude completed without a result message.");
  }
  emit({
    type: "result",
    sessionId: result.session_id,
    message:
      result.structured_output === undefined
        ? result.result
        : JSON.stringify(result.structured_output),
  });
}

void main()
  .catch((caught) => {
    emit({
      type: "error",
      message: caught instanceof Error ? caught.message : String(caught),
    });
    process.exitCode = 1;
  })
  .finally(runnerIo.close);
