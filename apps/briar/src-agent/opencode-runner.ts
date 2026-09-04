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
  createOpenCodeUnhandledRejectionGuard,
  installOpenCodeRunnerSignalHandlers,
  isOpenCodeWritePermission,
  mapEffortToOpenCode,
  normalizeOpenCodeEvent,
  openCodeTerminalOutcome,
  openCodeTransientOverload,
  openCodePermissionInput,
  openCodeQuestionInput,
  openCodeResponseText,
  openCodeSystemPrompt,
  parseOpenCodeModel,
  shouldAutoApproveOpenCodePermission,
  type OpenCodeEventState,
  type OpenCodeUnhandledRejectionGuard,
} from "./opencode-runner-lib";
import { normalizedTurnCompleted } from "./normalized-agent-event";
import { ProviderBlockedError } from "./provider-block";
import { createRunnerIo } from "./runner-io";
import type { RunnerRequest } from "./runner-request";
import { waitForOpenCodeServerUrl } from "./opencode-server-startup";
import {
  providerInstructionSeatbeltPattern,
  readOnlySeatbeltProfile,
  readOnlySeatbeltSpawnSpec,
} from "./read-only-seatbelt";
import {
  prepareComputerUseMcp,
  type PreparedComputerUseMcp,
} from "./computer-use-mcp-config";
import { openCodeComputerUseEnvironment } from
  "./computer-use-provider-adapters";
import {
  ensureReadOnlyAgentEnvironment,
  type PreparedReadOnlyAgentEnvironment,
} from "./read-only-agent-environment";
import type { AgentProvider } from "../src/lib/agent-provider";

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

const openCodeStopEscalationMs = 2_000;

function signalOpenCodeProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signalling the direct process.
    }
  }
  child.kill(signal);
}

/**
 * Stop the OpenCode server process group.
 *
 * OpenCode does not always exit on SIGTERM while a request is still winding
 * down. Its open stdio pipes would then keep this runner's event loop alive
 * after the result was already delivered, so the pipes are dropped at once
 * and a SIGKILL follows when the process is still around shortly afterwards.
 */
