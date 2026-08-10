import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { AgentAttachment } from "../src-agent/runner-attachments";
import {
  detachedConversationIdFromPayload,
  detachedProviderRequest,
  issueReplyTextFromPayload,
  type DetachedAgent,
} from "./agent-runner";

export type DetachedProviderTurnResult = {
  exitCode: number | null;
  stderr: string;
  runnerError: string | null;
  completed: boolean;
  resultText: string | null;
  conversationId: string | null;
};

export async function runDetachedProviderTurn(input: {
  agent: DetachedAgent;
  prompt: string;
  workspacePath: string;
  fullAccess: boolean;
  conversationId?: string | null;
  readOnly?: boolean;
  attachments?: AgentAttachment[];
  organizationContextManifestPath?: string | null;
  environment: NodeJS.ProcessEnv;
  signal: AbortSignal;
  onPayload?: (payload: unknown, rawLine: string) => void | Promise<void>;
}): Promise<DetachedProviderTurnResult> {
  if (input.signal.aborted) {
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new Error("Worker execution was cancelled");
  }
  const provider = input.agent.provider;
  const binaryName = provider === "claude" ? "claude" : provider;
  const agentBinary = Bun.which(binaryName);
  if (!agentBinary) {
    throw new Error(`${binaryName} coding agent is not installed on this Worker`);
  }
  const runnerPath = (
    await Promise.all(
      [
        resolve(import.meta.dir, `agent/${provider}-runner.js`),
        resolve(import.meta.dir, `../dist-agent/${provider}-runner.js`),
      ].map(async (path) => ((await Bun.file(path).exists()) ? path : null)),
    )
  ).find((path): path is string => Boolean(path));
  if (!runnerPath) {
    throw new Error(
      `${provider} runner bundle is missing; run \`bun run agent:build\``,
    );
  }
  const runnerRequest = detachedProviderRequest({
    agent: input.agent,
    prompt: input.prompt,
    workspacePath: input.workspacePath,
    fullAccess: input.fullAccess,
    conversationId: input.conversationId,
    readOnly: input.readOnly,
    attachments: input.attachments,
    organizationContextManifestPath:
      input.organizationContextManifestPath ?? null,
    agentBinary,
  }).request;
  const child = spawn(process.execPath, [runnerPath], {
    cwd: input.workspacePath,
    env: input.environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", resolveExit);
  });
  let stderr = "";
  let runnerError: string | null = null;
  let completed = false;
  let resultText: string | null = null;
  let conversationId = input.conversationId ?? null;
  const terminate = () => {
    if (child.exitCode !== null || child.killed) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5_000).unref();
  };
  input.signal.addEventListener("abort", terminate, { once: true });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  child.stdin.write(`${JSON.stringify(runnerRequest)}\n`);

  try {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let payload: unknown = line;
      try {
        payload = JSON.parse(line);
      } catch {
        // Preserve plain provider output for caller diagnostics.
      }
      conversationId =
        detachedConversationIdFromPayload(payload) ?? conversationId;
      const candidate = issueReplyTextFromPayload(payload);
      if (candidate) resultText = candidate;
      if (
        payload &&
        typeof payload === "object" &&
        "type" in payload &&
        (payload as { type?: string }).type === "approval" &&
        "id" in payload &&
        typeof payload.id === "string"
      ) {
        child.stdin.write(
          `${JSON.stringify({
            type: "approvalResponse",
            id: payload.id,
            approved: runnerRequest.sandboxMode !== "readOnly",
          })}\n`,
        );
      }
      if (
        payload &&
        typeof payload === "object" &&
        "type" in payload &&
        (payload as { type?: string }).type === "error"
      ) {
        runnerError = String(
          (payload as { message?: unknown }).message ?? "Agent failed",
        );
      }
      if (
        payload &&
        typeof payload === "object" &&
        "type" in payload &&
        (payload as { type?: string }).type === "result"
      ) {
        completed = true;
      }
      await input.onPayload?.(payload, line);
    }
    const exitCode = await exitPromise;
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error("Worker execution was cancelled");
    }
    return {
      exitCode,
      stderr,
      runnerError,
      completed,
      resultText,
      conversationId,
    };
  } finally {
    input.signal.removeEventListener("abort", terminate);
    terminate();
    await exitPromise.catch(() => null);
  }
}

export function assertDetachedProviderTurnSucceeded(
  result: DetachedProviderTurnResult,
  options: { requireResult?: boolean } = {},
) {
  if (result.exitCode !== 0 || result.runnerError) {
    throw new Error(
      result.runnerError ??
        (result.stderr.trim() || `Agent exited with ${result.exitCode}`),
    );
  }
  if (options.requireResult !== false && !result.completed) {
    throw new Error("Agent runner exited without a result");
  }
}
