import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { create, toBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { sizeDelimitedDecodeStream } from "@bufbuild/protobuf/wire";
import {
  type ComputerUseChildBinding,
  ComputerUseChildBindingSchema,
  RunnerToParentSchema,
  SandboxMode,
  type RunnerToParent,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import type { AgentAttachment } from "../src-agent/runner-attachments";
import {
  encodeSidecarApprovalResponse,
  encodeSidecarRunRequest,
  sidecarProviderBlock,
} from "../src-agent/sidecar-protocol";
import {
  providerBlockReplyMessage,
  type ProviderBlock,
} from "../src/lib/provider-block";
import { recordProviderBlock } from "./provider-block-registry";
import type { JsonSchema } from "../src/lib/team-llm";
import {
  agentProviderBinaryName,
  openCodeUpstreamOf,
} from "../src/lib/agent-provider";
import { agentProviderToProto } from "../src/lib/agent-provider-proto";
import { supportsComputerUseProvider } from
  "../src/lib/computer-use-contract";
import {
  detachedProviderRequest,
  type DetachedAgent,
  type DetachedDelegationTarget,
} from "./agent-runner";
import {
  cleanupDetachedAgentSkillCatalog,
  materializeDetachedAgentSkillCatalog,
  type DetachedAgentSkillCatalog,
} from "./agent-skill-discovery";
import { ComputerUseBoxClient } from "./computer-use-box-client";

export type DetachedProviderTurnResult = {
  exitCode: number | null;
  stderr: string;
  runnerError: string | null;
  completed: boolean;
  resultText: string | null;
  conversationId: string | null;
  /** The provider stopped the turn for a reason a person or time can clear. */
  block?: ProviderBlock | null;
};

/**
 * Thrown by `assertDetachedProviderTurnSucceeded` for a blocked turn so every
 * caller can report the structured block instead of a generic failure.
 */
export class DetachedProviderBlockedError extends Error {
  constructor(readonly block: ProviderBlock) {
    super(providerBlockReplyMessage(block));
    this.name = "DetachedProviderBlockedError";
  }
}

export function detachedProviderBlockOf(error: unknown): ProviderBlock | null {
  return error instanceof DetachedProviderBlockedError ? error.block : null;
}

export type DetachedProviderTurnDiagnosticContext = {
  runId?: string;
  workId?: string;
  executionId?: string | null;
  attempt?: number;
  workType?: string;
  turnNumber?: number;
};

export type DetachedProviderTurnDiagnostic = {
  at: string;
  phase: string;
  context?: DetachedProviderTurnDiagnosticContext;
  [key: string]: unknown;
};

export type DetachedProviderTurnInput = {
  agent: DetachedAgent;
  prompt: string;
  workspacePath: string;
  fullAccess: boolean;
  conversationId?: string | null;
  readOnly?: boolean;
  attachments?: AgentAttachment[];
  organizationContextManifestPath?: string | null;
  delegationTargets?: readonly DetachedDelegationTarget[];
  /** A caller-managed catalog is shared across provider turns and is not cleaned here. */
  skillCatalog?: DetachedAgentSkillCatalog | null;
  outputSchema?: JsonSchema | null;
  runKind?: "parent" | "computerUse";
  computerUseBinding?: ComputerUseChildBinding;
  computerUseMcpServerPath?: string | null;
  environment: NodeJS.ProcessEnv;
  signal: AbortSignal;
  diagnosticContext?: DetachedProviderTurnDiagnosticContext;
  onDiagnostic?: (diagnostic: DetachedProviderTurnDiagnostic) => void;
  onPayload?: (payload: RunnerToParent) => void | Promise<void>;
  onConversationId?: (conversationId: string) => void | Promise<void>;
};

type DiagnosticEmitter = (
  phase: string,
  detail?: Record<string, unknown>,
) => void;

const describeDiagnosticError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const boundedDiagnosticText = (value: unknown, maxLength = 2_000) =>
  String(value).slice(0, maxLength);

const redactDiagnosticText = (value: unknown) =>
  boundedDiagnosticText(value)
    .replace(
      /(authorization|api[-_]?key|token|secret|password)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/giu,
      "$1$2[redacted]",
    )
    .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/gu, "[redacted]");

function createDiagnosticEmitter(
  input: Pick<
    DetachedProviderTurnInput,
    "diagnosticContext" | "onDiagnostic"
  >,
): DiagnosticEmitter {
  return (phase, detail = {}) => {
    if (!input.onDiagnostic) return;
    try {
      input.onDiagnostic({
        at: new Date().toISOString(),
        phase,
        ...(input.diagnosticContext
          ? { context: input.diagnosticContext }
          : {}),
        ...detail,
      });
    } catch {
      // Diagnostics must never change the provider turn's behavior.
    }
  };
}

function runnerDiagnosticFromLine(line: string): {
  phase: string;
  detail: Record<string, unknown>;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (
    record.event !== "briar.runner" ||
    typeof record.phase !== "string"
  ) {
    return null;
  }
  const detail: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "event" || key === "phase") continue;
    const normalizedKey =
      key === "pid" ? "runnerPid" : key === "at" ? "runnerAt" : key;
    detail[normalizedKey] =
      key === "error" || key === "message"
        ? redactDiagnosticText(value)
        : value;
  }
  return { phase: `runner.${record.phase}`, detail };
}

