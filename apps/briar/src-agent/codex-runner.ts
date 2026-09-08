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
  codexProviderBlock,
  codexServerRequestResponse,
  codexTurnInterruptRequest,
  codexActiveTurnStopped,
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
import { prepareDmMessageMcp } from "./dm-message-mcp-config";
import { codexComputerUseArgs } from "./computer-use-provider-adapters";
import { CodexOwnedProcesses } from "./codex-owned-processes";
import { ProviderBlockedError } from "./provider-block";

let activeChild: ChildProcessWithoutNullStreams | null = null;
let cancelActiveAttempt: (() => void) | null = null;
let providerStarted = false;
const cancellation = new AbortController();
const confirmCancellation = () => process.stderr.write(`${JSON.stringify({
  event: "briar.runner", phase: "codex.cancellation_confirmed",
})}\n`);
function cancelRunner() {
  cancellation.abort();
  cancelActiveAttempt?.();
}
const runnerIo = createRunnerIo({
  closeError: "Briar closed the Codex runner input.",
  onClose: cancelRunner,
  // Keep App Server alive long enough to interrupt its own detached tool processes.
  terminate: cancelRunner,
});
const { emit, request: requestPromise, waitForApproval } = runnerIo;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    cancelRunner();
    if (!activeChild) {
      if (!providerStarted) confirmCancellation();
      runnerIo.close();
    }
  });
}

function send(child: ChildProcessWithoutNullStreams, message: CodexRpcMessage) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
  if (!cancellation.signal.aborted) emit.event({ direction: AgentEventDirection.CLIENT, raw: message });
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
  providerStarted = true;
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
  let interruptSent = false;
  let cancellationSettled = false;
  const ownedProcesses = child.pid ? new CodexOwnedProcesses(child.pid) : null;
  let capturedProcesses: Promise<void> | null = null;
  let stoppingProcesses: Promise<void> | null = null;
  let stopTimeout: ReturnType<typeof setTimeout> | null = null;
  const stopOwnedProcesses = () => {
    stoppingProcesses ??= (async () => {
      try {
        await capturedProcesses;
        if (!ownedProcesses) throw new Error("codex_process_owner_missing");
        await ownedProcesses.stopAndVerify();
        cancellationSettled = true;
      } catch {
        cancellationSettled = false;
      } finally {
        child.stdin.end();
        child.kill("SIGTERM");
      }
    })();
    return stoppingProcesses;
  };
  const interrupt = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (!stopTimeout) stopTimeout = setTimeout(() => child.kill("SIGTERM"), 8_000);
    capturedProcesses ??= ownedProcesses?.capture() ?? Promise.reject(new Error("codex_process_owner_missing"));
    void capturedProcesses.then(() => {
      const message = codexTurnInterruptRequest(state);
      if (message && !interruptSent) {
        interruptSent = true;
        send(child, message);
      } else if (!message && state.phase !== "startingTurn") {
        // A turn request already sent needs its turn ID before it can be interrupted.
        void stopOwnedProcesses();
      }
    }).catch(() => { void stopOwnedProcesses(); });
  };
  cancelActiveAttempt = interrupt;
  child.stdin.on("error", () => { /* A cancelled App Server may close its input first. */ });

  try {
    cancellation.signal.throwIfAborted();
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
      if (!cancellation.signal.aborted) emit.event({
        direction: AgentEventDirection.SERVER,
        raw: message,
        ...(normalized ? { event: normalized } : {}),
      });

      if (cancellation.signal.aborted && codexActiveTurnStopped(state, message)) {
        // Turn completion does not stop yielded exec sessions. Stop our captured tools too.
        await stopOwnedProcesses();
        break;
      }

      const approval = codexApprovalRequest(message);
      if (approval) {
        if (!cancellation.signal.aborted) emit.approval({
          id: approval.id,
          toolName: approval.toolName,
          input: approval.input,
          ...(approval.title ? { title: approval.title } : {}),
        });
        const approved = await waitForApproval(approval.id, cancellation.signal);
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
      if (cancellation.signal.aborted) {
        interrupt();
        continue;
      }
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
    if (cancellation.signal.aborted && cancellationSettled) confirmCancellation();
    cancellation.signal.throwIfAborted();
    if (mcpFailure) {
      return {
        type: "mcpFailure",
        threadId: state.threadId,
        failure: mcpFailure,
      };
    }
    if (!completed) {
      const stderrBlock = codexProviderBlock(null, stderr.trim());
      if (stderrBlock) throw new ProviderBlockedError(stderrBlock);
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
    if (stopTimeout) clearTimeout(stopTimeout);
    if (cancelActiveAttempt === interrupt) cancelActiveAttempt = null;
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
  let dmMessageMcp;
  try {
    dmMessageMcp = await prepareDmMessageMcp(request);
  } catch (error) {
    await computerUseMcp.cleanup();
    throw error;
  }
  const computerUseArguments = codexComputerUseArgs([
    ...computerUseMcp.servers,
    ...dmMessageMcp.servers,
  ]);
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
    await Promise.allSettled([
      computerUseMcp.cleanup(),
      dmMessageMcp.cleanup(),
    ]);
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
    if (cancellation.signal.aborted) return;
    if (caught instanceof ProviderBlockedError) {
      emit.blocked(caught.block);
      return;
    }
    emit.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  })
  .finally(runnerIo.close);
