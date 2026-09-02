import { randomUUID } from "node:crypto";
import { AcpJsonRpcConnection, type AcpJsonRpcMessage } from "./acp-json-rpc";
import {
  buildCursorPromptParts,
  createCursorEventState,
  cursorPermissionDecisionResult,
  cursorPermissionInput,
  cursorPermissionOptions,
  cursorPermissionToolName,
  cursorSessionMeta,
  cursorStopReasonSucceeded,
  finalizeCursorMessage,
  mapEffortToCursor,
  normalizeCursorSessionUpdate,
  resolveCursorFinalMessage,
  resolveCursorModelId,
  shouldAutoApproveCursorPermission,
  shouldDenyCursorPermission,
} from "./cursor-runner-lib";
import {
  providerInstructionSeatbeltPattern,
  readOnlySeatbeltSpawnSpec,
} from "./read-only-seatbelt";
import { createRunnerIo } from "./runner-io";
import { prepareComputerUseMcp } from "./computer-use-mcp-config";
import { acpComputerUseServers } from "./computer-use-provider-adapters";

const CURSOR_AUTH_METHOD = "cursor_login";

type CursorSessionSetup = {
  sessionId?: string;
  configOptions?: Array<{
    id?: string;
    name?: string;
    category?: string;
    type?: string;
    options?: Array<{
      value?: string;
      name?: string;
      options?: Array<{ value?: string; name?: string }>;
    }>;
  }>;
};

export function cursorAgentArgs() {
  return ["acp"];
}

export function cursorAgentSpawnSpec(input: {
  binary: string;
  workspaceRoot: string;
  environment: NodeJS.ProcessEnv;
  readOnly: boolean;
  platform?: NodeJS.Platform;
}) {
  const arguments_ = cursorAgentArgs();
  if (!input.readOnly) {
    return { command: input.binary, arguments: arguments_ };
  }
  const stateRoot = input.environment.HOME;
  if (!stateRoot) throw new Error("Cursor read-only state is not isolated");
  return readOnlySeatbeltSpawnSpec({
    providerName: "Cursor",
    binary: input.binary,
    arguments: arguments_,
    workspaceRoot: input.workspaceRoot,
    stateRoot,
    readOnly: true,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/[.]cursor(?:/.*)?$",
    ],
    platform: input.platform,
  });
}

function cursorRpcEnvelope(method: string, params: unknown, result: unknown) {
  return {
    jsonrpc: "2.0" as const,
    method,
    ...(params === undefined ? {} : { params }),
    result: result ?? null,
  };
}

function hasReplayMeta(message: AcpJsonRpcMessage) {
  if (!message.params || typeof message.params !== "object") return false;
  const meta = (message.params as Record<string, unknown>)._meta;
  return Boolean(
    meta && typeof meta === "object" &&
      (meta as Record<string, unknown>).isReplay === true,
  );
}

export function shouldSuppressCursorNotification(
  message: AcpJsonRpcMessage,
  sessionLoadInProgress: boolean,
) {
  return sessionLoadInProgress || hasReplayMeta(message);
}

function normalizedCursorEffort(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  return normalized === "extra-high" || normalized === "extra high"
    ? "xhigh"
    : normalized;
}

function cursorEffortConfigUpdate(
  setup: CursorSessionSetup | undefined,
  requestedEffort: string,
) {
  const options = setup?.configOptions ?? [];
  const candidates = options.filter((option) => {
    const id = option.id?.toLowerCase() ?? "";
    const name = option.name?.toLowerCase() ?? "";
    return id.includes("effort") || id.includes("reasoning") ||
      name.includes("effort") || name.includes("reasoning");
  });
  const config =
    candidates.find((option) => option.category?.toLowerCase() === "model_option") ??
    candidates.find((option) => option.id?.toLowerCase() === "effort") ??
    candidates[0];
  if (!config?.id) return undefined;
  const requested = normalizedCursorEffort(requestedEffort);
  const selections = (config.options ?? []).flatMap((option) =>
    option.options ?? [option]
  );
  const selected = selections.find((option) =>
    normalizedCursorEffort(option.value) === requested ||
    normalizedCursorEffort(option.name) === requested
  );
  return selected?.value
    ? { configId: config.id, value: selected.value }
    : undefined;
}

