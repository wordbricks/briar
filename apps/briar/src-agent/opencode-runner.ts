import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import {
  createOpencodeClient,
  type OpencodeClient,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2";
import * as Effect from "effect/Effect";

import {
  approvedOpenCodeQuestionAnswers,
  buildOpenCodePermissionRules,
  buildOpenCodeParts,
  completeOpenCodeMessages,
  createOpenCodeEventState,
  isOpenCodeWritePermission,
  mapEffortToOpenCode,
  normalizeOpenCodeEvent,
  openCodeBlockedRetry,
  openCodeTransientOverload,
  openCodePermissionInput,
  openCodeQuestionInput,
  openCodeResponseText,
  openCodeSystemPrompt,
  parseOpenCodeModel,
  shouldAutoApproveOpenCodePermission,
  type OpenCodeBlockedRetry,
  type OpenCodeEventState,
} from "./opencode-runner-lib";
import { normalizedTurnCompleted } from "./normalized-agent-event";
import { createRunnerIo } from "./runner-io";
import type { RunnerRequest } from "./runner-request";
import { waitForOpenCodeServerUrl } from "./opencode-server-startup";
import {
  providerInstructionSeatbeltPattern,
  readOnlySeatbeltProfile,
  readOnlySeatbeltSpawnSpec,
} from "./read-only-seatbelt";
import { prepareComputerUseMcp } from "./computer-use-mcp-config";
import { openCodeComputerUseEnvironment } from
  "./computer-use-provider-adapters";

class OpenCodeBlockedError extends Error {
  constructor(readonly blocker: OpenCodeBlockedRetry) {
    super(blocker.message);
    this.name = "OpenCodeBlockedError";
  }
}

type RunnerDiagnostic = (
  phase: string,
  detail?: Record<string, unknown>,
) => void;

function emitRunnerDiagnostic(
  phase: string,
  detail: Record<string, unknown> = {},
) {
  try {
    process.stderr.write(
      `${JSON.stringify({
        event: "briar.runner",
        phase,
        pid: process.pid,
        at: new Date().toISOString(),
        ...detail,
      })}\n`,
    );
  } catch {
    // Diagnostics must never prevent the runner from completing its work.
  }
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("OpenCode server port allocation failed."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function stopOpenCodeProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to terminating the direct process.
    }
  }
  child.kill();
}

export function openCodeServerArgs(port: number, pure: boolean) {
  return [
    "serve",
    ...(pure ? ["--pure"] : []),
    "--hostname=127.0.0.1",
    `--port=${port}`,
  ];
}

export function openCodeServerEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    OPENCODE_CONFIG_CONTENT: environment.OPENCODE_CONFIG_CONTENT || "{}",
  };
}

export function openCodeReadOnlySeatbeltProfile(input: {
  workspaceRoot: string;
  stateRoot: string;
  executablePaths: string[];
}) {
  return readOnlySeatbeltProfile({
    ...input,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/(?:opencode[.]jsonc?|[.]opencode)(?:/.*)?$",
    ],
  });
}

