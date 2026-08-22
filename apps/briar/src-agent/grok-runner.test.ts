import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prepareReadOnlyAgentEnvironment } from "../src-cli/read-only-agent-environment";

const installedGrokBinary = (process.env.PATH ?? "")
  .split(delimiter)
  .map((directory) => join(directory, "grok"))
  .find(existsSync);

import {
  createGrokPromptInvocation,
  grokAgentArgs,
  grokAgentEnvironment,
  grokAgentSpawnSpec,
  grokPromptResultEnvelope,
  grokPromptStartEnvelope,
  grokRpcResultEnvelope,
  shouldSuppressGrokNotification,
} from "./grok-runner";

describe("Grok runner protocol preservation", () => {
  it("forces local, offline Grok mode for read-only turns", () => {
    expect(grokAgentArgs(true)).toEqual([
      "--disable-web-search",
      "--no-memory",
      "--no-subagents",
      "agent",
      "--no-leader",
      "stdio",
    ]);
    expect(grokAgentArgs(false)).toEqual(["agent", "stdio"]);
  });

  it("fails closed when a read-only Grok OS sandbox is unavailable", () => {
    expect(() =>
      grokAgentSpawnSpec({
        binary: "/bin/echo",
        arguments: ["agent", "stdio"],
        workspaceRoot: "/repo",
        environment: { GROK_HOME: "/private/tmp/grok-state" },
        readOnly: true,
        platform: "linux",
      })
    ).toThrow("require the macOS OS sandbox");
    expect(
      grokAgentSpawnSpec({
        binary: "/bin/echo",
        arguments: ["agent", "stdio"],
        workspaceRoot: "/repo",
        environment: {},
        readOnly: false,
      }),
    ).toEqual({ command: "/bin/echo", arguments: ["agent", "stdio"] });
  });

  it("uses only the outer Seatbelt profile for read-only Grok", () => {
    expect(
      grokAgentEnvironment(
        { GROK_SANDBOX: "briar_read_only", GROK_HOME: "/state" },
        true,
      ),
    ).toMatchObject({ GROK_SANDBOX: "off", GROK_HOME: "/state" });
  });

  it.skipIf(process.platform !== "darwin" || !installedGrokBinary)(
    "starts the installed Grok CLI without loading project instructions",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "briar-grok-seatbelt-"));
      const workspaceRoot = join(root, "repo");
      await mkdir(workspaceRoot);
      await writeFile(
        join(workspaceRoot, "AGENT.md"),
        "BRIAR_UNTRUSTED_GROK_INSTRUCTION",
      );
      const prepared = await prepareReadOnlyAgentEnvironment("grok", {
        workspaceRoot,
      });
      try {
        const binary = installedGrokBinary!;
        const spec = grokAgentSpawnSpec({
          binary,
          arguments: ["inspect", "--json"],
          workspaceRoot,
          environment: prepared.environment,
          readOnly: true,
        });
        const result = spawnSync(spec.command, spec.arguments, {
          cwd: workspaceRoot,
          env: grokAgentEnvironment(prepared.environment, true),
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain(
          "BRIAR_UNTRUSTED_GROK_INSTRUCTION",
        );
      } finally {
        await prepared.cleanup();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("uses one prompt UUID for messageId and both xAI correlation keys", () => {
    const promptId = "cc559dac-1597-4a72-a155-c8f5a6c46231";
    const allocateId = vi.fn(() => promptId);
    const prompt = [{ type: "text", text: "Inspect the repository" }];

    const invocation = createGrokPromptInvocation(
      "session-1",
      prompt,
      allocateId,
    );

    expect(allocateId).toHaveBeenCalledTimes(1);
    expect(invocation).toEqual({
      promptId,
      params: {
        sessionId: "session-1",
        prompt,
        messageId: promptId,
        _meta: {
          promptId,
          requestId: promptId,
        },
      },
    });
  });

  it("retains setup model state, successful model selection, and prompt results", () => {
    expect(
      grokRpcResultEnvelope(
        "session/new",
        { cwd: "/repo", mcpServers: [] },
        {
          sessionId: "session-1",
          models: { currentModelId: "grok-4.5" },
        },
      ),
    ).toEqual({
      jsonrpc: "2.0",
      method: "session/new",
      params: { cwd: "/repo", mcpServers: [] },
      result: {
        sessionId: "session-1",
        models: { currentModelId: "grok-4.5" },
      },
    });
    expect(
      grokRpcResultEnvelope(
        "session/set_model",
        { sessionId: "session-1", modelId: "grok-code-fast-1" },
        undefined,
      ),
    ).toMatchObject({
      method: "session/set_model",
      params: { sessionId: "session-1", modelId: "grok-code-fast-1" },
      result: null,
    });
    const promptInvocation = createGrokPromptInvocation(
      "session-1",
      [{ type: "image", data: "large-sensitive-base64" }],
      () => "prompt-1",
    );
    const promptEnvelope = grokPromptResultEnvelope(promptInvocation, {
      stopReason: "end_turn",
      _meta: { usage: { inputTokens: 10, outputTokens: 5 } },
    });
    expect(promptEnvelope).toMatchObject({
      method: "session/prompt",
      params: {
        sessionId: "session-1",
        messageId: "prompt-1",
        _meta: { promptId: "prompt-1", requestId: "prompt-1" },
      },
      result: {
        stopReason: "end_turn",
        _meta: { usage: { inputTokens: 10, outputTokens: 5 } },
      },
    });
    expect(promptInvocation.params).toHaveProperty("prompt");
    expect(promptEnvelope.params).not.toHaveProperty("prompt");
    expect(grokPromptStartEnvelope(promptInvocation)).toEqual({
      jsonrpc: "2.0",
      method: "briar/session/prompt_start",
      params: {
        sessionId: "session-1",
        messageId: "prompt-1",
        _meta: { promptId: "prompt-1", requestId: "prompt-1" },
      },
    });
    expect(grokPromptStartEnvelope(promptInvocation).params).not.toHaveProperty(
      "prompt",
    );
  });

  it("suppresses load replay and _meta.isReplay session updates", () => {
    const liveUpdate = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "live" },
        },
      },
    };
    const markedReplay = {
      ...liveUpdate,
      params: {
        ...liveUpdate.params,
        _meta: { isReplay: true },
      },
    };

    expect(shouldSuppressGrokNotification(liveUpdate, true)).toBe(true);
    expect(shouldSuppressGrokNotification(markedReplay, false)).toBe(true);
    expect(shouldSuppressGrokNotification(liveUpdate, false)).toBe(false);
  });

  it("suppresses private load replay but keeps live xAI prompt completion", () => {
    const completion = {
      jsonrpc: "2.0",
      method: "_x.ai/session/prompt_complete",
      params: {
        sessionId: "session-1",
        promptId: "prompt-1",
        stopReason: "end_turn",
      },
    };

    expect(shouldSuppressGrokNotification(completion, true)).toBe(true);
    expect(shouldSuppressGrokNotification(completion, false)).toBe(false);
    expect(
      shouldSuppressGrokNotification(
        {
          ...completion,
          params: { ...completion.params, _meta: { isReplay: true } },
        },
        false,
      ),
    ).toBe(true);
  });
});
