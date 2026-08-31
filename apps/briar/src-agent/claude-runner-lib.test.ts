import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AgentActivityKind,
  AgentActivityStatus,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  normalizedActivityCompleted,
  normalizedActivityStarted,
  normalizedMessageCompleted,
  normalizedMessageDelta,
} from "./normalized-agent-event";
import {
  approvalResult,
  claudePrompt,
  claudeOptions,
  createClaudeEventState,
  normalizeClaudeMessage,
  type ClaudeEventState,
} from "./claude-runner-lib";
import type { RunnerRequest } from "./runner-request";

const request: RunnerRequest = {
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "sonnet",
  effort: "high",
  approvalPolicy: "never",
  sandboxMode: "readOnly",
  networkAccess: false,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/usr/local/bin/claude",
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
    expect(options.settingSources).toEqual([]);
    expect(options.skills).toEqual([]);
    expect(options.disallowedTools).toEqual(["WebFetch", "WebSearch"]);
    expect(options.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { deniedDomains: ["*"] },
      filesystem: {
        denyRead: [parse(resolve("/repo")).root],
        allowRead: [resolve("/repo")],
      },
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
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(options.skills).toBe("all");
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
      activities: new Map(),
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

    expect(normalizeClaudeMessage(started, state)).toEqual([]);
    expect(normalizeClaudeMessage(delta, state)).toEqual([
      normalizedMessageDelta({
      id: "message-1",
      delta: "hello",
      }),
    ]);
    expect(normalizeClaudeMessage(result, state)).toEqual([
      normalizedMessageCompleted({
      id: "result-1",
      phase: "final",
      text: "hello",
      }),
    ]);
  });

  it("normalizes Claude tool success, failure, and permission cancellation", () => {
    const state = createClaudeEventState();
    const toolStart = (id: string, command: string) => ({
      type: "stream_event",
      uuid: `stream-${id}`,
      session_id: "session-1",
      parent_tool_use_id: null,
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id,
          name: "Bash",
          input: { command },
        },
      },
    }) as unknown as SDKMessage;
    const toolResult = (
      id: string,
      text: string,
      isError = false,
    ) => ({
      type: "user",
      uuid: `result-${id}`,
      session_id: "session-1",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: id,
          content: [{ type: "text", text }],
          is_error: isError,
        }],
      },
    }) as unknown as SDKMessage;

    expect(normalizeClaudeMessage(toolStart("tool-ok", "bun test"), state)).toEqual([
      normalizedActivityStarted({
      id: "tool-ok",
      kind: AgentActivityKind.COMMAND,
      title: "bun test",
      text: "",
      }),
    ]);
    expect(normalizeClaudeMessage(toolResult("tool-ok", "38 tests passed"), state)).toEqual([
      normalizedActivityCompleted({
      id: "tool-ok",
      kind: AgentActivityKind.COMMAND,
      title: "bun test",
      text: "38 tests passed",
      status: AgentActivityStatus.COMPLETED,
      }),
    ]);

    normalizeClaudeMessage(toolStart("tool-failed", "bun test"), state);
    expect(
      normalizeClaudeMessage(toolResult("tool-failed", "1 test failed", true), state),
    ).toEqual([normalizedActivityCompleted({
      id: "tool-failed",
      kind: AgentActivityKind.COMMAND,
      title: "bun test",
      text: "1 test failed",
      status: AgentActivityStatus.FAILED,
    })]);

    normalizeClaudeMessage(toolStart("tool-denied", "git push"), state);
    expect(normalizeClaudeMessage({
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      tool_use_id: "tool-denied",
      decision_reason: "The user declined this command.",
      message: "Permission denied",
      uuid: "permission-tool-denied",
      session_id: "session-1",
    } as unknown as SDKMessage, state)).toEqual([normalizedActivityCompleted({
      id: "tool-denied",
      kind: AgentActivityKind.COMMAND,
      title: "git push",
      text: "The user declined this command.",
      status: AgentActivityStatus.CANCELLED,
    })]);
  });

  it("keeps assistant text and parallel tool starts from the same frame", () => {
    const state = createClaudeEventState();
    const events = normalizeClaudeMessage({
      type: "assistant",
      uuid: "assistant-frame-1",
      session_id: "session-1",
      parent_tool_use_id: null,
      message: {
        id: "message-1",
        role: "assistant",
        content: [
          { type: "text", text: "Checking both files." },
          {
            type: "tool_use",
            id: "read-1",
            name: "Read",
            input: { file_path: "src/one.ts" },
          },
          {
            type: "tool_use",
            id: "read-2",
            name: "Read",
            input: { file_path: "src/two.ts" },
          },
        ],
      },
    } as unknown as SDKMessage, state);

    expect(events).toEqual([
      normalizedMessageCompleted({
        id: "message-1",
        phase: "commentary",
        text: "Checking both files.",
      }),
      normalizedActivityStarted({
        id: "read-1",
        kind: AgentActivityKind.TOOL,
        title: "Read",
        text: "",
      }),
      normalizedActivityStarted({
        id: "read-2",
        kind: AgentActivityKind.TOOL,
        title: "Read",
        text: "",
      }),
    ]);
  });

  it("maps Briar approval decisions to SDK permission results", () => {
    expect(approvalResult(true, { command: "bun test" })).toEqual({
      behavior: "allow",
      updatedInput: { command: "bun test" },
    });
    expect(approvalResult(false, {})).toMatchObject({ behavior: "deny" });
  });
});