export function cursorModelConfigId(setup: CursorSessionSetup | undefined) {
  const options = setup?.configOptions ?? [];
  return options.find((option) =>
    option.category?.trim().toLowerCase() === "model" && option.id?.trim()
  )?.id ?? options.find((option) =>
    option.id?.trim().toLowerCase() === "model"
  )?.id ?? "model";
}

type CursorRunnerIo = ReturnType<typeof createRunnerIo>;

async function main(runnerIo: CursorRunnerIo) {
  const { emit, request: requestPromise, waitForApproval } = runnerIo;
  const request = await requestPromise;
  if (!request.message.trim()) {
    throw new Error("LLM에 보낼 메시지를 입력하세요.");
  }

  const readOnly = request.sandboxMode === "readOnly";
  const computerUseMcp = await prepareComputerUseMcp(request);
  const spawnSpec = cursorAgentSpawnSpec({
    binary: request.providerBinaryPath,
    workspaceRoot: request.workspaceRoot,
    environment: process.env,
    readOnly,
  });
  const connection = new AcpJsonRpcConnection({
    providerName: "Cursor Agent",
    command: spawnSpec.command,
    arguments: spawnSpec.arguments,
    cwd: request.workspaceRoot,
    environment: process.env,
  });
  const state = createCursorEventState();
  let approvalSequence = 0;
  let sessionLoadInProgress = false;

  try {
    connection.setHandlers({
      onNotification: (rpc) => {
        if (shouldSuppressCursorNotification(rpc, sessionLoadInProgress)) return;
        if (rpc.method !== "session/update") {
          emit.event({ raw: rpc });
          return;
        }
        const normalized = normalizeCursorSessionUpdate(rpc.params, state);
        if (normalized.events.length === 0) {
          emit.event({ raw: normalized.raw });
          return;
        }
        for (const event of normalized.events) {
          emit.event({ raw: normalized.raw, event });
        }
      },
      onServerRequest: async (rpc) => {
        if (rpc.id === undefined || rpc.id === null) return;
        if (rpc.method === "cursor/create_plan") {
          connection.respond(rpc.id, { accepted: true });
          return;
        }
        if (rpc.method === "cursor/ask_question") {
          connection.respond(rpc.id, { answers: {} });
          return;
        }
        if (rpc.method !== "session/request_permission") {
          connection.respond(rpc.id, {});
          return;
        }

        const toolName = cursorPermissionToolName(rpc.params);
        const input = cursorPermissionInput(rpc.params);
        const options = cursorPermissionOptions(rpc.params);
        if (await shouldDenyCursorPermission(request, toolName, input)) {
          connection.respond(
            rpc.id,
            cursorPermissionDecisionResult(options, false),
          );
          return;
        }
        if (shouldAutoApproveCursorPermission(request)) {
          connection.respond(
            rpc.id,
            cursorPermissionDecisionResult(options, true),
          );
          return;
        }

        const id = String(++approvalSequence);
        emit.approval({
          id,
          toolName,
          input,
          ...(typeof input.reason === "string" ? { title: input.reason } : {}),
        });
        connection.respond(
          rpc.id,
          cursorPermissionDecisionResult(options, await waitForApproval(id)),
        );
      },
    });

    await connection.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        _meta: { parameterizedModelPicker: true },
      },
      clientInfo: { name: "briar-desktop", version: "0.0.0" },
    });
    await connection.request("authenticate", { methodId: CURSOR_AUTH_METHOD });

    let setup: CursorSessionSetup | undefined;
    let sessionId: string;
    const resumeId = request.conversationId?.trim();
    const sessionMeta = cursorSessionMeta(request);
    if (resumeId) {
      const params = {
        sessionId: resumeId,
        cwd: request.workspaceRoot,
        mcpServers: acpComputerUseServers(computerUseMcp.servers),
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
      sessionLoadInProgress = true;
      try {
        setup = await connection.request("session/load", params) as CursorSessionSetup;
      } finally {
        sessionLoadInProgress = false;
      }
      emit.event({ raw: cursorRpcEnvelope("session/load", params, setup) });
      sessionId = setup?.sessionId?.trim() || resumeId;
    } else {
      const params = {
        cwd: request.workspaceRoot,
        mcpServers: acpComputerUseServers(computerUseMcp.servers),
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      };
      setup = await connection.request("session/new", params) as CursorSessionSetup;
      emit.event({ raw: cursorRpcEnvelope("session/new", params, setup) });
      sessionId = setup?.sessionId?.trim() || "";
      if (!sessionId) throw new Error("Cursor Agent did not return a session id.");
    }
    emit.session(sessionId);

    const modelParams = {
      sessionId,
      configId: cursorModelConfigId(setup),
      value: resolveCursorModelId(request.model),
    };
    const modelResult = await connection.request(
      "session/set_config_option",
      modelParams,
    ) as CursorSessionSetup | undefined;
    if (modelResult?.configOptions) {
      setup = { ...setup, configOptions: modelResult.configOptions };
    }
    emit.event({
      raw: cursorRpcEnvelope(
        "session/set_config_option",
        modelParams,
        modelResult,
      ),
    });

    const effort = mapEffortToCursor(request.effort);
    const effortUpdate = effort
      ? cursorEffortConfigUpdate(setup, effort)
      : undefined;
    if (effortUpdate) {
      try {
        await connection.request("session/set_config_option", {
          sessionId,
          ...effortUpdate,
        });
      } catch {
        // Cursor versions expose different reasoning controls; keep the
        // session's default when the selected option is unavailable.
      }
    }

    const promptId = randomUUID();
    const promptParams = {
      sessionId,
      prompt: await buildCursorPromptParts(request),
      messageId: promptId,
      _meta: { promptId, requestId: promptId },
    };
    emit.event({
      raw: {
        jsonrpc: "2.0",
        method: "briar/session/prompt_start",
        params: { sessionId, messageId: promptId, _meta: promptParams._meta },
      },
    });
    const promptResult = await connection.request(
      "session/prompt",
      promptParams,
    ) as { stopReason?: string; text?: string } | undefined;
    emit.event({
      raw: cursorRpcEnvelope(
        "session/prompt",
        { sessionId, messageId: promptId, _meta: promptParams._meta },
        promptResult,
      ),
    });

    for (const event of finalizeCursorMessage(state, promptResult?.stopReason)) {
      emit.event({ raw: { type: "turn", event }, event });
    }
    if (!cursorStopReasonSucceeded(promptResult?.stopReason)) {
      throw new Error(
        `Cursor turn did not complete successfully (stop reason: ${
          promptResult?.stopReason?.trim() || "missing"
        }).`,
      );
    }

    const finalMessage = resolveCursorFinalMessage(
      state,
      typeof promptResult?.text === "string" ? promptResult.text : undefined,
      request.outputSchema,
    );
    emit.result({
      sessionId,
      message: finalMessage || "(empty response)",
    });
  } finally {
    connection.close();
    await computerUseMcp.cleanup();
  }
}

export async function runCursorRunner() {
  const runnerIo = createRunnerIo({
    closeError: "Briar closed the Cursor runner input.",
  });
  try {
    await main(runnerIo);
  } catch (caught) {
    runnerIo.emit.error(
      caught instanceof Error ? caught.message : String(caught),
    );
    process.exitCode = 1;
  } finally {
    runnerIo.close();
  }
}

if (import.meta.main) void runCursorRunner();
