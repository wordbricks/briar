import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  approvalResult,
  claudePrompt,
  claudeOptions,
  normalizeClaudeMessage,
  type ClaudeEventState,
  type ClaudeRunnerRequest,
} from "./claude-runner-lib";

const request: ClaudeRunnerRequest = {
  type: "run",
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "sonnet",
  effort: "high",
  approvalPolicy: "never",
  sandboxMode: "readOnly",
  networkAccess: false,
  claudeBinary: "/usr/local/bin/claude",
};

describe("Claude runner", () => {
  it("embeds common image attachments as Claude base64 content blocks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-claude-image-"));
    const path = join(directory, "screen.png");
    await writeFile(path, new Uint8Array([1, 2, 3, 4]));
    try {
      let message;
      for await (const item of claudePrompt({
        ...request,
        attachments: [{
          type: "image",
          path,
          name: "screen.png",
          mimeType: "image/png",
        }],
      })) {
        message = item;
      }
      expect(message?.message.content).toEqual([
        { type: "text", text: "Inspect the repository" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "AQIDBA==",
          },
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps read-only work offline and limits the tool surface", () => {
    const options = claudeOptions(request, vi.fn());

    expect(options.cwd).toBe("/repo");
    expect(options.model).toBe("sonnet");
    expect(options.effort).toBe("high");
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.tools).toEqual(["Read", "Glob", "Grep"]);
    expect(options.disallowedTools).toEqual(["WebFetch", "WebSearch"]);
    expect(options.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { deniedDomains: ["*"] },
    });
  });

  it("auto-approves only inside the mandatory sandbox", () => {
    const options = claudeOptions(
      {
        ...request,
        sandboxMode: "workspaceWrite",
        networkAccess: true,
      },
      vi.fn(),
    );

    expect(options.permissionMode).toBe("acceptEdits");
    expect(options.sandbox).toMatchObject({
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: ["*"] },
    });
  });

  it("opens every Claude permission for unrestricted project replies", () => {
    const canUseTool = vi.fn();
    const options = claudeOptions(
      {
        ...request,
        sandboxMode: "dangerFullAccess",
        networkAccess: true,
      },
      canUseTool,
    );

    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.sandbox).toBeUndefined();
    expect(options.tools).toBeUndefined();
    expect(options.allowedTools).toBeUndefined();
    expect(options.disallowedTools).toBeUndefined();
    expect(options.canUseTool).toBeUndefined();
  });

  it("normalizes streamed and final assistant text", () => {
    const state: ClaudeEventState = {
      activeMessageId: null,
      lastAssistantMessageId: null,
    };
    const started = {
      type: "stream_event",
      uuid: "event-1",
      session_id: "session-1",
      parent_tool_use_id: null,
      event: {
        type: "message_start",
        message: { id: "message-1" },
      },
    } as unknown as SDKMessage;
    const delta = {
      type: "stream_event",
      uuid: "event-2",
      session_id: "session-1",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello" },
      },
    } as unknown as SDKMessage;
    const result = {
      type: "result",
      subtype: "success",
      uuid: "result-1",
      session_id: "session-1",
      result: "hello",
    } as unknown as SDKMessage;

    expect(normalizeClaudeMessage(started, state)).toBeUndefined();
    expect(normalizeClaudeMessage(delta, state)).toEqual({
      type: "messageDelta",
      id: "message-1",
      delta: "hello",
    });
    expect(normalizeClaudeMessage(result, state)).toEqual({
      type: "messageCompleted",
      id: "result-1",
      phase: "final",
      text: "hello",
    });
  });

  it("maps Briar approval decisions to SDK permission results", () => {
    expect(approvalResult(true, { command: "bun test" })).toEqual({
      behavior: "allow",
      updatedInput: { command: "bun test" },
    });
    expect(approvalResult(false, {})).toMatchObject({ behavior: "deny" });
  });
});
