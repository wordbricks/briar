import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentEventDirection } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import * as Result from "effect/Result";
import {
  codexAppServerArgs,
  codexApprovalRequest,
  codexFinalMessage,
  codexInitializeRequest,
  codexMcpRecoveryPrompt,
  codexServerRequestResponse,
  consumeCodexAppServerMessage,
  createCodexAppServerState,
  normalizeCodexAppServerMessage,
  type CodexMcpIsolation,
  type CodexMcpTurnFailure,
  type CodexRpcMessage,
} from "./codex-runner-lib";
import { decodeJsonRpcMessageJsonResult } from "./json-rpc-message";
import { createRunnerIo } from "./runner-io";
import type { RunnerRequest } from "./runner-request";
import { prepareComputerUseMcp } from "./computer-use-mcp-config";
import { codexComputerUseArgs } from "./computer-use-provider-adapters";

let activeChild: ChildProcessWithoutNullStreams | null = null;
const runnerIo = createRunnerIo({
  closeError: "Briar closed the Codex runner input.",
  onClose: () => {
    if (activeChild && activeChild.exitCode === null) {
      activeChild.kill("SIGTERM");
    }
  },
});
const { emit, request: requestPromise, waitForApproval } = runnerIo;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    if (activeChild && activeChild.exitCode === null) activeChild.kill(signal);
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    if (!activeChild) runnerIo.close();
  });
}

function send(child: ChildProcessWithoutNullStreams, message: CodexRpcMessage) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
  emit.event({ direction: AgentEventDirection.CLIENT, raw: message });
}