export function logDetachedProviderTurnDiagnostic(
  diagnostic: DetachedProviderTurnDiagnostic,
) {
  console.error(`[briar-agent-runner] ${JSON.stringify(diagnostic)}`);
}

const existingBundle = async (paths: readonly string[]): Promise<string | null> =>
  (await Promise.all(
    paths.map(async (path) => ((await Bun.file(path).exists()) ? path : null)),
  )).find((path): path is string => Boolean(path)) ?? null;

const prepareComputerUseTurn = async (
  input: DetachedProviderTurnInput,
): Promise<{
  readonly input: DetachedProviderTurnInput;
  release(): Promise<void>;
}> => {
  if (input.agent.computerUsePolicy !== "unattended") {
    return { input, release: async () => undefined };
  }
  if (!supportsComputerUseProvider(input.agent.provider)) {
    throw new Error(
      `Computer Use is not available for the ${input.agent.provider} provider`,
    );
  }
  if (input.runKind === "computerUse") {
    if (!input.computerUseBinding || !input.computerUseMcpServerPath) {
      throw new Error("Computer Use child is missing its display binding");
    }
    return { input, release: async () => undefined };
  }
  const mcpServerPath = await existingBundle([
    resolve(import.meta.dir, "agent/computer-use-mcp-server.js"),
    resolve(import.meta.dir, "../dist-agent/computer-use-mcp-server.js"),
  ]);
  if (!mcpServerPath) {
    throw new Error(
      "Computer Use MCP bundle is missing; run `bun run agent:build`",
    );
  }
  const client = await ComputerUseBoxClient.connect();
  const assigned = await client.assign(input.agent.id);
  try {
    const parentRunId = input.diagnosticContext?.runId
      ?? input.diagnosticContext?.workId
      ?? randomUUID();
    const binding = create(ComputerUseChildBindingSchema, {
      parentRunId,
      agentId: input.agent.id,
      managedComputerId:
        input.environment.BRIAR_MANAGED_COMPUTER_ID?.trim()
        || "local-managed-computer",
      displayIndex: assigned.assignment.displayIndex,
      ownerToken: assigned.assignment.ownerToken,
      provider: agentProviderToProto(input.agent.provider),
    });
    return {
      input: {
        ...input,
        runKind: "parent",
        computerUseBinding: binding,
        computerUseMcpServerPath: mcpServerPath,
      },
      release: assigned.release,
    };
  } catch (error) {
    await assigned.release().catch(() => undefined);
    throw error;
  }
};

