import {
  query,
  type CanUseTool,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  approvalResult,
  claudeOptions,
  claudePrompt,
  claudeResultBlock,
  createClaudeEventState,
  createClaudeFailureState,
  normalizeClaudeMessage,
  observeClaudeFailure,
} from "./claude-runner-lib";
import { ProviderBlockedError } from "./provider-block";
import { createRunnerIo } from "./runner-io";
import { prepareComputerUseMcp } from "./computer-use-mcp-config";
import { claudeComputerUseServers } from "./computer-use-provider-adapters";

const runnerIo = createRunnerIo({
  closeError: "Briar closed the Claude runner input.",
});
const { emit, request: requestPromise, waitForApproval } = runnerIo;

async function main() {
  const request = await requestPromise;
  const computerUseMcp = await prepareComputerUseMcp(request);
  let approvalSequence = 0;
  const canUseTool: CanUseTool = async (toolName, input, options) => {
    const id = String(++approvalSequence);
    emit.approval({
      id,
      toolName,
      input,
      ...(options.title ? { title: options.title } : {}),
    });
    const approved = await waitForApproval(id, options.signal);
    return approvalResult(approved, input);
  };
  const state = createClaudeEventState();
  const failures = createClaudeFailureState();
  let result:
    | Extract<SDKMessage, { type: "result"; subtype: "success" }>
    | undefined;

  try {
    for await (const message of query({
      prompt:
        request.attachments?.length
          ? claudePrompt(request)
          : request.message,
      options: claudeOptions(
        request,
        canUseTool,
        claudeComputerUseServers(computerUseMcp.servers),
      ),
    })) {
    if (message.type === "system" && message.subtype === "init") {
      const sessionId = (message as unknown as { session_id?: unknown }).session_id;
      if (typeof sessionId === "string" && sessionId.trim()) {
        emit.session(sessionId);
      }
    }
    observeClaudeFailure(message, failures);
    const normalizedEvents = normalizeClaudeMessage(message, state);
    if (normalizedEvents.length === 0) {
      emit.event({ raw: message });
    } else {
      for (const event of normalizedEvents) {
        emit.event({ raw: message, event });
      }
    }
    if (message.type === "result") {
      if (message.subtype !== "success") {
        const block = claudeResultBlock(message, failures);
        if (block) throw new ProviderBlockedError(block);
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
    emit.result({
      sessionId: result.session_id,
      message:
        result.structured_output === undefined
          ? result.result
          : JSON.stringify(result.structured_output),
    });
  } finally {
    await computerUseMcp.cleanup();
  }
}

void main()
  .catch((caught) => {
    if (caught instanceof ProviderBlockedError) {
      emit.blocked(caught.block);
      return;
    }
    emit.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  })
  .finally(runnerIo.close);
