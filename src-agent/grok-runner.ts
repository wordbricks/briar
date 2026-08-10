import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  BRIAR_OAUTH_REFERRER,
  buildGrokPromptParts,
  createGrokEventState,
  finalizeGrokMessage,
  GROK_OAUTH2_REFERRER_ENV,
  grokSessionMeta,
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
  shouldDenyWritePermission,
  type GrokRunnerOutput,
  type GrokRunnerRequest,
  type JsonRpcMessage,
} from "./grok-runner-lib";
import { createRunnerIo } from "./runner-io";

class GrokAcpConnection {
  private nextId = 0;
  private buffer = "";
  private readonly pending = new Map<
    number | string,
    {
      resolve: (message: JsonRpcMessage) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly child: ChildProcessWithoutNullStreams;
  private closed = false;
  private onNotification:
    | ((message: JsonRpcMessage) => void | Promise<void>)
    | undefined;
  private onServerRequest:
    | ((message: JsonRpcMessage) => void | Promise<void>)
    | undefined;

  constructor(
    grokBinary: string,
    workspaceRoot: string,
    environment: NodeJS.ProcessEnv,
  ) {
    this.child = spawn(grokBinary, ["agent", "stdio"], {
      cwd: workspaceRoot,
      env: {
        ...environment,
        [GROK_OAUTH2_REFERRER_ENV]: BRIAR_OAUTH_REFERRER,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", () => {
      // Grok may log diagnostics to stderr; surface only on hard failure.
    });
    this.child.on("error", (error) => {
      this.failAll(error);
    });
    this.child.on("close", (code) => {
      this.closed = true;
      this.failAll(
        new Error(
          code === 0 || code === null
            ? "Grok agent stdio closed unexpectedly."
            : `Grok agent stdio exited with code ${code}.`,
        ),
      );
    });
  }

  setHandlers(input: {
    onNotification?: (message: JsonRpcMessage) => void | Promise<void>;
    onServerRequest?: (message: JsonRpcMessage) => void | Promise<void>;
  }) {
    this.onNotification = input.onNotification;
    this.onServerRequest = input.onServerRequest;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      throw new Error("Grok agent stdio is not running.");
    }
    const id = ++this.nextId;
    const payload: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const response = await new Promise<JsonRpcMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
    if (response.error) {
      throw new Error(
        response.error.message || `Grok ACP ${method} failed.`,
      );
    }
    return response.result;
  }

  respond(id: number | string, result: unknown) {
    if (this.closed) return;
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.child.kill();
  }

  private onStdout(chunk: string) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string) {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined && message.id !== null && !message.method) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending.resolve(message);
      }
      return;
    }

    if (message.method && message.id !== undefined && message.id !== null) {
      void this.onServerRequest?.(message);
      return;
    }

    if (message.method) {
      void this.onNotification?.(message);
    }
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
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
  typeof createRunnerIo<GrokRunnerRequest, GrokRunnerOutput>
>;

async function main(runnerIo: GrokRunnerIo) {
  const { emit, request: requestPromise, waitForApproval } = runnerIo;
  const request = await requestPromise;
  const message = request.message.trim();
  if (!message) {
    throw new Error("LLM에 보낼 메시지를 입력하세요.");
  }

  const connection = new GrokAcpConnection(
    request.grokBinary,
    request.workspaceRoot,
    process.env,
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

          if (shouldDenyWritePermission(request, toolName)) {
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
  const runnerIo = createRunnerIo<GrokRunnerRequest, GrokRunnerOutput>({
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