export async function runDetachedProviderTurn(
  input: DetachedProviderTurnInput,
): Promise<DetachedProviderTurnResult> {
  const prepared = await prepareComputerUseTurn(input);
  try {
    return await runPreparedDetachedProviderTurn(prepared.input);
  } finally {
    await prepared.release();
  }
}

async function runPreparedDetachedProviderTurn(
  input: DetachedProviderTurnInput,
): Promise<DetachedProviderTurnResult> {
  const diagnose = createDiagnosticEmitter(input);
  if (input.signal.aborted) {
    diagnose("turn.aborted_before_start");
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new Error("Worker execution was cancelled");
  }
  const provider = input.agent.provider;
  // An OpenCode upstream has no runner bundle of its own; OpenCode's drives it.
  const runnerProvider = openCodeUpstreamOf(provider) ? "opencode" : provider;
  const binaryName = agentProviderBinaryName(provider);
  diagnose("turn.started", {
    provider,
    runnerProvider,
    binaryName,
    model: input.agent.model ?? null,
    workspacePath: input.workspacePath,
    readOnly: input.readOnly ?? false,
  });
  const agentBinary = Bun.which(binaryName);
  if (!agentBinary) {
    diagnose("turn.binary_missing", { binaryName });
    throw new Error(`${binaryName} coding agent is not installed on this Worker`);
  }
  const runnerPath = await existingBundle([
    resolve(import.meta.dir, `agent/${runnerProvider}-runner.js`),
    resolve(import.meta.dir, `../dist-agent/${runnerProvider}-runner.js`),
  ]);
  if (!runnerPath) {
    diagnose("turn.runner_missing", { provider, runnerProvider });
    throw new Error(
      `${provider} runner bundle is missing; run \`bun run agent:build\``,
    );
  }
  diagnose("turn.runner_selected", { runnerPath, agentBinary });
  const ownsSkillCatalog = input.skillCatalog === undefined;
  const skillCatalog = ownsSkillCatalog
    ? await materializeDetachedAgentSkillCatalog(input.agent, {
        temporaryParentPath: input.workspacePath,
      })
    : input.skillCatalog ?? null;
  diagnose("turn.skill_catalog_ready", {
    materialized: skillCatalog !== null,
    lifetime: skillCatalog?.lifetime ?? null,
  });
  try {
    return await executeDetachedProviderTurn(
      input,
      runnerPath,
      agentBinary,
      skillCatalog,
      diagnose,
    );
  } finally {
    if (ownsSkillCatalog) {
      diagnose("turn.skill_catalog_cleanup");
      await cleanupDetachedAgentSkillCatalog(skillCatalog);
    } else {
      diagnose("turn.skill_catalog_retained", {
        lifetime: skillCatalog?.lifetime ?? null,
      });
    }
  }
}