export function openCodeServerSpawnSpec(input: {
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
  const stateRoot = input.environment.HOME;
  if (!stateRoot) {
    throw new Error("OpenCode read-only state is not isolated");
  }
  return readOnlySeatbeltSpawnSpec({
    providerName: "OpenCode",
    binary: input.binary,
    arguments: input.arguments,
    workspaceRoot: input.workspaceRoot,
    stateRoot,
    readOnly: true,
    deniedPathPatterns: [
      providerInstructionSeatbeltPattern,
      "/(?:opencode[.]jsonc?|[.]opencode)(?:/.*)?$",
    ],
    platform: input.platform,
  });
}

class OpenCodeServer {
  private constructor(
    readonly child: ChildProcessWithoutNullStreams,
    readonly url: string,
  ) {}

  static async start(
    binary: string,
    workspaceRoot: string,
    environment: NodeJS.ProcessEnv,
    pure: boolean,
    diagnose: RunnerDiagnostic = emitRunnerDiagnostic,
  ): Promise<OpenCodeServer> {
    const port = await availablePort();
    diagnose("opencode.port_allocated", { port, pure });
    const serverArgs = openCodeServerArgs(port, pure);
    const spawnSpec = openCodeServerSpawnSpec({
      binary,
      arguments: serverArgs,
      workspaceRoot,
      environment,
      readOnly: pure,
    });
    const child = spawn(
      spawnSpec.command,
      spawnSpec.arguments,
      {
        cwd: workspaceRoot,
        env: openCodeServerEnvironment(environment),
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    diagnose("opencode.spawned", {
      opencodePid: child.pid ?? null,
      port,
      pure,
    });
    let url: string;
    try {
      url = await Effect.runPromise(waitForOpenCodeServerUrl(child));
      diagnose("opencode.ready", {
        opencodePid: child.pid ?? null,
        port,
        url,
      });
    } catch (caught) {
      diagnose("opencode.start_failed", {
        opencodePid: child.pid ?? null,
        port,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      stopOpenCodeProcess(child);
      throw caught;
    }
    return new OpenCodeServer(child, url);
  }

  close() {
    emitRunnerDiagnostic("opencode.close_requested", {
      opencodePid: this.child.pid ?? null,
    });
    stopOpenCodeProcess(this.child);
  }
}

async function resolveSession(
  client: OpencodeClient,
  request: RunnerRequest,
): Promise<string> {
  const permissions = buildOpenCodePermissionRules(request);
  if (request.conversationId) {
    try {
      const current = await client.session.get({ sessionID: request.conversationId });
      if (current.data) {
        const session =
          current.data.directory && current.data.directory !== request.workspaceRoot
            ? await client.session.fork({
                sessionID: current.data.id,
                directory: request.workspaceRoot,
              })
            : current;
        if (session.data) {
          await client.session.update({
            sessionID: session.data.id,
            permission: permissions,
          });
          return session.data.id;
        }
      }
    } catch (caught) {
      const status =
        caught && typeof caught === "object" && "response" in caught
          ? (caught.response as { status?: unknown } | undefined)?.status
          : undefined;
      if (status !== 404) throw caught;
    }
  }
  const created = await client.session.create({ permission: permissions });
  if (!created.data) throw new Error("OpenCode did not return a session.");
  return created.data.id;
}

type OpenCodeFinalResponse = {
  info: { id: string };
  parts: readonly unknown[];
};

/**
 * Build terminal runner events while keeping the complete SDK response on
 * every event. In particular, step-finish parts carry provider/model/usage
 * details that are not present on response.info alone.
 */
export function openCodeFinalTurnOutputs(
  response: OpenCodeFinalResponse,
  eventState: OpenCodeEventState,
  message: string,
) {
  return [
    ...completeOpenCodeMessages(eventState, {
      messageId: response.info.id,
      text: message,
      phase: "final",
    }).map((event) => ({
      raw: response,
      event,
    })),
    {
      raw: response,
      event: normalizedTurnCompleted("completed"),
    },
  ];
}

type OpenCodeRunnerIo = ReturnType<typeof createRunnerIo>;

async function main(runnerIo: OpenCodeRunnerIo) {
  const { emit, request: requestPromise, waitForApproval } = runnerIo;
  emitRunnerDiagnostic("runner.request_waiting");
  const request = await requestPromise;
  emitRunnerDiagnostic("runner.request_received", {
    workspaceRoot: request.workspaceRoot,
    opencodeBinary: request.providerBinaryPath,
    model: request.model ?? null,
    sandboxMode: request.sandboxMode,
    attachmentCount: request.attachments?.length ?? 0,
  });
  const computerUseMcp = await prepareComputerUseMcp(request);
  let server: OpenCodeServer | undefined;
  try {
    server = await OpenCodeServer.start(
      request.providerBinaryPath,
      request.workspaceRoot,
      openCodeComputerUseEnvironment(process.env, computerUseMcp.servers),
      request.sandboxMode === "readOnly",
      emitRunnerDiagnostic,
    );
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory: request.workspaceRoot,
      throwOnError: true,
    });
    const sessionId = await resolveSession(client, request);
    emit.session(sessionId);
    const eventState = createOpenCodeEventState();
    const controller = new AbortController();
    const subscription = await client.event.subscribe(undefined, {
      signal: controller.signal,
    });
    const eventPump = (async () => {
      for await (const raw of subscription.stream) {
        const normalizedEvents = normalizeOpenCodeEvent(raw, sessionId, eventState);
        if (normalizedEvents.length === 0) {
          emit.event({ raw });
        } else {
          for (const event of normalizedEvents) {
            emit.event({ raw, event });
          }
        }
        const blockedRetry = openCodeBlockedRetry(raw, sessionId);
        if (blockedRetry) throw new OpenCodeBlockedError(blockedRetry);
        if (!raw || typeof raw !== "object") continue;
        const event = raw as { type?: unknown; properties?: unknown };
        const properties =
          event.properties && typeof event.properties === "object"
            ? (event.properties as Record<string, unknown>)
            : undefined;
        if (!properties || properties.sessionID !== sessionId) continue;

        if (event.type === "permission.asked") {
          const id = typeof properties.id === "string" ? properties.id : "";
          const permission =
            typeof properties.permission === "string" ? properties.permission : "unknown";
          if (!id) continue;
          let approved = shouldAutoApproveOpenCodePermission(request, permission);
          if (
            !approved &&
            !(
              request.sandboxMode === "readOnly" &&
              isOpenCodeWritePermission(permission)
            )
          ) {
            emit.approval({
              id,
              toolName: permission,
              input: openCodePermissionInput(properties),
              title: `OpenCode requests ${permission} permission`,
            });
            approved = await waitForApproval(id);
          }
          await client.permission.reply({
            requestID: id,
            reply: approved ? "once" : "reject",
          });
        }

        if (event.type === "question.asked") {
          const question = properties as unknown as QuestionRequest;
          emit.approval({
            id: question.id,
            toolName: "question",
            input: openCodeQuestionInput(question),
            title: question.questions[0]?.question ?? "OpenCode needs input",
          });
          if (await waitForApproval(question.id)) {
            await client.question.reply({
              requestID: question.id,
              answers: approvedOpenCodeQuestionAnswers(question),
            });
          } else {
            await client.question.reject({ requestID: question.id });
          }
        }
      }
    })();

    const model = parseOpenCodeModel(request.model);
    const parts = buildOpenCodeParts(request);
    const prompt = client.session.prompt({
      sessionID: sessionId,
      ...(openCodeSystemPrompt(request)
        ? { system: openCodeSystemPrompt(request) }
        : {}),
      ...(model ? { model } : {}),
      ...(mapEffortToOpenCode(request.effort)
        ? { variant: mapEffortToOpenCode(request.effort) }
        : {}),
      parts,
    });
    const response = await Promise.race([
      prompt,
      eventPump.then(() => new Promise<never>(() => undefined)),
    ]);
    controller.abort();
    await eventPump.catch((caught) => {
      if (!controller.signal.aborted) throw caught;
    });
    if (!response.data) throw new Error("OpenCode completed without a response.");
    const responseError =
      "error" in response.data.info ? response.data.info.error : undefined;
    if (responseError) {
      const transientOverload = openCodeTransientOverload(responseError);
      if (transientOverload) {
        throw new OpenCodeBlockedError(transientOverload);
      }
      throw new Error(
        `OpenCode assistant response failed: ${JSON.stringify(responseError)}`,
      );
    }
    const message = openCodeResponseText(response.data.parts);
    for (const output of openCodeFinalTurnOutputs(
      response.data,
      eventState,
      message,
    )) {
      emit.event(output);
    }
    emit.result({ sessionId, message });
  } finally {
    server?.close();
    await computerUseMcp.cleanup();
  }
}

export async function runOpenCodeRunner() {
  emitRunnerDiagnostic("runner.started");
  const runnerIo = createRunnerIo({
    closeError: "Briar closed the OpenCode runner input.",
    onClose: () => emitRunnerDiagnostic("runner.input_closed"),
  });
  const { emit } = runnerIo;
  try {
    await main(runnerIo);
  } catch (caught) {
    emitRunnerDiagnostic("runner.failed", {
      error: caught instanceof Error ? caught.message : String(caught),
    });
    if (caught instanceof OpenCodeBlockedError) {
      emit.blocked(caught.blocker);
    } else {
      emit.error(caught instanceof Error ? caught.message : String(caught));
    }
    process.exitCode = 1;
  } finally {
    runnerIo.close();
    emitRunnerDiagnostic("runner.closed", {
      exitCode: process.exitCode ?? 0,
    });
  }
}

if (import.meta.main) {
  void runOpenCodeRunner();
}
