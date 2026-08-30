import { randomUUID } from "node:crypto";
import {
  BRIAR_OAUTH_REFERRER,
  buildGrokPromptParts,
  createGrokEventState,
  finalizeGrokMessage,
  GROK_OAUTH2_REFERRER_ENV,
  grokSessionMeta,
  grokStopReasonSucceeded,
  mapEffortToGrok,
  normalizeGrokSessionUpdate,
  permissionDecisionResult,
  permissionInput,
  permissionOptions,
  permissionToolName,
  resolveGrokAuthMethodId,
  resolveGrokFinalMessage,
  resolveGrokModelId,
  shouldAutoApprovePermission,
  shouldDenyGrokPermission,
  type GrokRunnerOutput,
  type JsonRpcMessage,
} from "./grok-runner-lib";
import { createRunnerIo } from "./runner-io";
import {
  providerInstructionSeatbeltPattern,
  readOnlySeatbeltSpawnSpec,
} from "./read-only-seatbelt";
import { AcpJsonRpcConnection } from "./acp-json-rpc";

class GrokAcpConnection extends AcpJsonRpcConnection {
  constructor(
    grokBinary: string,
    workspaceRoot: string,
    environment: NodeJS.ProcessEnv,
    readOnly: boolean,
  ) {
    const spawnSpec = grokAgentSpawnSpec({
      binary: grokBinary,
      arguments: grokAgentArgs(readOnly),
      workspaceRoot,
      environment,
      readOnly,
    });
    super({
      providerName: "Grok Agent",
      command: spawnSpec.command,
      arguments: spawnSpec.arguments,
      cwd: workspaceRoot,
      environment: grokAgentEnvironment(environment, readOnly),
    });
  }
}

export function grokAgentArgs(readOnly: boolean) {
  return readOnly
    ? [
        "--disable-web-search",
        "--no-memory",
        "--no-subagents",
        "agent",
        "--no-leader",
        "stdio",
      ]
    : ["agent", "stdio"];
}

export function grokAgentEnvironment(
  environment: NodeJS.ProcessEnv,
  readOnly: boolean,
) {
  return {
    ...environment,
    // macOS Seatbelt cannot be nested. The outer Briar profile is stricter
    // than Grok's broad built-in strict profile and covers every child tool.
    ...(readOnly ? { GROK_SANDBOX: "off" } : {}),
    [GROK_OAUTH2_REFERRER_ENV]: BRIAR_OAUTH_REFERRER,
  };
}

export function grokAgentSpawnSpec(input: {
  binary: string;
  arguments: string[];
  workspaceRoot: string;
  environment: NodeJS.ProcessEnv;
  readOnly: boolean;
  platform?: NodeJS.Platform;
}) {
  if (!input.readOnly) {
    return { command: input.binary, arguments: input.arguments };
  }
  const stateRoot = input.environment.GROK_HOME;
  if (!stateRoot) throw new Error("Grok read-only state is not isolated");
  return readOnlySeatbeltSpawnSpec({
    providerName: "Grok",
    binary: input.binary,
    arguments: input.arguments,
    workspaceRoot: input.workspaceRoot,
    stateRoot,
    readOnly: true,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/[.]grok(?:/.*)?$",
    ],
    platform: input.platform,
  });
}

export function grokRpcResultEnvelope(
  method: string,
  params: unknown,
  result: unknown,
) {
  return {
    jsonrpc: "2.0" as const,
    method,
    ...(params === undefined ? {} : { params }),
    result: result ?? null,
  };
}

export function createGrokPromptInvocation(
  sessionId: string,
  prompt: unknown,
  allocateId: () => string = randomUUID,
) {
  const promptId = allocateId();
  return {
    promptId,
    params: {
      sessionId,
      prompt,
      messageId: promptId,
      _meta: {
        promptId,
        requestId: promptId,
      },
    },
  };
}