async function executeDetachedProviderTurn(
  input: DetachedProviderTurnInput,
  runnerPath: string,
  agentBinary: string,
  skillCatalog: DetachedAgentSkillCatalog | null,
  diagnose: DiagnosticEmitter,
) {
  const maxSidecarFrameBytes = 16 * 1024 * 1024;
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
    delegationTargets: input.delegationTargets,
    skillCatalog,
    outputSchema: input.outputSchema ?? null,
    runKind: input.runKind,
    computerUseBinding: input.computerUseBinding,
    computerUseMcpServerPath: input.computerUseMcpServerPath,
    agentBinary,
  }).request;
  const requestFrame = encodeSidecarRunRequest(runnerRequest);
  const requestBytes = requestFrame.byteLength;
  diagnose("runner.spawn_start", {
    runnerPath,
    workspacePath: input.workspacePath,
    requestBytes,
  });
  const child = spawn(process.execPath, [runnerPath], {
    cwd: input.workspacePath,
    env: input.environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  diagnose("runner.spawned", { runnerPid: child.pid ?? null });
  const exitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", (error) => {
      diagnose("runner.process_error", {
        runnerPid: child.pid ?? null,
        error: describeDiagnosticError(error),
      });
      rejectExit(error);
    });
    child.once("close", (exitCode, signal) => {
      diagnose("runner.process_closed", {
        runnerPid: child.pid ?? null,
        exitCode,
        signal: signal ?? null,
      });
      resolveExit(exitCode);
    });
  });
  let stderr = "";
  let runnerError: string | null = null;
  let completed = false;
  let terminalOutputSeen = false;
  let block: ProviderBlock | null = null;
  let resultText: string | null = null;
  let conversationId = input.conversationId ?? null;
  let outputCount = 0;
  let runnerStderrBuffer = "";
  const terminate = () => {
    if (child.exitCode !== null || child.killed) return;
    diagnose("runner.terminate_requested", {
      runnerPid: child.pid ?? null,
      reason: input.signal.aborted ? "aborted" : "cleanup",
    });
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5_000).unref();
  };
  input.signal.addEventListener("abort", terminate, { once: true });
  child.stderr.setEncoding("utf8");
  child.stdin.on("error", (error) => {
    diagnose("runner.stdin_error", {
      runnerPid: child.pid ?? null,
      error: describeDiagnosticError(error),
    });
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
    runnerStderrBuffer = `${runnerStderrBuffer}${chunk}`;
    const lines = runnerStderrBuffer.split(/\r?\n/u);
    runnerStderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const diagnostic = runnerDiagnosticFromLine(line.trim());
      if (!diagnostic) continue;
      diagnose(diagnostic.phase, {
        runnerPid: child.pid ?? null,
        ...diagnostic.detail,
      });
    }
  });

  try {
    diagnose("runner.stdin_write_start", {
      runnerPid: child.pid ?? null,
      requestBytes,
    });
    const accepted = child.stdin.write(requestFrame, () => {
      diagnose("runner.stdin_write_complete", {
        runnerPid: child.pid ?? null,
        requestBytes,
      });
    });
    diagnose("runner.stdin_write_accepted", {
      runnerPid: child.pid ?? null,
      accepted,
      requestBytes,
    });
    if (!accepted) {
      child.stdin.once("drain", () => {
        diagnose("runner.stdin_drain", { runnerPid: child.pid ?? null });
      });
    }
    for await (const message of sizeDelimitedDecodeStream(
      RunnerToParentSchema,
      child.stdout,
      { readMaxBytes: maxSidecarFrameBytes },
    )) {
      if (terminalOutputSeen) {
        throw new Error("Agent runner emitted output after a terminal frame");
      }
      const payload = message.payload;
      if (payload.case === undefined) {
        throw new Error("Agent runner emitted an empty protobuf output frame");
      }
      outputCount += 1;
      const payloadType = payload.case;
      diagnose("runner.stdout_payload", {
        runnerPid: child.pid ?? null,
        outputNumber: outputCount,
        payloadType,
        bytes: toBinary(RunnerToParentSchema, message).byteLength,
        ...(payloadType === "error"
          ? {
              error: redactDiagnosticText(payload.value.message),
            }
          : {}),
        ...(payloadType === "blocked"
          ? {
              blockReason: payload.value.block?.reason ?? null,
              blockProvider: payload.value.block?.provider ?? null,
              blockMessage: redactDiagnosticText(
                payload.value.block?.message ?? "",
              ),
              nextRetryAt: payload.value.block?.nextRetryAt
                ? timestampDate(payload.value.block.nextRetryAt).toISOString()
                : null,
            }
          : {}),
      });
      if (
        payload.case === "sessionStarted" &&
        payload.value.sessionId.trim() &&
        payload.value.sessionId !== conversationId
      ) {
        conversationId = payload.value.sessionId;
        await input.onConversationId?.(payload.value.sessionId);
      }
      if (payload.case === "result") {
        resultText = payload.value.message.trim() || null;
      }
      if (payload.case === "approval") {
        child.stdin.write(
          encodeSidecarApprovalResponse(
            payload.value.id,
            runnerRequest.sandboxMode !== SandboxMode.READ_ONLY,
          ),
        );
      }
      if (payload.case === "error") {
        runnerError = payload.value.message || "Agent failed";
        terminalOutputSeen = true;
      }
      if (payload.case === "result") {
        completed = true;
        terminalOutputSeen = true;
      }
      if (payload.case === "blocked") {
        terminalOutputSeen = true;
        block = sidecarProviderBlock(message);
        if (block) {
          const hold = recordProviderBlock(input.agent.provider, block);
          diagnose("turn.provider_blocked", {
            reason: block.reason,
            provider: block.provider,
            nextRetryAt: block.nextRetryAt,
            providerHoldUntil: hold?.until ?? null,
          });
        } else {
          runnerError = "Agent runner reported a block this Worker cannot interpret";
        }
      }
      await input.onPayload?.(message);
    }
    if (!terminalOutputSeen) {
      throw new Error("Agent runner stdout closed before terminal output");
    }
    const exitCode = await exitPromise;
    if (runnerStderrBuffer.trim()) {
      const diagnostic = runnerDiagnosticFromLine(runnerStderrBuffer.trim());
      if (diagnostic) {
        diagnose(diagnostic.phase, {
          runnerPid: child.pid ?? null,
          ...diagnostic.detail,
        });
      }
    }
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error("Worker execution was cancelled");
    }
    if (completed && exitCode !== 0) {
      // The turn already succeeded; the runner just failed to shut down
      // cleanly. Keep it visible without turning it into a failed turn.
      diagnose("turn.exit_after_result", {
        runnerPid: child.pid ?? null,
        exitCode,
        stderr: redactDiagnosticText(stderr.trim()),
      });
    }
    diagnose("turn.returned", {
      runnerPid: child.pid ?? null,
      exitCode,
      outputCount,
      completed,
      hasResultText: resultText !== null,
      stderrBytes: Buffer.byteLength(stderr, "utf8"),
    });
    return {
      exitCode,
      stderr,
      runnerError,
      completed,
      resultText,
      conversationId,
      block,
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
  if (result.block) throw new DetachedProviderBlockedError(result.block);
  const failure = detachedProviderTurnFailure(result, options);
  if (failure) throw new Error(failure);
}

