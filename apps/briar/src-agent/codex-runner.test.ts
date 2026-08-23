import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const runnerRequest = {
  type: "run",
  message: "Review the repository without using Figma.",
  workspaceRoot: process.cwd(),
  conversationId: null,
  instructions: "Complete the assigned workflow.",
  outputSchema: null,
  model: "gpt-5",
  effort: "high",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
};

describe("Codex runner MCP isolation", () => {
  it("restarts with an unused unauthenticated Figma plugin disabled", async () => {
    const result = await runScenario("optional");

    expect(result.exitCode).toBe(0);
    expect(result.payloads).toContainEqual(
      expect.objectContaining({
        type: "event",
        event: expect.objectContaining({
          type: "activityCompleted",
          title: "codex_apps MCP unavailable",
          status: "failed",
        }),
      }),
    );
    expect(result.payloads.filter((payload) => payload.type === "session"))
      .toHaveLength(1);
    expect(result.payloads).toContainEqual(
      expect.objectContaining({
        type: "event",
        direction: "client",
        raw: expect.objectContaining({
          method: "thread/resume",
          params: expect.objectContaining({
            config: {
              apps: { connector_figma: { enabled: false } },
            },
          }),
        }),
      }),
    );
    expect(result.payloads).toContainEqual({
      type: "result",
      sessionId: "thread-1",
      message: "Review and checks continued after Figma isolation.",
    });
    expect(result.payloads.some((payload) => payload.type === "error")).toBe(
      false,
    );
  });

  it("returns an authentication wait when the failed MCP was invoked", async () => {
    const result = await runScenario("required");

    expect(result.exitCode).toBe(0);
    expect(result.payloads).toContainEqual({
      type: "blocked",
      reason: "mcp_auth_required",
      provider: "codex",
      message: "Authentication is required for MCP server(s): Figma.",
      serverNames: ["Figma"],
      nextRetryAt: null,
    });
    expect(result.payloads.some((payload) => payload.type === "result")).toBe(
      false,
    );
    expect(result.payloads.some((payload) => payload.type === "error")).toBe(
      false,
    );
  });

  it("fails fast when the App Server emits a schema-invalid message", async () => {
    const result = await runScenario("invalid");

    expect(result.exitCode).toBe(1);
    expect(result.payloads).toContainEqual({
      type: "error",
      message:
        'Codex App Server emitted invalid JSON: {"id":1,"method":42}',
    });
  });
});

async function runScenario(scenario: "invalid" | "optional" | "required") {
  const directory = await mkdtemp(join(tmpdir(), "briar-codex-runner-test-"));
  const fakeCodex = join(directory, "fake-codex.mjs");
  await writeFile(fakeCodex, fakeCodexSource, "utf8");
  await chmod(fakeCodex, 0o755);
  const child = spawn("bun", [resolve("src-agent/codex-runner.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, FAKE_CODEX_SCENARIO: scenario },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.write(
    `${JSON.stringify({ ...runnerRequest, codexBinary: fakeCodex })}\n`,
  );

  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
    if (exitCode !== 0 && stderr) {
      throw new Error(`Codex runner failed: ${stderr}`);
    }
    const payloads = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
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