export function grokPromptResultEnvelope(
  invocation: ReturnType<typeof createGrokPromptInvocation>,
  result: unknown,
) {
  const { sessionId, messageId, _meta } = invocation.params;
  return grokRpcResultEnvelope(
    "session/prompt",
    { sessionId, messageId, _meta },
    result,
  );
}

export function grokPromptStartEnvelope(
  invocation: ReturnType<typeof createGrokPromptInvocation>,
) {
  const { sessionId, messageId, _meta } = invocation.params;
  return {
    jsonrpc: "2.0" as const,
    method: "briar/session/prompt_start",
    params: { sessionId, messageId, _meta },
  };
}

function hasReplayMeta(message: JsonRpcMessage): boolean {
  if (!message.params || typeof message.params !== "object") return false;
  const meta = (message.params as Record<string, unknown>)._meta;
  return Boolean(
    meta &&
      typeof meta === "object" &&
      (meta as Record<string, unknown>).isReplay === true,
  );
}

/**
 * Grok can replay both standard and private notifications while session/load
 * is pending. Once loading ends, private xAI completion notifications remain
 * visible so a live turn can still be correlated and accounted for.
 */
export function shouldSuppressGrokNotification(
  message: JsonRpcMessage,
  sessionLoadInProgress: boolean,
): boolean {
  if (hasReplayMeta(message)) return true;
  return sessionLoadInProgress;
}

type GrokRunnerIo = ReturnType<
  typeof createRunnerIo<GrokRunnerOutput>
>;

