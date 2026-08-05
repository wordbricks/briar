import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import {
  createOpencodeClient,
  type OpencodeClient,
  type QuestionRequest,
} from "@opencode-ai/sdk/v2";

import {
  approvedOpenCodeQuestionAnswers,
  buildOpenCodePermissionRules,
  buildOpenCodePrompt,
  completeOpenCodeMessages,
  createOpenCodeEventState,
  isOpenCodeWritePermission,
  mapEffortToOpenCode,
  normalizeOpenCodeEvent,
  openCodePermissionInput,
  openCodeQuestionInput,
  openCodeResponseText,
  parseOpenCodeModel,
  parseOpenCodeServerUrl,
  shouldAutoApproveOpenCodePermission,
  type OpenCodeApprovalResponse,
  type OpenCodeRunnerOutput,
  type OpenCodeRunnerRequest,
} from "./opencode-runner-lib";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

function emit(output: OpenCodeRunnerOutput) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

let resolveRequest: ((request: OpenCodeRunnerRequest) => void) | undefined;
let rejectRequest: ((error: Error) => void) | undefined;
const requestPromise = new Promise<OpenCodeRunnerRequest>((resolve, reject) => {
  resolveRequest = resolve;
  rejectRequest = reject;
});
const approvalResolvers = new Map<string, (approved: boolean) => void>();

lines.on("line", (line) => {
  try {
    const message = JSON.parse(line) as OpenCodeRunnerRequest | OpenCodeApprovalResponse;
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
    rejectRequest?.(caught instanceof Error ? caught : new Error(String(caught)));
  }
});

lines.on("close", () => {
  rejectRequest?.(new Error("Briar closed the OpenCode runner input."));
  for (const resolve of approvalResolvers.values()) resolve(false);
  approvalResolvers.clear();
});

function waitForApproval(id: string): Promise<boolean> {
  return new Promise((resolve) => approvalResolvers.set(id, resolve));
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

class OpenCodeServer {
  private constructor(
    readonly child: ChildProcessWithoutNullStreams,
    readonly url: string,
  ) {}

  static async start(
    binary: string,
    workspaceRoot: string,
    environment: NodeJS.ProcessEnv,
  ): Promise<OpenCodeServer> {
    const port = await availablePort();
    const child = spawn(
      binary,
      ["serve", "--hostname=127.0.0.1", `--port=${port}`],
      {
        cwd: workspaceRoot,
        env: { ...environment, OPENCODE_CONFIG_CONTENT: "{}" },
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "";
    let settled = false;
    let url: string;
    try {
      url = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for OpenCode server startup.\n${output}`));
        }, 30_000);
        const succeed = (value: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        };
        child.once("error", fail);
        child.once("close", (code) => {
          fail(
            new Error(
              `OpenCode server exited before startup${code === null ? "" : ` (code ${code})`}.\n${output}`,
            ),
          );
        });
        const inspect = (chunk: Buffer | string) => {
          output += chunk.toString();
          const parsed = parseOpenCodeServerUrl(output);
          if (parsed) succeed(parsed);
        };
        child.stdout.on("data", inspect);
        child.stderr.on("data", inspect);
      });
    } catch (caught) {
      stopOpenCodeProcess(child);
      throw caught;
    }
    return new OpenCodeServer(child, url);
  }

  close() {
    stopOpenCodeProcess(this.child);
  }
}

async function resolveSession(
  client: OpencodeClient,
  request: OpenCodeRunnerRequest,
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

async function main() {
  const request = await requestPromise;
  const server = await OpenCodeServer.start(
    request.opencodeBinary,
    request.workspaceRoot,
    process.env,
  );
  try {
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory: request.workspaceRoot,
      throwOnError: true,
    });
    const sessionId = await resolveSession(client, request);
    emit({ type: "session", sessionId });
    const eventState = createOpenCodeEventState();
    const controller = new AbortController();
    const subscription = await client.event.subscribe(undefined, {
      signal: controller.signal,
    });
    const eventPump = (async () => {
      for await (const raw of subscription.stream) {
        const normalizedEvents = normalizeOpenCodeEvent(raw, sessionId, eventState);
        if (normalizedEvents.length === 0) {
          emit({ type: "event", raw });
        } else {
          for (const event of normalizedEvents) {
            emit({ type: "event", raw, event });
          }
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
            emit({
              type: "approval",
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
          emit({
            type: "approval",
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
    const response = await client.session.prompt({
      sessionID: sessionId,
      ...(model ? { model } : {}),
      ...(mapEffortToOpenCode(request.effort)
        ? { variant: mapEffortToOpenCode(request.effort) }
        : {}),
      parts: [{ type: "text", text: buildOpenCodePrompt(request) }],
    });
    controller.abort();
    await eventPump.catch((caught) => {
      if (!controller.signal.aborted) throw caught;
    });
    if (!response.data) throw new Error("OpenCode completed without a response.");
    const responseError =
      "error" in response.data.info ? response.data.info.error : undefined;
    if (responseError) {
      throw new Error(
        `OpenCode assistant response failed: ${JSON.stringify(responseError)}`,
      );
    }
    const message = openCodeResponseText(response.data.parts);
    for (const event of completeOpenCodeMessages(eventState, {
      messageId: response.data.info.id,
      text: message,
      phase: "final",
    })) {
      emit({
        type: "event",
        raw: response.data,
        event,
      });
    }
    emit({
      type: "event",
      raw: response.data.info,
      event: { type: "turnCompleted", status: "completed" },
    });
    emit({ type: "result", sessionId, message });
  } finally {
    server.close();
  }
}

void main()
  .catch((caught) => {
    emit({ type: "error", message: caught instanceof Error ? caught.message : String(caught) });
    process.exitCode = 1;
  })
  .finally(() => lines.close());
