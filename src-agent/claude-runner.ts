import { createInterface } from "node:readline";
import {
  query,
  type CanUseTool,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  approvalResult,
  claudeOptions,
  normalizeClaudeMessage,
  type ClaudeApprovalResponse,
  type ClaudeEventState,
  type ClaudeRunnerOutput,
  type ClaudeRunnerRequest,
} from "./claude-runner-lib";

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function emit(output: ClaudeRunnerOutput) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

let resolveRequest:
  | ((request: ClaudeRunnerRequest) => void)
  | undefined;
let rejectRequest: ((error: Error) => void) | undefined;
const requestPromise = new Promise<ClaudeRunnerRequest>((resolve, reject) => {
  resolveRequest = resolve;
  rejectRequest = reject;
});
const approvalResolvers = new Map<string, (approved: boolean) => void>();

lines.on("line", (line) => {
  try {
    const message = JSON.parse(line) as
      | ClaudeRunnerRequest
      | ClaudeApprovalResponse;
    if (message.type === "run") {
      resolveRequest?.(message);
      resolveRequest = undefined;
      rejectRequest = undefined;
      return;
    }
    if (message.type === "approvalResponse") {
      approvalResolvers.get(message.id)?.(message.approved);
      approvalResolvers.delete(message.id);
    }
  } catch (caught) {
    rejectRequest?.(
      caught instanceof Error ? caught : new Error(String(caught)),
    );
  }
});

lines.on("close", () => {
  rejectRequest?.(new Error("Briar closed the Claude runner input."));
  for (const resolve of approvalResolvers.values()) resolve(false);
  approvalResolvers.clear();
});

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
    const approved = await new Promise<boolean>((resolve) => {
      approvalResolvers.set(id, resolve);
      options.signal.addEventListener(
        "abort",
        () => {
          if (!approvalResolvers.delete(id)) return;
          resolve(false);
        },
        { once: true },
      );
    });
    return approvalResult(approved, input);
  };
  const state: ClaudeEventState = {
    activeMessageId: null,
    lastAssistantMessageId: null,
  };
  let result:
    | Extract<SDKMessage, { type: "result"; subtype: "success" }>
    | undefined;

  for await (const message of query({
    prompt: request.message,
    options: claudeOptions(request, canUseTool),
  })) {
    if (message.type === "system" && message.subtype === "init") {
      const sessionId = (message as unknown as { session_id?: unknown }).session_id;
      if (typeof sessionId === "string" && sessionId.trim()) {
        emit({ type: "session", sessionId });
      }
    }
    const event = normalizeClaudeMessage(message, state);
    emit({
      type: "event",
      raw: message,
      ...(event ? { event } : {}),
    });
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
  .finally(() => lines.close());