export function stopOpenCodeProcess(
  child: ChildProcessWithoutNullStreams,
  escalateAfterMs = openCodeStopEscalationMs,
) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalOpenCodeProcess(child, "SIGTERM");
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.destroy();
  }
  child.unref();
  const escalation = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      signalOpenCodeProcess(child, "SIGKILL");
    }
  }, escalateAfterMs);
  child.once("exit", () => clearTimeout(escalation));
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

  /**
   * Resolve once the server process is gone, or once the SIGKILL escalation
   * in `stopOpenCodeProcess` has had its turn. The isolated state root is
   * removed only after this: OpenCode still writes caches into HOME while it
   * shuts down, and a removal racing those writes leaves the root behind.
   */
  exited(timeoutMs = openCodeStopEscalationMs + 500): Promise<void> {
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
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

/**
 * Resources a signal handler must release before the runner exits. They live
 * outside `main` because SIGTERM arrives while `main` is still awaiting.
 */
type OpenCodeRunnerResources = {
  server?: OpenCodeServer;
  computerUseMcp?: PreparedComputerUseMcp;
  isolation?: PreparedReadOnlyAgentEnvironment;
};

/**
 * OpenRouter runs behind the same OpenCode server, and the sidecar request
 * carries no provider id. Briar only ever sets `OPENCODE_CONFIG_CONTENT` for
 * the OpenRouter provider, so its presence selects the isolation allowlist
 * that keeps that generated config and the OpenRouter key.
 */
export function openCodeIsolationProvider(
  environment: NodeJS.ProcessEnv,
): AgentProvider {
  return environment.OPENCODE_CONFIG_CONTENT?.trim() ? "openrouter" : "opencode";
}

const activeResources: OpenCodeRunnerResources = {};

function closeOpenCodeRunnerResources() {
  const { server, computerUseMcp, isolation } = activeResources;
  activeResources.server = undefined;
  activeResources.computerUseMcp = undefined;
  activeResources.isolation = undefined;
  // Killing the opencode process group is synchronous; the Computer Use
  // temporary directory and the isolated read-only state removals are best
  // effort so they never delay the exit.
  server?.close();
  void computerUseMcp?.cleanup().catch(() => undefined);
  void isolation?.cleanup().catch(() => undefined);
}

async function main(
  runnerIo: OpenCodeRunnerIo,
  rejectionGuard: OpenCodeUnhandledRejectionGuard,
) {
  const { emit, request: requestPromise, waitForApproval } = runnerIo;
  emitRunnerDiagnostic("runner.request_waiting");
  const request = await requestPromise;
  // OpenRouter and other upstream providers run behind OpenCode; a block
  // names the upstream so the reader knows whose limit or account it is.
  const upstreamProvider = parseOpenCodeModel(request.model)?.providerID?.trim() ||
    "opencode";
  emitRunnerDiagnostic("runner.request_received", {
    workspaceRoot: request.workspaceRoot,
    opencodeBinary: request.providerBinaryPath,
    model: request.model ?? null,
    sandboxMode: request.sandboxMode,
    attachmentCount: request.attachments?.length ?? 0,
  });
  const computerUseMcp = await prepareComputerUseMcp(request);
  activeResources.computerUseMcp = computerUseMcp;
  // `openCodeServerSpawnSpec` uses HOME as the seatbelt state root, and
  // OpenCode recursively creates `$TMPDIR/opencode` on start. Both must point
  // inside the isolated root or the seatbelt denies them.
  const isolation = await ensureReadOnlyAgentEnvironment(
    openCodeIsolationProvider(process.env),
    {
      readOnly: request.sandboxMode === "readOnly",
      workspaceRoot: request.workspaceRoot,
      environment: process.env,
    },
  );
  activeResources.isolation = isolation;
  let server: OpenCodeServer | undefined;
  try {
    server = await OpenCodeServer.start(
      request.providerBinaryPath,
      request.workspaceRoot,
      openCodeComputerUseEnvironment(
        isolation.environment,
        computerUseMcp.servers,
      ),
      request.sandboxMode === "readOnly",
      emitRunnerDiagnostic,
    );
    activeResources.server = server;
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory: request.workspaceRoot,
      throwOnError: true,
    });
    const sessionId = await resolveSession(client, request);
    emit.session(sessionId);
    const eventState = createOpenCodeEventState();
    const controller = new AbortController();
    // The SDK's SSE client answers an aborted signal with a bare
    // `void reader.cancel()`, which rejects with the signal reason under Bun
    // and would otherwise kill the runner after a successful turn. Owning the
    // reason object lets the guard recognise exactly this rejection.
    const eventStreamAbortReason = new DOMException(
      "Briar closed the OpenCode event subscription.",
      "AbortError",
    );
    rejectionGuard.expect(eventStreamAbortReason);
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
        // OpenCode leaves the assistant message unfinished after a fatal
        // session error, so the pump must end the run itself; the prompt
        // request would otherwise stay open forever.
        const outcome = openCodeTerminalOutcome(
          raw,
          sessionId,
          upstreamProvider,
        );
        if (outcome) {
          if (outcome.type === "blocked") {
            throw new ProviderBlockedError(outcome.blocker);
          }
          throw new Error(`OpenCode session error: ${outcome.message}`);
        }
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
    // The pump only wins the race by failing; if it fails after the prompt
    // already won, that rejection must not surface as unhandled.
    const pumpFailure = eventPump.then(
      () => new Promise<never>(() => undefined),
    );
    pumpFailure.catch(() => undefined);
    const response = await Promise.race([prompt, pumpFailure]);
    controller.abort(eventStreamAbortReason);
    await eventPump.catch((caught) => {
      if (!controller.signal.aborted) throw caught;
    });
    if (!response.data) throw new Error("OpenCode completed without a response.");
    const responseError =
      "error" in response.data.info ? response.data.info.error : undefined;
    if (responseError) {
      const responseBlock = openCodeTransientOverload(
        responseError,
        upstreamProvider,
      );
      if (responseBlock) {
        throw new ProviderBlockedError(responseBlock);
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
    activeResources.server = undefined;
    activeResources.computerUseMcp = undefined;
    activeResources.isolation = undefined;
    server?.close();
    await server?.exited();
    await computerUseMcp.cleanup();
    await isolation.cleanup();
  }
}

export async function runOpenCodeRunner() {
  emitRunnerDiagnostic("runner.started");
  const runnerIo = createRunnerIo({
    closeError: "Briar closed the OpenCode runner input.",
    onClose: () => emitRunnerDiagnostic("runner.input_closed"),
  });
  installOpenCodeRunnerSignalHandlers({
    on: (signal, listener) => {
      process.once(signal, listener);
    },
    exit: (code) => process.exit(code),
    close: (signal) => {
      emitRunnerDiagnostic("runner.signal", { signal });
      closeOpenCodeRunnerResources();
      runnerIo.close();
    },
  });
  const rejectionGuard = createOpenCodeUnhandledRejectionGuard({
    diagnose: emitRunnerDiagnostic,
    fail: (reason) => {
      // Bun's default is to dump the rejection and die; keep that visible
      // failure for everything the runner did not raise on purpose.
      emitRunnerDiagnostic("runner.unhandled_rejection", {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? (reason.stack ?? null) : null,
      });
      process.exitCode = 1;
    },
  });
  process.on("unhandledRejection", rejectionGuard.handle);
  const { emit } = runnerIo;
  try {
    await main(runnerIo, rejectionGuard);
  } catch (caught) {
    emitRunnerDiagnostic("runner.failed", {
      error: caught instanceof Error ? caught.message : String(caught),
    });
    if (caught instanceof ProviderBlockedError) {
      emit.blocked(caught.block);
    } else {
      emit.error(caught instanceof Error ? caught.message : String(caught));
      process.exitCode = 1;
    }
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