async function main(runnerIo: GrokRunnerIo) {
  const { emit, request: requestPromise, waitForApproval } = runnerIo;
  const request = await requestPromise;
  const message = request.message.trim();
  if (!message) {
    throw new Error("LLM에 보낼 메시지를 입력하세요.");
  }

  const connection = new GrokAcpConnection(
    request.providerBinaryPath,
    request.workspaceRoot,
    process.env,
    request.sandboxMode === "readOnly",
  );
  const state = createGrokEventState();
  let approvalSequence = 0;
  let sessionLoadInProgress = false;

  try {
    connection.setHandlers({
      onNotification: (rpc) => {
        if (shouldSuppressGrokNotification(rpc, sessionLoadInProgress)) {
          return;
        }
        if (rpc.method !== "session/update") {
          emit({ type: "event", raw: rpc });
          return;
        }
        const normalized = normalizeGrokSessionUpdate(rpc.params, state);
        if (normalized.events.length === 0) {
          emit({ type: "event", raw: normalized.raw });
        } else {
          for (const event of normalized.events) {
            emit({ type: "event", raw: normalized.raw, event });
          }
        }
      },
      onServerRequest: async (rpc) => {
        if (rpc.id === undefined || rpc.id === null) return;

        if (rpc.method === "session/request_permission") {
          const toolName = permissionToolName(rpc.params);
          const input = permissionInput(rpc.params);
          const options = permissionOptions(rpc.params);

          if (await shouldDenyGrokPermission(request, toolName, input)) {
            connection.respond(
              rpc.id,
              permissionDecisionResult(options, false),
            );
            return;
          }

          if (shouldAutoApprovePermission(request)) {
            connection.respond(
              rpc.id,
              permissionDecisionResult(options, true),
            );
            return;
          }

          const id = String(++approvalSequence);
          emit({
            type: "approval",
            id,
            toolName,
            input,
            ...(typeof input.reason === "string"
              ? { title: input.reason }
              : {}),
          });
          const approved = await waitForApproval(id);
          connection.respond(
            rpc.id,
            permissionDecisionResult(options, approved),
          );
          return;
        }

        // Grok may request client fs/terminal capabilities we do not expose.
        connection.respond(rpc.id, {});
      },
    });

    await connection.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
      },
      clientInfo: { name: "briar-desktop", version: "0.0.0" },
    });

    await connection.request("authenticate", {
      methodId: resolveGrokAuthMethodId(process.env),
    });

    let sessionId: string;
    const resumeId = request.conversationId?.trim();
    const sessionMeta = grokSessionMeta(request);
    if (resumeId) {
      const loadParams = {
        sessionId: resumeId,
        cwd: request.workspaceRoot,
        mcpServers: [],
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
      let loaded: {
        sessionId?: string;
        models?: { currentModelId?: string };
      } | undefined;
      sessionLoadInProgress = true;
      try {
        loaded = (await connection.request(
          "session/load",
          loadParams,
        )) as typeof loaded;
      } finally {
        sessionLoadInProgress = false;
      }
      emit({
        type: "event",
        raw: grokRpcResultEnvelope("session/load", loadParams, loaded),
      });
      sessionId = loaded?.sessionId?.trim() || resumeId;
    } else {
      const newParams = {
        cwd: request.workspaceRoot,
        mcpServers: [],
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
      const created = (await connection.request(
        "session/new",
        newParams,
      )) as {
        sessionId?: string;
        models?: { currentModelId?: string };
      };
      emit({
        type: "event",
        raw: grokRpcResultEnvelope("session/new", newParams, created),
      });
      sessionId = created.sessionId?.trim() || "";
      if (!sessionId) {
        throw new Error("Grok agent did not return a session id.");
      }
    }
    emit({ type: "session", sessionId });

    const modelId = resolveGrokModelId(request.model);
    if (modelId) {
      try {
        const setModelParams = {
          sessionId,
          modelId,
        };
        const setModelResult = await connection.request(
          "session/set_model",
          setModelParams,
        );
        emit({
          type: "event",
          raw: grokRpcResultEnvelope(
            "session/set_model",
            setModelParams,
            setModelResult,
          ),
        });
      } catch {
        // Older Grok builds may lack set_model; continue with session default.
      }
    }

    const effort = mapEffortToGrok(request.effort);
    if (effort) {
      try {
        await connection.request("session/set_config_option", {
          sessionId,
          configId: "reasoning_effort",
          value: effort,
        });
      } catch {
        // Effort selection is best-effort across Grok versions.
      }
    }

    const prompt = await buildGrokPromptParts(request);
    const promptInvocation = createGrokPromptInvocation(sessionId, prompt);
    emit({
      type: "event",
      raw: grokPromptStartEnvelope(promptInvocation),
    });
    const promptResult = (await connection.request(
      "session/prompt",
      promptInvocation.params,
    )) as { stopReason?: string; text?: string } | undefined;
    emit({
      type: "event",
      raw: grokPromptResultEnvelope(promptInvocation, promptResult),
    });

    for (const event of finalizeGrokMessage(state, promptResult?.stopReason)) {
      emit({
        type: "event",
        raw: { type: "turn", event },
        event,
      });
    }
    if (!grokStopReasonSucceeded(promptResult?.stopReason)) {
      throw new Error(
        `Grok turn did not complete successfully (stop reason: ${
          promptResult?.stopReason?.trim() || "missing"
        }).`,
      );
    }

    const finalMessage = resolveGrokFinalMessage(
      state,
      typeof promptResult?.text === "string" ? promptResult.text : undefined,
      request.outputSchema,
    );
    emit({
      type: "result",
      sessionId,
      message: finalMessage || "(empty response)",
    });
  } finally {
    connection.close();
  }
}

export async function runGrokRunner() {
  const runnerIo = createRunnerIo<GrokRunnerOutput>({
    closeError: "Briar closed the Grok runner input.",
  });
  const { emit } = runnerIo;
  try {
    await main(runnerIo);
  } catch (caught) {
    emit({
      type: "error",
      message: caught instanceof Error ? caught.message : String(caught),
    });
    process.exitCode = 1;
  } finally {
    runnerIo.close();
  }
}

if (import.meta.main) {
  void runGrokRunner();
}
