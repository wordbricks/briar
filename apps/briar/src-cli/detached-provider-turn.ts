import { prepareDmMessageCommand } from "./dm-message-command";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { create, toBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { sizeDelimitedDecodeStream } from "@bufbuild/protobuf/wire";
import {
  type ComputerUseChildBinding,
  type DmMessagePublicationBinding,
  ComputerUseChildBindingSchema,
  RunnerToParentSchema,
  SandboxMode,
  type RunnerToParent,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import type { AgentAttachment } from "../src-agent/runner-attachments";
import {
  encodeSidecarApprovalResponse,
  encodeSidecarPrepareRequest,
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
  type DetachedToolInheritance,
} from "./agent-runner";
import {
  cleanupDetachedAgentSkillCatalog,
  materializeDetachedAgentSkillCatalog,
  type DetachedAgentSkillCatalog,
} from "./agent-skill-discovery";
import { ComputerUseBoxClient } from "./computer-use-box-client";
import { findAgentBundle } from "./agent-bundle-path";
import { OwnedProcessSupervisor, supportsOwnedProcessSupervisor } from "./owned-process-supervisor";
import { runDetachedProviderClassification } from "./detached-provider-no-tools";

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

/** A cancelled provider exited without confirming that its active work stopped. */
export class DetachedProviderStopUnconfirmedError extends Error {
  constructor() {
    super("provider_stop_unconfirmed");
    this.name = "DetachedProviderStopUnconfirmedError";
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
  /** Classify in an isolated read-only turn with no Briar capabilities; reject observed tool attempts. */
  executionTools?: "disabled";
  /** Absent means `inherit`: the provider loads the host user's tool catalog. */
  toolInheritance?: DetachedToolInheritance;
  attachments?: AgentAttachment[];
  organizationContextManifestPath?: string | null;
  delegationTargets?: readonly DetachedDelegationTarget[];
  /** A caller-managed catalog is shared across provider turns and is not cleaned here. */
  skillCatalog?: DetachedAgentSkillCatalog | null;
  outputSchema?: JsonSchema | null;
  runKind?: "parent" | "computerUse";
  computerUseBinding?: ComputerUseChildBinding;
  computerUseMcpServerPath?: string | null;
  dmMessagePublicationBinding?: DmMessagePublicationBinding;
  dmMessageMcpServerPath?: string | null;
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

/**
 * `unattended` grants an Agent the use of a computer; it does not demand one of
 * every host that runs the Agent. A host without a Computer Use box runs the
 * turn without the desktop tools and says so, so a task that never needed a
 * screen still runs where it can.
 */
export const prepareComputerUseTurn = async (
  input: DetachedProviderTurnInput,
): Promise<{
  readonly input: DetachedProviderTurnInput;
  release(): Promise<void>;
}> => {
  const diagnose = createDiagnosticEmitter(input);
  const withoutComputerUse = (reason: string, detail?: string) => {
    diagnose("computer_use.unavailable", {
      reason,
      ...(detail ? { detail: redactDiagnosticText(detail) } : {}),
      provider: input.agent.provider,
    });
    return { input, release: async () => undefined };
  };
  if (input.agent.computerUsePolicy !== "unattended") {
    return { input, release: async () => undefined };
  }
  if (input.runKind === "computerUse") {
    // A child launched for the desktop is a different case: it was spawned to
    // drive one, so a missing binding is a defect rather than a plain host.
    if (!input.computerUseBinding || !input.computerUseMcpServerPath) {
      throw new Error("Computer Use child is missing its display binding");
    }
    return { input, release: async () => undefined };
  }
  if (!supportsComputerUseProvider(input.agent.provider)) {
    return withoutComputerUse("provider_unsupported");
  }
  const mcpServerPath = await findAgentBundle(
    import.meta.dir,
    "computer-use-mcp-server.js",
  ).catch(() => null);
  if (!mcpServerPath) {
    return withoutComputerUse("mcp_bundle_missing");
  }
  let assigned;
  try {
    const client = await ComputerUseBoxClient.connect();
    assigned = await client.assign(input.agent.id);
  } catch (error) {
    return withoutComputerUse("box_unavailable", describeDiagnosticError(error));
  }
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

const maxSidecarFrameBytes = 16 * 1024 * 1024;

/**
 * A spawned runner process and everything that watches it. Splitting it out of
 * the turn lets a pre-warmed process be started before the prompt exists and
 * adopted by the turn that later uses it, without a second code path for the
 * supervision, the stderr diagnostics or the frame stream.
 */
type SpawnedRunnerProcess = {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exitPromise: Promise<number | null>;
  readonly frames: AsyncIterableIterator<RunnerToParent>;
  readonly supervisor: OwnedProcessSupervisor | null;
  stderrText(): string;
  flushStderrDiagnostic(diagnose: DiagnosticEmitter): void;
  /** Point the stderr diagnostics at the phase that now owns the process. */
  setDiagnose(next: DiagnosticEmitter): void;
};

function spawnRunnerProcess(
  runnerPath: string,
  workspacePath: string,
  environment: NodeJS.ProcessEnv,
  initialDiagnose: DiagnosticEmitter,
  processSupervisionAvailable: () => boolean,
): SpawnedRunnerProcess {
  let diagnose = initialDiagnose;
  const child = spawn(process.execPath, [runnerPath], {
    cwd: workspacePath,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
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
  let runnerStderrBuffer = "";
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
  return {
    child,
    exitPromise,
    frames: sizeDelimitedDecodeStream(RunnerToParentSchema, child.stdout, {
      readMaxBytes: maxSidecarFrameBytes,
    }),
    supervisor: child.pid && processSupervisionAvailable()
      ? new OwnedProcessSupervisor(child.pid)
      : null,
    stderrText: () => stderr,
    flushStderrDiagnostic: (emit) => {
      if (!runnerStderrBuffer.trim()) return;
      const diagnostic = runnerDiagnosticFromLine(runnerStderrBuffer.trim());
      if (!diagnostic) return;
      emit(diagnostic.phase, {
        runnerPid: child.pid ?? null,
        ...diagnostic.detail,
      });
    },
    setDiagnose: (next) => { diagnose = next; },
  };
}

export async function runDetachedProviderTurn(
  input: DetachedProviderTurnInput,
  prepared: PreparedDetachedProviderTurn | null = null,
): Promise<DetachedProviderTurnResult> {
  if (input.executionTools === "disabled") {
    await prepared?.discard("classification_turn");
    return runDetachedProviderClassification(input, runPreparedDetachedProviderTurn);
  }
  // A pre-warmed process is only usable for the turn it was prepared for. The
  // mismatch is resolved here, before anything else, so the rest of the turn
  // is the same code whether it spawns cold or adopts a warm process.
  const warm = prepared ? await claimPreparedRunner(prepared, input) : null;
  const command = await prepareDmMessageCommand(input);
  try {
    const computerUse = await prepareComputerUseTurn(command.input);
    try {
      return await runPreparedDetachedProviderTurn(computerUse.input, warm);
    }
    finally { await computerUse.release(); }
  } finally {
    await command.cleanup();
    // Never used, because the turn threw before it wrote its request.
    await warm?.discardUnused();
  }
}

async function runPreparedDetachedProviderTurn(
  input: DetachedProviderTurnInput,
  warm: ClaimedPreparedRunner | null = null,
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
    toolInheritance: input.toolInheritance === "briar" ? "briar" : "inherit",
  });
  const agentBinary = Bun.which(binaryName);
  if (!agentBinary) {
    diagnose("turn.binary_missing", { binaryName });
    throw new Error(`${binaryName} coding agent is not installed on this Worker`);
  }
  const runnerPath = await findAgentBundle(
    import.meta.dir,
    `${runnerProvider}-runner.js`,
  );
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
      supportsOwnedProcessSupervisor,
      warm,
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

export async function executeDetachedProviderTurn(
  input: DetachedProviderTurnInput,
  runnerPath: string,
  agentBinary: string,
  skillCatalog: DetachedAgentSkillCatalog | null,
  diagnose: DiagnosticEmitter,
  processSupervisionAvailable: () => boolean = supportsOwnedProcessSupervisor,
  warm: ClaimedPreparedRunner | null = null,
) {
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
    dmMessagePublicationBinding: input.dmMessagePublicationBinding,
    dmMessageMcpServerPath: input.dmMessageMcpServerPath,
    toolInheritance: input.toolInheritance,
    agentBinary,
  }).request;
  const requestFrame = encodeSidecarRunRequest(runnerRequest);
  const requestBytes = requestFrame.byteLength;
  diagnose("runner.spawn_start", {
    runnerPath,
    workspacePath: input.workspacePath,
    requestBytes,
    prewarmed: warm !== null,
  });
  const runner = warm === null
    ? spawnRunnerProcess(
      runnerPath,
      input.workspacePath,
      input.environment,
      diagnose,
      processSupervisionAvailable,
    )
    : warm.adopt(diagnose);
  const child = runner.child;
  const exitPromise = runner.exitPromise;
  const supervisor = runner.supervisor;
  let runnerError: string | null = null;
  let completed = false;
  let terminalOutputSeen = false;
  let block: ProviderBlock | null = null;
  let resultText: string | null = null;
  let conversationId = input.conversationId ?? null;
  let outputCount = 0;
  let stopPromise: Promise<void> | null = null;
  let stopFailed = false;
  let inFlightCapture: Promise<void> | null = null;
  let trackingFailed = false;
  let processPoll: ReturnType<typeof setInterval> | null = null;
  const signalRunnerTree = (signal: NodeJS.Signals) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    } else {
      child.kill(signal);
    }
  };
  const terminate = () => {
    if (stopPromise) return;
    if (!input.signal.aborted && (child.exitCode !== null || child.signalCode !== null)) return;
    diagnose("runner.terminate_requested", {
      runnerPid: child.pid ?? null,
      reason: input.signal.aborted ? "aborted" : "cleanup",
    });
    if (completed && !input.signal.aborted) {
      signalRunnerTree("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) signalRunnerTree("SIGKILL");
      }, 5_000).unref();
      return;
    }
    stopPromise = (async () => {
      try {
        if (!supervisor) throw new Error("process_owner_missing");
        await inFlightCapture;
        await supervisor.stopAndVerify();
        if (trackingFailed) throw new Error("process_tracking_incomplete");
        diagnose("runner.stop_confirmed", { runnerPid: child.pid ?? null });
      } catch {
        stopFailed = true;
        // Best effort for a failed host inspection. This is never a stop acknowledgement.
        if (child.exitCode === null && child.signalCode === null) {
          try { signalRunnerTree("SIGKILL"); } catch { /* The stop remains unconfirmed. */ }
        }
        diagnose("runner.stop_unconfirmed", { runnerPid: child.pid ?? null });
      }
    })();
  };
  const captureOwnedProcesses = () => {
    if (stopPromise || completed || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    inFlightCapture ??= (async () => {
      try { await supervisor?.capture(); }
      catch {
        if (!completed && child.exitCode === null && child.signalCode === null) trackingFailed = true;
      }
    })().finally(() => { inFlightCapture = null; });
    return inFlightCapture;
  };
  input.signal.addEventListener("abort", terminate, { once: true });

  try {
    // Ordinary turns remain available on hosts without verified process supervision.
    // Cancellation on those hosts remains unconfirmed through terminate().
    if (supervisor) {
      await supervisor.capture();
      processPoll = setInterval(() => { void captureOwnedProcesses(); }, 1_000);
      processPoll.unref();
    }
    input.signal.throwIfAborted();
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
    for await (const message of runner.frames) {
      if (input.signal.aborted) {
        terminate();
        await stopPromise;
        input.signal.throwIfAborted();
      }
      if (terminalOutputSeen) {
        throw new Error("Agent runner emitted output after a terminal frame");
      }
      const payload = message.payload;
      if (payload.case === undefined) {
        throw new Error("Agent runner emitted an empty protobuf output frame");
      }
      outputCount += 1;
      const payloadType = payload.case;
      if (payload.case === "event" && (
        payload.value.normalized?.event.case === "activityStarted" ||
        payload.value.normalized?.event.case === "activityCompleted"
      )) await captureOwnedProcesses();
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
    runner.flushStderrDiagnostic(diagnose);
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error("Worker execution was cancelled");
    }
    const stderr = runner.stderrText();
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
    if (processPoll) clearInterval(processPoll);
    input.signal.removeEventListener("abort", terminate);
    terminate();
    await stopPromise;
    await exitPromise.catch(() => null);
    if (stopFailed) {
      throw new DetachedProviderStopUnconfirmedError();
    }
  }
}

/*
  Pre-warming. A Codex turn spends its first seconds on work that is decided
  the moment the workspace is: starting `codex app-server`, the initialize
  handshake, reading the config, listing models and installed apps. None of it
  needs the prompt, so it can run beside the memory brief, the attachment
  downloads and the Skill catalog instead of after them.

  The prompt's developer instructions are what the thread request needs, so the
  prepared process stops exactly before `thread/start` and waits. Everything
  that decides how the App Server was started is fixed at that point, so the
  turn that later claims the process must agree on all of it; anything else is
  discarded for a cold spawn rather than silently run against the wrong setup.
*/

/** Everything a prepared runner process is already committed to. */
type PreparedProviderTurnKey = {
  provider: string;
  model: string | null;
  effort: string | null;
  computerUsePolicy: string;
  workspacePath: string;
  conversationId: string | null;
  fullAccess: boolean;
  readOnly: boolean;
  runKind: "parent" | "computerUse";
  toolInheritance: DetachedToolInheritance;
  browserAutomation: string | null;
};

function preparedProviderTurnKey(
  input: DetachedProviderTurnInput,
): PreparedProviderTurnKey {
  return {
    provider: input.agent.provider,
    model: input.agent.model,
    effort: input.agent.effort ?? null,
    computerUsePolicy: input.agent.computerUsePolicy ?? "disabled",
    workspacePath: input.workspacePath,
    conversationId: input.conversationId ?? null,
    fullAccess: input.fullAccess,
    readOnly: input.readOnly ?? false,
    runKind: input.runKind ?? "parent",
    toolInheritance: input.toolInheritance === "briar" ? "briar" : "inherit",
    browserAutomation:
      input.environment.BRIAR_BROWSER_AUTOMATION_PROVIDER ?? null,
  };
}

/** The name of the first field that changed, or null when the process fits. */
function preparedProviderTurnMismatch(
  prepared: PreparedProviderTurnKey,
  turn: PreparedProviderTurnKey,
): string | null {
  for (const key of Object.keys(prepared) as Array<keyof PreparedProviderTurnKey>) {
    if (prepared[key] !== turn[key]) return key;
  }
  return null;
}

/** A prepared process a turn has taken ownership of. */
export type ClaimedPreparedRunner = {
  adopt(diagnose: DiagnosticEmitter): SpawnedRunnerProcess;
  /** No-op once the turn adopted it. */
  discardUnused(): Promise<void>;
};

export type PreparedDetachedProviderTurn = {
  readonly provider: string;
  /** Run this turn, on the prepared process when it still fits. */
  run(input: DetachedProviderTurnInput): Promise<DetachedProviderTurnResult>;
  /** Kill the process and wait for it to go. Safe to call repeatedly. */
  discard(reason: string): Promise<void>;
};

type PreparedRunnerState = {
  key: PreparedProviderTurnKey;
  runner: SpawnedRunnerProcess;
  diagnose: DiagnosticEmitter;
  signal: AbortSignal;
  onAbort: () => void;
  taken: boolean;
  discarded: Promise<void> | null;
};

function killPreparedRunner(state: PreparedRunnerState, reason: string) {
  state.discarded ??= (async () => {
    state.signal.removeEventListener("abort", state.onAbort);
    const child = state.runner.child;
    state.diagnose("runner.prewarm_discarded", {
      reason,
      runnerPid: child.pid ?? null,
    });
    try { child.stdin.end(); } catch { /* Already gone. */ }
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
    }
    await state.runner.exitPromise.catch(() => null);
  })();
  return state.discarded;
}

/**
 * Resolve a prepared process against the turn that wants it. A process that no
 * longer fits is killed here and the turn spawns cold, which is the ordinary
 * path rather than a failure.
 */
export async function claimPreparedRunner(
  prepared: PreparedDetachedProviderTurn,
  input: DetachedProviderTurnInput,
): Promise<ClaimedPreparedRunner | null> {
  const state = preparedRunnerStates.get(prepared);
  if (!state) return null;
  if (state.taken || state.discarded) return null;
  const mismatch = preparedProviderTurnMismatch(
    state.key,
    preparedProviderTurnKey(input),
  );
  if (mismatch) {
    await killPreparedRunner(state, `changed:${mismatch}`);
    return null;
  }
  if (state.signal.aborted || state.runner.child.exitCode !== null) {
    await killPreparedRunner(state, "process_gone");
    return null;
  }
  state.taken = true;
  state.signal.removeEventListener("abort", state.onAbort);
  return {
    adopt: (diagnose) => {
      diagnose("runner.prewarm_used", {
        runnerPid: state.runner.child.pid ?? null,
      });
      state.runner.setDiagnose(diagnose);
      return state.runner;
    },
    discardUnused: async () => {
      // A turn that adopted the process already stopped it, by exit or signal.
      const child = state.runner.child;
      if (child.exitCode !== null || child.signalCode !== null) return;
      await killPreparedRunner(state, "unused");
    },
  };
}

const preparedRunnerStates = new WeakMap<
  PreparedDetachedProviderTurn,
  PreparedRunnerState
>();

/** Codex is the only provider whose process can be started before the prompt. */
const prewarmProviders = new Set(["codex"]);

/**
 * Start the provider process for a turn whose prompt does not exist yet.
 * Returns null whenever pre-warming does not apply or did not finish, so the
 * caller's turn spawns cold exactly as it does today.
 */
export async function prepareDetachedProviderTurn(
  input: DetachedProviderTurnInput,
  options: { readyTimeoutMs?: number } = {},
): Promise<PreparedDetachedProviderTurn | null> {
  const diagnose = createDiagnosticEmitter(input);
  const declined = (reason: string) => {
    diagnose("runner.prewarm_declined", { reason, provider: input.agent.provider });
    return null;
  };
  if (!prewarmProviders.has(input.agent.provider)) return declined("provider");
  if (input.executionTools === "disabled") return declined("classification_turn");
  // An unattended Agent's display is assigned inside the turn and would be
  // leased twice, so those turns keep the single-shot path.
  if (input.agent.computerUsePolicy === "unattended") return declined("computer_use");
  if (input.runKind === "computerUse") return declined("computer_use_child");
  if (input.signal.aborted) return declined("aborted");

  const binaryName = agentProviderBinaryName(input.agent.provider);
  const agentBinary = Bun.which(binaryName);
  if (!agentBinary) return declined("binary_missing");
  const runnerPath = await findAgentBundle(
    import.meta.dir,
    `${input.agent.provider}-runner.js`,
  ).catch(() => null);
  if (!runnerPath) return declined("runner_missing");
  return prepareDetachedProviderRunner(input, runnerPath, agentBinary, options);
}

/**
 * The pre-warm itself, once the runner bundle and the provider binary are
 * known. Split out for the same reason `executeDetachedProviderTurn` is: a
 * test drives it with its own runner script.
 */
export async function prepareDetachedProviderRunner(
  input: DetachedProviderTurnInput,
  runnerPath: string,
  agentBinary: string,
  options: { readyTimeoutMs?: number } = {},
): Promise<PreparedDetachedProviderTurn | null> {
  const diagnose = createDiagnosticEmitter(input);
  /*
    Only the fields the App Server is started with are filled. The prompt, its
    developer instructions, the attachments and the output schema arrive with
    the `run` frame, and the runner refuses a `run` that disagrees with what it
    was prepared with.
  */
  const prepareRequest = detachedProviderRequest({
    agent: input.agent,
    prompt: "",
    workspacePath: input.workspacePath,
    fullAccess: input.fullAccess,
    conversationId: input.conversationId,
    readOnly: input.readOnly,
    attachments: [],
    organizationContextManifestPath: null,
    skillCatalog: null,
    outputSchema: null,
    runKind: input.runKind,
    toolInheritance: input.toolInheritance,
    agentBinary,
  }).request;
  const frame = encodeSidecarPrepareRequest(prepareRequest);
  diagnose("runner.prewarm_start", {
    runnerPath,
    workspacePath: input.workspacePath,
    provider: input.agent.provider,
    requestBytes: frame.byteLength,
  });
  const runner = spawnRunnerProcess(
    runnerPath,
    input.workspacePath,
    input.environment,
    diagnose,
    supportsOwnedProcessSupervisor,
  );
  const onAbort = () => { void killPreparedRunner(state, "aborted"); };
  const state: PreparedRunnerState = {
    key: preparedProviderTurnKey(input),
    runner,
    diagnose,
    signal: input.signal,
    onAbort,
    taken: false,
    discarded: null,
  };
  input.signal.addEventListener("abort", onAbort, { once: true });
  const handle: PreparedDetachedProviderTurn = {
    provider: input.agent.provider,
    run: (turnInput) => runDetachedProviderTurn(turnInput, handle),
    // A turn that took the process owns its shutdown, so this only waits.
    discard: (reason) => state.taken
      ? state.runner.exitPromise.then(() => undefined, () => undefined)
      : killPreparedRunner(state, reason),
  };
  preparedRunnerStates.set(handle, state);
  try {
    runner.child.stdin.write(frame);
    await awaitRunnerPrepared(runner, options.readyTimeoutMs ?? 30_000);
  } catch (error) {
    diagnose("runner.prewarm_failed", {
      error: describeDiagnosticError(error),
      runnerPid: runner.child.pid ?? null,
    });
    await killPreparedRunner(state, "prepare_failed");
    return null;
  }
  diagnose("runner.prewarm_ready", { runnerPid: runner.child.pid ?? null });
  return handle;
}

/**
 * Read frames until the runner says it is prepared. The handshake events it
 * emits before that belong to no turn yet and are dropped; the turn's own
 * payload stream starts at the thread request.
 */
async function awaitRunnerPrepared(
  runner: SpawnedRunnerProcess,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("prewarm_timeout")),
      timeoutMs,
    );
    timer.unref();
  });
  try {
    for (;;) {
      const next = await Promise.race([runner.frames.next(), expiry]);
      if (next.done) {
        throw new Error(
          runner.stderrText().trim() ||
            "Agent runner exited before it was prepared",
        );
      }
      const payload = next.value.payload;
      if (payload.case === "prepared") return;
      // Provider handshake traffic. Everything else means the runner reached a
      // phase a prepared process must not be in yet.
      if (payload.case !== "event") {
        throw new Error(
          `Agent runner emitted ${payload.case ?? "an empty frame"} before it was prepared`,
        );
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
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
