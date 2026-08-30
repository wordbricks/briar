import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import {
  agyArgs,
  agyBlockedRetry,
  agyConversationId,
  agyFinalMessage,
  agyEnvironment,
  createAgyEventState,
  normalizeAgyEvent,
  type AgyRunnerOutput,
} from "./agy-runner-lib";
import { createRunnerIo } from "./runner-io";
import type { RunnerRequest } from "./runner-request";
import {
  providerInstructionSeatbeltPattern,
  readOnlySeatbeltSpawnSpec,
} from "./read-only-seatbelt";

function agySpawnSpec(request: RunnerRequest) {
  const args = agyArgs(request);
  if (request.sandboxMode !== "readOnly") {
    return { command: request.providerBinaryPath, arguments: args };
  }
  const stateRoot = process.env.HOME;
  if (!stateRoot) throw new Error("Antigravity read-only state is not isolated.");
  return readOnlySeatbeltSpawnSpec({
    providerName: "Antigravity",
    binary: request.providerBinaryPath,
    arguments: args,
    workspaceRoot: request.workspaceRoot,
    stateRoot,
    readOnly: true,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/GEMINI[.]md$",
    ],
  });
}

function stop(child: ChildProcessWithoutNullStreams | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
}

type AgyRunnerIo = ReturnType<
  typeof createRunnerIo<AgyRunnerOutput>
>;

function parseAgyLine(line: string) {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed;
  } catch {
    return { type: "diagnostic", text: line };
  }
}

async function main(io: AgyRunnerIo) {
  const request = await io.request;
  const spec = agySpawnSpec(request);
  const child = spawn(spec.command, spec.arguments, {
    cwd: request.workspaceRoot,
    env: agyEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  activeChild = child;
  child.stdin.end();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const state = createAgyEventState();
  let sessionId = request.conversationId?.trim() ?? "";
  let finalMessage = "";
  let stderr = "";
  let blockerEmitted = false;

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", (error) => {
    io.emit({ type: "error", message: `Antigravity CLI 실행에 실패했습니다: ${error.message}` });
  });

  for await (const line of lines) {
    if (!line.trim()) continue;
    const raw = parseAgyLine(line);
    const discoveredSessionId = agyConversationId(raw);
    if (discoveredSessionId && discoveredSessionId !== sessionId) {
      sessionId = discoveredSessionId;
      io.emit({ type: "session", sessionId });
    }
    const blocker = agyBlockedRetry(raw);
    if (blocker && !blockerEmitted) {
      blockerEmitted = true;
      io.emit({ type: "blocked", ...blocker });
    }
    const events = normalizeAgyEvent(raw, state);
    if (events.length) {
      for (const event of events) io.emit({ type: "event", raw, event });
    } else {
      io.emit({ type: "event", raw });
    }
    finalMessage = agyFinalMessage(raw, finalMessage);
  }

  const code = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once("close", resolve);
  });
  activeChild = null;
  const stderrBlocker = agyBlockedRetry(stderr);
  if (stderrBlocker && !blockerEmitted) {
    io.emit({ type: "blocked", ...stderrBlocker });
    return;
  }
  if (code !== 0) {
    io.emit({
      type: "error",
      message: stderr.trim() || `Antigravity CLI가 코드 ${code ?? "unknown"}(으)로 종료되었습니다.`,
    });
    return;
  }
  if (!sessionId) {
    io.emit({ type: "error", message: "Antigravity가 대화 ID를 반환하지 않았습니다." });
    return;
  }
  io.emit({ type: "result", sessionId, message: finalMessage });
}

let activeChild: ChildProcessWithoutNullStreams | null = null;
const io = createRunnerIo<AgyRunnerOutput>({
  closeError: "Antigravity runner 입력이 요청 전에 닫혔습니다.",
  onClose: () => stop(activeChild),
});

main(io)
  .catch((caught) => {
    io.emit({
      type: "error",
      message: caught instanceof Error ? caught.message : String(caught),
    });
  })
  .finally(() => io.close());
