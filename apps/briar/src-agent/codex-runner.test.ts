import { create } from "@bufbuild/protobuf";
import { sizeDelimitedDecodeStream } from "@bufbuild/protobuf/wire";
import { ProviderBlockReason } from "@briar/contracts/gen/briar/types/v1/provider_block_pb";
import { CONTRACTS_DESCRIPTOR_FINGERPRINT } from "@briar/contracts/descriptor-fingerprint";
import {
  ApprovalPolicy,
  RunRequestSchema,
  RunnerToParentSchema,
  SandboxMode,
  type RunnerToParent,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { AgentActivityStatus } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  encodeSidecarPrepareRequest,
  encodeSidecarRunRequest,
  sidecarProviderRaw,
} from "./sidecar-protocol";

const runnerRequest = (providerBinaryPath: string) =>
  create(RunRequestSchema, {
    message: "Review the repository without using Figma.",
    workspaceRoot: process.cwd(),
    instructions: "Complete the assigned workflow.",
    model: "gpt-5",
    effort: "high",
    approvalPolicy: ApprovalPolicy.NEVER,
    sandboxMode: SandboxMode.WORKSPACE_WRITE,
    networkAccess: true,
    providerBinaryPath,
    protocolFingerprint: CONTRACTS_DESCRIPTOR_FINGERPRINT,
  });

describe("Codex runner MCP isolation", () => {
  it("restarts with an unused unauthenticated Figma plugin disabled", async () => {
    const result = await runScenario("optional");

    expect(result.exitCode).toBe(0);
    expect(result.payloads.some((payload) => {
      const normalized = payload.payload.case === "event"
        ? payload.payload.value.normalized
        : undefined;
      return normalized?.event.case === "activityCompleted" &&
        normalized.event.value.title === "codex_apps MCP unavailable" &&
        normalized.event.value.status === AgentActivityStatus.FAILED;
    })).toBe(true);
    expect(
      result.payloads.filter(
        (payload) => payload.payload.case === "sessionStarted",
      ),
    )
      .toHaveLength(1);
    expect(result.payloads.some((payload) => {
      const raw = sidecarProviderRaw(payload);
      if (!raw || typeof raw !== "object") return false;
      const record = raw as Record<string, unknown>;
      return record.method === "thread/resume" &&
        JSON.stringify(record.params).includes("connector_figma");
    })).toBe(true);
    expect(result.payloads).toContainEqual(expect.objectContaining({
      payload: {
        case: "result",
        value: expect.objectContaining({
          sessionId: "thread-1",
          message: "Review and checks continued after Figma isolation.",
        }),
      },
    }));
    expect(
      result.payloads.some((payload) => payload.payload.case === "error"),
    ).toBe(false);
  });

  it("returns an authentication wait when the failed MCP was invoked", async () => {
    const result = await runScenario("required");

    expect(result.exitCode).toBe(0);
    expect(result.payloads).toContainEqual(expect.objectContaining({
      payload: {
        case: "blocked",
        value: expect.objectContaining({
          block: expect.objectContaining({
            reason: ProviderBlockReason.MCP_AUTH_REQUIRED,
            provider: "codex",
            message: "Authentication is required for MCP server(s): Figma.",
            serverNames: ["Figma"],
          }),
        }),
      },
    }));
    expect(
      result.payloads.some((payload) => payload.payload.case === "result"),
    ).toBe(false);
    expect(
      result.payloads.some((payload) => payload.payload.case === "error"),
    ).toBe(false);
  });

  /*
    A DM reply waits on the App Server starting before its prompt can reach the
    model, and none of that start needs the prompt. The split holds only if the
    runner stops at exactly the right place: everything up to the installed-apps
    response runs without a prompt, and the thread request — which carries the
    turn's developer instructions — waits for one.
  */
  it("starts the App Server before the prompt and stops at the thread request", async () => {
    const result = await runScenario("prepared", "two");

    expect(result.exitCode).toBe(0);
    const preparedAt = result.payloads.findIndex(
      (payload) => payload.payload.case === "prepared",
    );
    expect(preparedAt).toBeGreaterThan(0);
    const clientMethods = result.payloads.map((payload) => {
      const raw = sidecarProviderRaw(payload);
      return raw && typeof raw === "object"
        ? (raw as Record<string, unknown>).method
        : undefined;
    });
    // The handshake ran without a prompt.
    expect(clientMethods.slice(0, preparedAt)).toContain("initialize");
    expect(clientMethods.slice(0, preparedAt)).toContain("config/read");
    expect(clientMethods.slice(0, preparedAt)).toContain("app/installed");
    // The thread request is the first thing the prompt is needed for.
    expect(clientMethods.slice(0, preparedAt)).not.toContain("thread/start");
    expect(clientMethods.slice(preparedAt)).toContain("thread/start");
    expect(clientMethods.slice(preparedAt)).toContain("turn/start");
    expect(result.payloads).toContainEqual(expect.objectContaining({
      payload: {
        case: "result",
        value: expect.objectContaining({
          sessionId: "thread-1",
          message: "The prepared process answered this turn.",
        }),
      },
    }));
  });

  it("answers a single-shot request without a prepared frame", async () => {
    const result = await runScenario("prepared");

    expect(result.exitCode).toBe(0);
    expect(
      result.payloads.some((payload) => payload.payload.case === "prepared"),
    ).toBe(false);
    expect(result.payloads).toContainEqual(expect.objectContaining({
      payload: {
        case: "result",
        value: expect.objectContaining({ sessionId: "thread-1" }),
      },
    }));
  });

  it("fails fast when the App Server emits a schema-invalid message", async () => {
    const result = await runScenario("invalid");

    expect(result.exitCode).toBe(1);
    expect(result.payloads).toContainEqual(expect.objectContaining({
      payload: {
        case: "error",
        value: expect.objectContaining({
          message:
            'Codex App Server emitted invalid JSON: {"id":1,"method":42}',
        }),
      },
    }));
  });
});

