import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentEventDirection } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import * as Result from "effect/Result";
import {
  CODEX_APPS_INSTALLED_REQUEST_ID,
  codexAppServerArgs,
  codexApprovalRequest,
  codexFinalMessage,
  codexInitializeRequest,
  codexMcpRecoveryPrompt,
  codexPreparedRequestMismatch,
  codexProviderBlock,
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
import { prepareDmMessageMcp } from "./dm-message-mcp-config";
import { codexComputerUseArgs } from "./computer-use-provider-adapters";
import { ProviderBlockedError } from "./provider-block";

let activeChild: ChildProcessWithoutNullStreams | null = null;
const runnerIo = createRunnerIo({
  closeError: "Briar closed the Codex runner input.",
  // Codex is the only provider whose App Server can be started before the
  // prompt exists, so it is the only runner that accepts the prepare frame.
  acceptPrepare: true,
  onClose: () => {
    if (activeChild && activeChild.exitCode === null) {
      activeChild.kill("SIGTERM");
    }
  },
});
const {
  emit,
  firstFrame: firstFramePromise,
  request: requestPromise,
  waitForApproval,
} = runnerIo;

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

/**
 * Hands the attempt from its prepare phase to its turn phase. It resolves only
 * once the parent has sent the `run` frame, so everything before the thread
 * request — process start, initialize, config, model list, installed apps —
 * has already happened by the time the prompt exists.
 */
type CodexTurnHandoff = () => Promise<RunnerRequest>;

async function runCodexAttempt(
  request: RunnerRequest,
  isolation: CodexMcpIsolation,
  emittedSessions: Set<string>,
  computerUseArguments: readonly string[],
  briarMcpServers: readonly string[],
  handoff: CodexTurnHandoff | null = null,
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
  const state = createCodexAppServerState(isolation, briarMcpServers);
  let completed = false;
  let mcpFailure: CodexMcpTurnFailure | null = null;
  // The prepare phase ends here: the thread request is the first message that
  // needs the prompt's developer instructions, so everything before it runs
  // against the prepared request and everything after against the turn's.
  let activeRequest = request;
  let pendingHandoff = handoff;

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

      if (
        pendingHandoff &&
        message.id === CODEX_APPS_INSTALLED_REQUEST_ID &&
        !message.error
      ) {
        emit.prepared();
        activeRequest = await pendingHandoff();
        pendingHandoff = null;
      }
      const transition = consumeCodexAppServerMessage(
        state,
        activeRequest,
        message,
      );
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
    if (activeChild === child) activeChild = null;
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

async function main() {
  const first = await firstFramePromise;
  const request = first.request;
  if (first.phase === "run" && !request.message.trim()) {
    throw new Error("Codex runner received an empty message.");
  }
  /*
    A prepared process has already been started against `request`; the turn
    that later claims it must agree on everything the App Server was spawned
    with, and on everything its thread is started with. The parent checks the
    same list before it hands the process a turn, so a mismatch here is a
    defect rather than an expected fallback.
  */
  let turnRequest = request;
  const handoff = first.phase === "prepare"
    ? async () => {
      const turn = await requestPromise;
      const mismatch = codexPreparedRequestMismatch(request, turn);
      if (mismatch) {
        throw new Error(
          `Codex prepared process cannot serve this turn: ${mismatch} changed.`,
        );
      }
      if (!turn.message.trim()) {
        throw new Error("Codex runner received an empty message.");
      }
      turnRequest = turn;
      return turn;
    }
    : null;

  const computerUseMcp = await prepareComputerUseMcp(request);
  let dmMessageMcp;
  try {
    dmMessageMcp = await prepareDmMessageMcp(request);
  } catch (error) {
    await computerUseMcp.cleanup();
    throw error;
  }
  const briarServers = [...computerUseMcp.servers, ...dmMessageMcp.servers];
  const computerUseArguments = codexComputerUseArgs(briarServers);
  /*
    The names a Briar-owned turn must keep when it refuses the host user's MCP
    servers. `aside` is passed on the command line by `codexAppServerArgs`
    under the same condition.
  */
  const briarMcpServers = [
    ...briarServers.map((server) => server.name),
    ...(request.externalTools !== false &&
        process.env.BRIAR_BROWSER_AUTOMATION_PROVIDER === "aside"
      ? ["aside"]
      : []),
  ];
  try {
    const emittedSessions = new Set<string>();
    let isolation: CodexMcpIsolation = {
      mcpServers: [],
      apps: [],
      disableApps: false,
      disablePlugins: false,
    };
    let attemptRequest = request;
    let attemptHandoff = handoff;
    let recoveryCount = 0;

    for (;;) {
      const result = await runCodexAttempt(
        attemptRequest,
        isolation,
        emittedSessions,
        computerUseArguments,
        briarMcpServers,
        attemptHandoff,
      );
      // A recovery attempt re-spawns the App Server and already holds the
      // prompt, so only the first attempt of a two-phase turn waits.
      attemptHandoff = null;
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
        // The turn's own request once a two-phase turn has been handed off,
        // so a recovery attempt keeps the prompt's developer instructions.
        ...turnRequest,
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
    if (caught instanceof ProviderBlockedError) {
      emit.blocked(caught.block);
      return;
    }
    emit.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  })
  .finally(runnerIo.close);