/**
 * Return a provider-turn diagnostic without deciding the claimed run's
 * lifecycle. Issue workers use this to inspect the durable claim first: an
 * agent CLI exiting after a failed tool or CI command is a recoverable turn
 * while the run remains active, not permission to fail the whole run.
 *
 * A completed turn — one whose runner delivered its terminal `result` frame —
 * is never a failure here. The exit code that follows describes how the runner
 * process shut down, not whether the turn produced an answer, and treating a
 * late crash as a failed turn makes the server requeue work that already ran.
 * `turn.exit_after_result` records that exit for diagnosis instead, and callers
 * can still read `exitCode`/`stderr` off the result.
 */
export function detachedProviderTurnFailure(
  result: DetachedProviderTurnResult,
  options: { requireResult?: boolean } = {},
): string | null {
  if (result.block) return providerBlockReplyMessage(result.block);
  if (result.runnerError) return result.runnerError;
  // The terminal `result` frame is the runner's own verdict on the turn. A
  // process that delivered it and then died while shutting down already did the
  // work, so a nonzero exit code afterwards is a diagnostic, not a failure —
  // reporting it as one makes the server requeue side-effectful tasks.
  if (result.completed) return null;
  if (result.exitCode !== 0) {
    return result.stderr.trim() || `Agent exited with ${result.exitCode}`;
  }
  if (options.requireResult !== false) {
    return "Agent runner exited without a result";
  }
  return null;
}
