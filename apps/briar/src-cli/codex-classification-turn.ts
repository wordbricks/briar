import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { decodeJsonRpcMessageJsonResult } from "../src-agent/json-rpc-message";
import { ensureReadOnlyAgentEnvironment } from "./read-only-agent-environment";
import type { DetachedProviderTurnInput, DetachedProviderTurnResult } from "./detached-provider-turn";

const execFileAsync = promisify(execFile);
const verifiedBinaries = new Map<string, { identity: string; supported: boolean }>();

const decodeThreadSchema = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
  properties: Schema.Struct({ environments: Schema.Struct({ type: Schema.Array(Schema.String) }) }),
})));

async function requireClassificationCapability(
  binary: string,
  input: Pick<DetachedProviderTurnInput, "environment" | "signal">,
) {
  const metadata = await stat(binary);
  const identity = `${metadata.ino}:${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.size}`;
  const cached = verifiedBinaries.get(binary);
  if (cached?.identity === identity) {
    if (cached.supported) return;
    throw new Error("codex_classification_isolation_unsupported");
  }
  const directory = await mkdtemp(join(tmpdir(), "briar-codex-classification-schema-"));
  try {
    // Older servers may silently ignore environments: []; inspect the installed protocol first.
    await execFileAsync(binary, ["app-server", "generate-json-schema", "--experimental", "--out", directory], {
      env: input.environment, signal: input.signal, timeout: 10_000, maxBuffer: 4096,
    });
    const schema = decodeThreadSchema(await readFile(join(directory, "v2", "ThreadStartParams.json"), "utf8"));
    if (!schema.properties.environments.type.includes("array")) throw new Error("Unsupported environments");
    if (verifiedBinaries.size >= 32) verifiedBinaries.clear();
    verifiedBinaries.set(binary, { identity, supported: true });
  } catch {
    input.signal.throwIfAborted();
    if (verifiedBinaries.size >= 32) verifiedBinaries.clear();
    verifiedBinaries.set(binary, { identity, supported: false });
    throw new Error("codex_classification_isolation_unsupported");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Advertise routing only when this installed executable supports environment-free turns. */
export async function supportsInstalledCodexClassification(environment: NodeJS.ProcessEnv): Promise<boolean> {
  // Routed execution also needs the descendant cleanup used to acknowledge cancellation.
  if (process.platform !== "darwin" && process.platform !== "linux") return false;
  const binary = Bun.which("codex", { PATH: environment.PATH });
  if (!binary) return false;
  try {
    await requireClassificationCapability(binary, { environment, signal: AbortSignal.timeout(15_000) });
    return true;
  } catch { return false; }
}

export function codexClassificationThreadParams(input: DetachedProviderTurnInput) {
  return {
    ...(input.agent.model ? { model: input.agent.model } : {}),
    cwd: input.workspacePath, sandbox: "read-only", approvalPolicy: "never", ephemeral: true,
    environments: [], selectedCapabilityRoots: [], dynamicTools: [],
    baseInstructions: input.agent.responsibility,
    config: {
      web_search: "disabled", agents: { enabled: false }, tools: { view_image: false, web_search: false },
      features: { shell_tool: false, unified_exec: false, apps: false, plugins: false,
        browser_use: false, computer_use: false, image_generation: false, view_image: false,
        multi_agent: false, workspace_dependencies: false, sleep_tool: false, goals: false,
        code_mode: false, hooks: false },
    },
  };
}

const decodeThread = Schema.decodeUnknownSync(Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) }));
const decodeCompletion = Schema.decodeUnknownSync(Schema.Struct({ turn: Schema.Struct({
  status: Schema.String,
  items: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String),
    phase: Schema.optional(Schema.NullOr(Schema.String)) })),
}) }));

/** No workspace environments or integrations. Inert host helpers may remain available. */
export async function runCodexClassificationTurn(
  input: DetachedProviderTurnInput,
  binary = Bun.which("codex"),
): Promise<DetachedProviderTurnResult> {
  if (!binary) throw new Error("codex_classification_binary_missing");
  const isolated = await ensureReadOnlyAgentEnvironment("codex", {
    readOnly: true, workspaceRoot: input.workspacePath, environment: input.environment,
  });
  try {
    await requireClassificationCapability(binary, { ...input, environment: isolated.environment });
    input.signal.throwIfAborted();
    const child = spawn(binary, ["app-server"], { cwd: input.workspacePath,
      env: isolated.environment, stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
    let processError = false;
    child.on("error", () => { processError = true; });
    child.stdin.on("error", () => { processError = true; });
    child.stderr.resume();
    const stop = () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
    };
    input.signal.addEventListener("abort", stop, { once: true });
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      send({ id: 1, method: "initialize", params: {
        clientInfo: { name: "briar_classifier", title: "Briar classifier", version: "1" },
        capabilities: { experimentalApi: true },
      } });
      for await (const line of lines) {
        input.signal.throwIfAborted();
        const decoded = decodeJsonRpcMessageJsonResult(line);
        if (Result.isFailure(decoded)) throw new Error("codex_classification_invalid_response");
        const message = decoded.success;
        // Deny every server-initiated request, including tools, approvals and user input.
        if (message.method && message.id != null) {
          send({ id: message.id, error: { code: -32601, message: "Execution tools are disabled for classification." } });
          continue;
        }
        if (message.error) throw new Error("codex_classification_request_failed");
        if (message.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "thread/start", params: codexClassificationThreadParams(input) });
        } else if (message.id === 2) {
          const { thread } = decodeThread(message.result);
          send({ id: 3, method: "turn/start", params: {
            threadId: thread.id, input: [{ type: "text", text: input.prompt }],
            ...(input.agent.effort ? { effort: input.agent.effort } : {}),
            ...(input.outputSchema != null ? { outputSchema: input.outputSchema } : {}),
          } });
        } else if (message.method === "turn/completed") {
          const { turn } = decodeCompletion(message.params);
          if (turn.status !== "completed") throw new Error("codex_classification_failed");
          const answers = turn.items.filter((item) => item.type === "agentMessage" && item.text);
          const answer = [...answers].reverse().find((item) => item.phase === "final_answer") ?? answers.at(-1);
          if (!answer?.text) throw new Error("codex_classification_missing_result");
          return { completed: true, exitCode: 0, stderr: "", runnerError: null,
            resultText: answer.text, conversationId: null };
        }
      }
      input.signal.throwIfAborted();
      throw new Error(processError ? "codex_classification_process_failed" : "codex_classification_missing_result");
    } finally {
      lines.close();
      input.signal.removeEventListener("abort", stop);
      child.stdin.end();
      stop();
      const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try { await exited; } finally { clearTimeout(force); }
    }
  } finally { await isolated.cleanup(); }
}
