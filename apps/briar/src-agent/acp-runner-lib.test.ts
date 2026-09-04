import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentActivityKind,
  AgentActivityStatus,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  normalizedActivityCompleted,
  normalizedActivityDelta,
  normalizedActivityStarted,
  normalizedMessageCompleted,
  normalizedMessageDelta,
  normalizedMessageStarted,
  normalizedTurnCompleted,
} from "./normalized-agent-event";
import {
  acpSessionMeta,
  acpStopReasonSucceeded,
  buildAcpPromptParts,
  buildPromptParts,
  createAcpEventState,
  extractJsonObject,
  finalizeAcpMessage,
  normalizeAcpSessionUpdate,
  permissionDecisionResult,
  permissionInput,
  permissionToolName,
  resolveAcpFinalMessage,
  shouldAutoApprovePermission,
  shouldDenyPermission,
} from "./acp-runner-lib";
import type { RunnerRequest } from "./runner-request";

const request: RunnerRequest = {
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "acp-model-1",
  effort: "high",
  approvalPolicy: "never",
  sandboxMode: "readOnly",
  networkAccess: false,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/usr/local/bin/acp-agent",
};

describe("ACP runner library", () => {
  it("embeds common image attachments as ACP image blocks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-acp-image-"));
    const path = join(directory, "screen.png");
    await writeFile(path, new Uint8Array([1, 2, 3, 4]));
    try {
      expect(await buildAcpPromptParts({
        ...request,
        attachments: [{
          type: "image",
          path,
          name: "screen.png",
          mimeType: "image/png",
        }],
      })).toEqual([
        { type: "text", text: "Inspect the repository" },
        { type: "image", data: "AQIDBA==", mimeType: "image/png" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("auto-approves unrestricted and never policies", () => {
    expect(shouldAutoApprovePermission(request)).toBe(true);
    expect(
      shouldAutoApprovePermission({
        ...request,
        approvalPolicy: "on-request",
        sandboxMode: "workspaceWrite",
      }),
    ).toBe(false);
    expect(
      shouldAutoApprovePermission({
        ...request,
        approvalPolicy: "on-request",
        sandboxMode: "dangerFullAccess",
      }),
    ).toBe(true);
  });

  it("allows only explicit read tools and workspace-confined paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-acp-permission-"));
    const workspaceRoot = join(directory, "repo");
    const sourceDirectory = join(workspaceRoot, "src");
    const safeFile = join(sourceDirectory, "safe.ts");
    const outsideDirectory = join(directory, "outside");
    const outsideFile = join(outsideDirectory, "secret.txt");
    await Promise.all([
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(outsideDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(safeFile, "export const safe = true;\n"),
      writeFile(outsideFile, "secret\n"),
    ]);
    await symlink(outsideDirectory, join(workspaceRoot, "linked-outside"));
    await symlink(
      join(directory, "future-outside"),
      join(workspaceRoot, "dangling"),
    );

    const scopedRequest = { ...request, workspaceRoot };
    try {
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "read_file",
          { path: "src/safe.ts" },
        ),
      ).toBe(false);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "ReadFile",
          { target_file: safeFile },
        ),
      ).toBe(false);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "glob",
          { pattern: "src/**/*.ts" },
        ),
      ).toBe(false);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "grep",
          { pattern: "safe", options: { directory: "src" } },
        ),
      ).toBe(false);
      expect(
        await shouldDenyPermission(scopedRequest, "list_dir"),
      ).toBe(false);

      expect(
        await shouldDenyPermission(
          scopedRequest,
          "read_file",
          { path: outsideFile },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "read_file",
          { path: "../outside/secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "read_file",
          { path: "..\\outside\\secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "read_file",
          { path: "linked-outside/secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "read_file",
          { target: "dangling/secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "glob",
          { glob: "linked-outside/**/*.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "glob",
          { pattern: "{src,../outside}/**/*" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          scopedRequest,
          "read_file",
          { path: 42 },
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(scopedRequest, "read_file"),
      ).toBe(true);

      for (const permission of [
        "create_file",
        "move_file",
        "rename",
        "execute",
        "deploy",
        "git_commit",
        "custom_mcp_mutation",
        "read_file_and_upload",
      ]) {
        expect(
          await shouldDenyPermission(scopedRequest, permission),
        ).toBe(true);
      }
      expect(
        await shouldDenyPermission(scopedRequest, "web_search"),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          { ...scopedRequest, networkAccess: true },
          "web_search",
        ),
      ).toBe(false);
      expect(
        await shouldDenyPermission(
          { ...scopedRequest, sandboxMode: "workspaceWrite" },
          "web_fetch",
        ),
      ).toBe(true);
      expect(
        await shouldDenyPermission(
          { ...scopedRequest, sandboxMode: "workspaceWrite" },
          "write_file",
        ),
      ).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the ACP tool identifier and raw input for permission checks", () => {
    const params = {
      toolCall: {
        title: "Read configuration",
        kind: "read",
        toolName: "read_file",
        rawInput: { path: "config.json" },
      },
    };
    expect(permissionToolName(params)).toBe("read_file");
    expect(permissionInput(params)).toEqual({ path: "config.json" });
  });

  it("selects allow/reject permission options", () => {
    const options = [
      { optionId: "allow-1", kind: "allow_once" },
      { optionId: "reject-1", kind: "reject_once" },
    ];
    expect(permissionDecisionResult(options, true)).toEqual({
      outcome: { outcome: "selected", optionId: "allow-1" },
    });
    expect(permissionDecisionResult(options, false)).toEqual({
      outcome: { outcome: "selected", optionId: "reject-1" },
    });
    expect(
      permissionDecisionResult(
        [{ optionId: "persist", kind: "allow_always" }],
        true,
      ),
    ).toEqual({ outcome: { outcome: "cancelled" } });
    expect(
      permissionDecisionResult(
        [{ optionId: "unsafe-fallback", kind: "allow_once" }],
        false,
      ),
    ).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("passes trusted instructions as ACP session system rules", () => {
    const longInstructions = "x".repeat(40_000);
    expect(acpSessionMeta({ ...request, instructions: longInstructions }))
      .toEqual({ rules: longInstructions });
    expect(acpSessionMeta({ ...request, instructions: "  " })).toBeUndefined();
  });

  it("builds user prompt parts with the schema", () => {
    expect(
      buildPromptParts({
        ...request,
        instructions: "Be concise",
        outputSchema: { type: "string" },
      }),
    ).toEqual([
      {
        type: "text",
        text: 'Return only the JSON value that matches this schema, without Markdown fences or commentary:\n{"type":"string"}',
      },
      { type: "text", text: "Inspect the repository" },
    ]);
  });

  it("normalizes streamed assistant text and finalizes the turn", () => {
    const state = createAcpEventState();
    const started = normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hel" },
        },
      },
      state,
    );
    const delta = normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "lo" },
        },
      },
      state,
    );

    expect(started.events).toEqual([normalizedMessageStarted({
      id: "session-1:assistant:1",
      phase: "commentary",
      text: "Hel",
    })]);
    expect(delta.events).toEqual([normalizedMessageDelta({
      id: "session-1:assistant:1",
      delta: "lo",
    })]);
    expect(finalizeAcpMessage(state, "end_turn")).toEqual([
      normalizedMessageCompleted({
        id: "session-1:assistant:1",
        phase: "final",
        text: "Hello",
      }),
      normalizedTurnCompleted("completed"),
    ]);
    expect(acpStopReasonSucceeded("end_turn")).toBe(true);
    expect(acpStopReasonSucceeded("cancelled")).toBe(false);
    expect(acpStopReasonSucceeded("max_tokens")).toBe(false);
    expect(acpStopReasonSucceeded(undefined)).toBe(false);
    expect(finalizeAcpMessage(createAcpEventState(), "max_tokens")).toEqual([
      normalizedTurnCompleted("max_tokens"),
    ]);
  });

  it("segments assistant messages around tool calls", () => {
    const state = createAcpEventState();
    normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Checking the repository." },
        },
      },
      state,
    );
    const toolCall = normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: { sessionUpdate: "tool_call", toolCallId: "tool-1" },
      },
      state,
    );
    const finalStarted = normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: '{"action":"respond"}' },
        },
      },
      state,
    );

    expect(toolCall.events[0]).toEqual(normalizedMessageCompleted({
      id: "session-1:assistant:1",
      phase: "commentary",
      text: "Checking the repository.",
    }));
    expect(finalStarted.events[0]).toEqual(normalizedMessageStarted({
      id: "session-1:assistant:2",
      phase: "commentary",
      text: '{"action":"respond"}',
    }));
    expect(finalizeAcpMessage(state, "end_turn")[0]).toEqual(
      normalizedMessageCompleted({
      id: "session-1:assistant:2",
      phase: "final",
      text: '{"action":"respond"}',
      }),
    );
    expect(state.lastAssistantText).toBe('{"action":"respond"}');
  });

  it("normalizes ACP tool output and terminal outcomes", () => {
    const state = createAcpEventState();
    const update = (value: Record<string, unknown>) =>
      normalizeAcpSessionUpdate(
        {
          sessionId: "session-1",
          update: value,
        },
        state,
      ).events;

    expect(update({
      sessionUpdate: "tool_call",
      toolCallId: "tool-ok",
      kind: "execute",
      title: "Run tests",
      status: "in_progress",
      rawInput: { command: "bun test" },
    })).toEqual([normalizedActivityStarted({
      id: "tool-ok",
      kind: AgentActivityKind.COMMAND,
      title: "Run tests",
      text: "",
    })]);
    expect(update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-ok",
      rawOutput: "PASS first suite\n",
    })).toEqual([normalizedActivityDelta({
      id: "tool-ok",
      delta: "PASS first suite\n",
    })]);
    expect(update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-ok",
      status: "completed",
      rawOutput: "PASS first suite\nPASS second suite\n",
    })).toEqual([
      normalizedActivityDelta({
        id: "tool-ok",
        delta: "PASS second suite\n",
      }),
      normalizedActivityCompleted({
        id: "tool-ok",
        kind: AgentActivityKind.COMMAND,
        title: "Run tests",
        text: "PASS first suite\nPASS second suite\n",
        status: AgentActivityStatus.COMPLETED,
      }),
    ]);

    update({
      sessionUpdate: "tool_call",
      toolCallId: "tool-failed",
      kind: "execute",
      title: "Run failing tests",
      status: "in_progress",
    });
    expect(update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-failed",
      status: "failed",
      rawOutput: "1 test failed",
    })).toContainEqual(normalizedActivityCompleted({
      id: "tool-failed",
      kind: AgentActivityKind.COMMAND,
      title: "Run failing tests",
      text: "1 test failed",
      status: AgentActivityStatus.FAILED,
    }));

    update({
      sessionUpdate: "tool_call",
      toolCallId: "tool-cancelled",
      kind: "execute",
      title: "Push changes",
      status: "pending",
    });
    expect(update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-cancelled",
      status: "cancelled",
    })).toEqual([normalizedActivityCompleted({
      id: "tool-cancelled",
      kind: AgentActivityKind.COMMAND,
      title: "Push changes",
      text: "",
      status: AgentActivityStatus.CANCELLED,
    })]);
  });

  it("extracts balanced JSON from fenced conversational output", () => {
    expect(
      extractJsonObject(
        'Done.\\n```json\\n{"message":"literal } brace","nested":{"ok":true}}\\n```',
      ),
    ).toBe('{"message":"literal } brace","nested":{"ok":true}}');
  });

  it("does not hide multiple JSON objects from the shared validator", () => {
    const mixed = 'First {"ok":true}\nThen {"ok":false}';
    expect(extractJsonObject(mixed)).toBe(mixed);
    const wrapped = 'Wrapped [{"ok":true}]';
    expect(extractJsonObject(wrapped)).toBe(wrapped);
  });

  it("uses the final assistant segment for structured output", () => {
    const state = createAcpEventState();
    normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Checking the repository." },
        },
      },
      state,
    );
    normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: { sessionUpdate: "tool_call", toolCallId: "tool-1" },
      },
      state,
    );
    normalizeAcpSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: '```json\\n{"action":"respond"}\\n```',
          },
        },
      },
      state,
    );
    finalizeAcpMessage(state, "end_turn");

    expect(
      resolveAcpFinalMessage(state, undefined, { type: "object" }),
    ).toBe('{"action":"respond"}');
    expect(resolveAcpFinalMessage(state, undefined, undefined)).toBe(
      '```json\\n{"action":"respond"}\\n```',
    );
  });
});
