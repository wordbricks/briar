import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  codexAppServerArgs,
  codexApprovalRequest,
  codexFinalMessage,
  codexInitializeRequest,
  codexServerRequestResponse,
  consumeCodexAppServerMessage,
  createCodexAppServerState,
  normalizeCodexAppServerMessage,
  type CodexApprovalResponse,
  type CodexRunnerOutput,
  type CodexRunnerRequest,
  type CodexRpcMessage,
} from "./codex-runner-lib";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function emit(output: CodexRunnerOutput) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

let resolveRequest: ((request: CodexRunnerRequest) => void) | undefined;
let rejectRequest: ((error: Error) => void) | undefined;
const requestPromise = new Promise<CodexRunnerRequest>((resolve, reject) => {
  resolveRequest = resolve;
  rejectRequest = reject;
});
const approvalResolvers = new Map<string, (approved: boolean) => void>();
let activeChild: ChildProcessWithoutNullStreams | null = null;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    if (activeChild && activeChild.exitCode === null) activeChild.kill(signal);
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    if (!activeChild) lines.close();
  });
}

lines.on("line", (line) => {
  try {
    const message = JSON.parse(line) as CodexRunnerRequest | CodexApprovalResponse;
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
  rejectRequest?.(new Error("Briar closed the Codex runner input."));
  for (const resolve of approvalResolvers.values()) resolve(false);
  approvalResolvers.clear();
  if (activeChild && activeChild.exitCode === null) activeChild.kill("SIGTERM");
});

function waitForApproval(id: string): Promise<boolean> {
  return new Promise((resolve) => approvalResolvers.set(id, resolve));
}

function send(child: ChildProcessWithoutNullStreams, message: CodexRpcMessage) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
  emit({ type: "event", direction: "client", raw: message });
}

function childExit(
  child: ChildProcessWithoutNullStreams,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

async function main() {
  const request = await requestPromise;
  if (!request.message.trim()) {
    throw new Error("Codex runner received an empty message.");
  }

  const child = spawn(request.codexBinary, codexAppServerArgs(request), {
    cwd: request.workspaceRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  activeChild = child;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  const exitPromise = childExit(child);
  const state = createCodexAppServerState();
  let sessionEmitted = false;
  let completed = false;

  try {
    send(child, codexInitializeRequest());
    const serverLines = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    for await (const line of serverLines) {
      if (!line.trim()) continue;
      let message: CodexRpcMessage;
      try {
        message = JSON.parse(line) as CodexRpcMessage;
      } catch {
        throw new Error(
          `Codex App Server emitted invalid JSON: ${line.slice(0, 500)}`,
        );
      }

      const normalized = normalizeCodexAppServerMessage(message);
      emit({
        type: "event",
        direction: "server",
        raw: message,
        ...(normalized ? { event: normalized } : {}),
      });

      const approval = codexApprovalRequest(message);
      if (approval) {
        emit({
          type: "approval",
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
      if (state.threadId && !sessionEmitted) {
        sessionEmitted = true;
        emit({ type: "session", sessionId: state.threadId });
      }
      for (const outgoing of transition.outgoing) send(child, outgoing);
      if (transition.completed) {
        completed = true;
        child.stdin.end();
        // The desktop backend drops the App Server child as soon as the turn
        // has completed. Detached workers must do the same so a persistent
        // App Server process cannot keep the worker stuck after its result.
        if (child.exitCode === null) child.kill("SIGTERM");
        break;
      }
    }
    serverLines.close();

    const exitCode = await exitPromise;
    if (!completed) {
      throw new Error(
        stderr.trim() ||
          `Codex App Server exited before turn completion (code ${exitCode ?? "unknown"}).`,
      );
    }
    const message = codexFinalMessage(state);
    if (!message) throw new Error("Codex App Server returned no final message.");
    emit({ type: "result", sessionId: state.threadId ?? "codex", message });
  } finally {
    if (activeChild === child) activeChild = null;
    if (child.exitCode === null) child.kill("SIGTERM");
  }
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