async function runScenario(
  scenario: "invalid" | "optional" | "required" | "prepared",
  phases: "single" | "two" = "single",
) {
  const directory = await mkdtemp(join(tmpdir(), "briar-codex-runner-test-"));
  const fakeCodex = join(directory, "fake-codex.mjs");
  await writeFile(fakeCodex, fakeCodexSource, "utf8");
  await chmod(fakeCodex, 0o755);
  const child = spawn("bun", [resolve("src-agent/codex-runner.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, FAKE_CODEX_SCENARIO: scenario },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  let announcePrepared = () => {};
  const preparedSeen = new Promise<void>((resolvePrepared) => {
    announcePrepared = resolvePrepared;
  });
  const outputPromise = (async () => {
    const payloads: RunnerToParent[] = [];
    for await (const message of sizeDelimitedDecodeStream(
      RunnerToParentSchema,
      child.stdout,
      { readMaxBytes: 16 * 1024 * 1024 },
    )) {
      payloads.push(message);
      if (message.payload.case === "prepared") announcePrepared();
    }
    // A runner that died before it was prepared must not hang the test.
    announcePrepared();
    return payloads;
  })();
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  if (phases === "two") {
    /*
      The prepare frame carries no prompt: the App Server starts, the runner
      answers `prepared`, and only then is the turn's own request written.
    */
    child.stdin.write(encodeSidecarPrepareRequest(
      create(RunRequestSchema, { ...runnerRequest(fakeCodex), message: "" }),
    ));
    await preparedSeen;
  }
  child.stdin.write(encodeSidecarRunRequest(runnerRequest(fakeCodex)));

  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
    const diagnosticStderr = stderr
      .split("\n")
      .filter((line) =>
        !line.includes("NO_COLOR") &&
        !line.includes("trace-warnings") &&
        line.trim().length > 0,
      )
      .join("\n");
    if (exitCode !== 0 && diagnosticStderr) {
      throw new Error(`Codex runner failed: ${diagnosticStderr}`);
    }
    const payloads = await outputPromise;
    return { exitCode, payloads };
  } finally {
    clearTimeout(timeout);
    await rm(directory, { recursive: true, force: true });
  }
}

const fakeCodexSource = `#!/usr/bin/env node
import { createInterface } from "node:readline";

const scenario = process.env.FAKE_CODEX_SCENARIO;
let isolated = false;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");

for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    if (scenario === "invalid") {
      process.stdout.write('{"id":1,"method":42}\\n');
      continue;
    }
    send({ id: message.id, result: {} });
    continue;
  }
  if (message.method === "config/read") {
    send({
      id: message.id,
      result: {
        config: {
          model: "gpt-5",
          plugins: { "figma@openai-curated": { enabled: true } },
        },
      },
    });
    continue;
  }
  if (message.method === "app/installed") {
    send({
      id: message.id,
      result: {
        apps: [{
          id: "connector_figma",
          runtimeName: "Figma",
          enabled: true,
          callable: false,
        }],
      },
    });
    continue;
  }
  if (message.method === "turn/start" && scenario === "prepared") {
    send({ id: message.id, result: { turn: { id: "turn-1" } } });
    send({
      method: "item/completed",
      params: {
        item: {
          id: "message-1",
          type: "agentMessage",
          phase: "final_answer",
          text: "The prepared process answered this turn.",
        },
      },
    });
    send({
      method: "turn/completed",
      params: { turn: { id: "turn-1", status: "completed", items: [] } },
    });
    continue;
  }
  if (message.method === "thread/start" || message.method === "thread/resume") {
    isolated =
      message.params?.config?.apps?.connector_figma?.enabled === false;
    send({ id: message.id, result: { thread: { id: "thread-1" } } });
    continue;
  }
  if (message.method !== "turn/start") continue;

  const turnId = isolated ? "turn-2" : "turn-1";
  send({ id: message.id, result: { turn: { id: turnId } } });
  if (isolated) {
    send({
      method: "item/completed",
      params: {
        item: {
          id: "message-2",
          type: "agentMessage",
          phase: "final_answer",
          text: "Review and checks continued after Figma isolation.",
        },
      },
    });
    send({
      method: "turn/completed",
      params: { turn: { id: turnId, status: "completed", items: [] } },
    });
    continue;
  }

  send({
    method: "mcpServer/startupStatus/updated",
    params: {
      threadId: "thread-1",
      name: "codex_apps",
      status: "failed",
      error: "Figma connector transport worker quit with fatal: AuthRequired",
      failureReason: "reauthenticationRequired",
    },
  });
  if (scenario === "required") {
    send({
      method: "item/started",
      params: {
        item: {
          id: "figma-call-1",
          type: "mcpToolCall",
          server: "codex_apps",
          tool: "get_design_context",
          pluginId: "figma@openai-curated",
          status: "inProgress",
        },
      },
    });
  }
  send({
    method: "turn/completed",
    params: {
      turn: {
        id: turnId,
        status: "failed",
        error: { message: "codex_apps Figma transport stopped after AuthRequired" },
        items: [],
      },
    },
  });
}
`;