function childExit(
  child: ChildProcessWithoutNullStreams,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

type CodexAttemptResult =
  | {
      type: "completed";
      threadId: string;
      message: string;
    }
  | {
      type: "mcpFailure";
      threadId: string | null;
      failure: CodexMcpTurnFailure;
    };

const maxOptionalMcpRecoveries = 3;

async function runCodexAttempt(
  request: RunnerRequest,
  isolation: CodexMcpIsolation,
  emittedSessions: Set<string>,
  computerUseArguments: readonly string[],
): Promise<CodexAttemptResult> {
  const child = spawn(
    request.providerBinaryPath,
    codexAppServerArgs(
      request,
      process.env.BRIAR_BROWSER_AUTOMATION_PROVIDER,
      computerUseArguments,
    ),
    {
      cwd: request.workspaceRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  activeChild = child;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  const exitPromise = childExit(child);
  const state = createCodexAppServerState(isolation);
  let completed = false;
  let mcpFailure: CodexMcpTurnFailure | null = null;

  try {
    send(child, codexInitializeRequest());
    const serverLines = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    for await (const line of serverLines) {
      if (!line.trim()) continue;
      const decoded = decodeJsonRpcMessageJsonResult(line);
      if (Result.isFailure(decoded)) {
        throw new Error(
          `Codex App Server emitted invalid JSON: ${line.slice(0, 500)}`,
        );
      }
      const message: CodexRpcMessage = decoded.success;

      const normalized = normalizeCodexAppServerMessage(message);
      emit.event({
        direction: AgentEventDirection.SERVER,
        raw: message,
        ...(normalized ? { event: normalized } : {}),
      });

      const approval = codexApprovalRequest(message);
      if (approval) {
        emit.approval({
          id: approval.id,
          toolName: approval.toolName,
          input: approval.input,
          ...(approval.title ? { title: approval.title } : {}),
        });
        const approved = await waitForApproval(approval.id);
        const response = codexServerRequestResponse(message, approved);
        if (response) send(child, response);
        continue;
      }

      if (message.method && message.id !== undefined && message.id !== null) {
        const response = codexServerRequestResponse(message, false);
        if (response) send(child, response);
        continue;
      }

      const transition = consumeCodexAppServerMessage(state, request, message);
      if (state.threadId && !emittedSessions.has(state.threadId)) {
        emittedSessions.add(state.threadId);
        emit.session(state.threadId);
      }
      for (const outgoing of transition.outgoing) send(child, outgoing);
      if (transition.mcpFailure) {
        mcpFailure = transition.mcpFailure;
        child.stdin.end();
        if (child.exitCode === null) child.kill("SIGTERM");
        break;
      }
      if (transition.completed) {
        completed = true;
        child.stdin.end();
        // Drop the App Server child as soon as the turn has completed so a
        // persistent App Server process cannot keep the caller — a detached
        // worker or the desktop sidecar — stuck after its result.
        if (child.exitCode === null) child.kill("SIGTERM");
        break;
      }
    }
    serverLines.close();

    const exitCode = await exitPromise;
    if (mcpFailure) {
      return {
        type: "mcpFailure",
        threadId: state.threadId,
        failure: mcpFailure,
      };
    }
    if (!completed) {
      throw new Error(
        stderr.trim() ||
          `Codex App Server exited before turn completion (code ${exitCode ?? "unknown"}).`,
      );
    }
    const message = codexFinalMessage(state);
    if (!message) throw new Error("Codex App Server returned no final message.");
    return {
      type: "completed",
      threadId: state.threadId ?? "codex",
      message,
    };
  } finally {
    if (activeChild === child) activeChild = null;
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

async function main() {
  const request = await requestPromise;
  if (!request.message.trim()) {
    throw new Error("Codex runner received an empty message.");
  }

  const computerUseMcp = await prepareComputerUseMcp(request);
  const computerUseArguments = codexComputerUseArgs(computerUseMcp.servers);
  try {
    const emittedSessions = new Set<string>();
    let isolation: CodexMcpIsolation = {
      mcpServers: [],
      apps: [],
      disableApps: false,
      disablePlugins: false,
    };
    let attemptRequest = request;
    let recoveryCount = 0;

    for (;;) {
      const result = await runCodexAttempt(
        attemptRequest,
        isolation,
        emittedSessions,
        computerUseArguments,
      );
      if (result.type === "completed") {
        emit.result({
          sessionId: result.threadId,
          message: result.message,
        });
        return;
      }

      if (result.failure.disposition === "blocked") {
        emit.blocked({
          reason: "mcp_auth_required",
          provider: "codex",
          message: `Authentication is required for MCP server(s): ${result.failure.serverNames.join(", ")}.`,
          serverNames: result.failure.serverNames,
          nextRetryAt: null,
        });
        return;
      }

      if (recoveryCount >= maxOptionalMcpRecoveries) {
        throw new Error(
          "Codex could not continue after isolating optional MCP startup failures.",
        );
      }
      const nextIsolation = mergeIsolation(isolation, result.failure.isolation);
      if (isolationKey(nextIsolation) === isolationKey(isolation)) {
        throw new Error(
          "Codex could not isolate the optional MCP startup failure.",
        );
      }
      if (!result.threadId) {
        throw new Error(
          "Codex App Server did not return a thread ID for MCP recovery.",
        );
      }

      recoveryCount += 1;
      isolation = nextIsolation;
      attemptRequest = {
        ...request,
        conversationId: result.threadId,
        message: codexMcpRecoveryPrompt(),
        attachments: [],
      };
    }
  } finally {
    await computerUseMcp.cleanup();
  }
}

function mergeIsolation(
  current: CodexMcpIsolation,
  incoming: CodexMcpIsolation,
): CodexMcpIsolation {
  return {
    mcpServers: [...new Set([...current.mcpServers, ...incoming.mcpServers])]
      .sort(),
    apps: [...new Set([...current.apps, ...incoming.apps])].sort(),
    disableApps: current.disableApps || incoming.disableApps,
    disablePlugins: current.disablePlugins || incoming.disablePlugins,
  };
}

function isolationKey(value: CodexMcpIsolation): string {
  return JSON.stringify([
    value.mcpServers,
    value.apps,
    value.disableApps,
    value.disablePlugins,
  ]);
}

void main()
  .catch((caught) => {
    emit.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  })
  .finally(runnerIo.close);
