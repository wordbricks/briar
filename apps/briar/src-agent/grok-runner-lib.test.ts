import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGrokPromptParts,
  buildPromptParts,
  createGrokEventState,
  extractJsonObject,
  finalizeGrokMessage,
  grokSessionMeta,
  grokStopReasonSucceeded,
  normalizeGrokSessionUpdate,
  permissionDecisionResult,
  permissionInput,
  permissionToolName,
  resolveGrokAuthMethodId,
  resolveGrokFinalMessage,
  shouldAutoApprovePermission,
  shouldDenyGrokPermission,
  type GrokRunnerRequest,
} from "./grok-runner-lib";

const request: GrokRunnerRequest = {
  type: "run",
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "grok-4.5",
  effort: "high",
  approvalPolicy: "never",
  sandboxMode: "readOnly",
  networkAccess: false,
  providerBinaryPath: "/usr/local/bin/grok",
};

describe("Grok runner", () => {
  it("embeds common image attachments as ACP image blocks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-grok-image-"));
    const path = join(directory, "screen.png");
    await writeFile(path, new Uint8Array([1, 2, 3, 4]));
    try {
      expect(await buildGrokPromptParts({
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

  it("prefers the API key auth method when XAI_API_KEY is set", () => {
    expect(resolveGrokAuthMethodId({ XAI_API_KEY: "sk-test" })).toBe(
      "xai.api_key",
    );
    expect(resolveGrokAuthMethodId({})).toBe("cached_token");
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
    const directory = await mkdtemp(join(tmpdir(), "briar-grok-permission-"));
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
        await shouldDenyGrokPermission(
          scopedRequest,
          "read_file",
          { path: "src/safe.ts" },
        ),
      ).toBe(false);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "ReadFile",
          { target_file: safeFile },
        ),
      ).toBe(false);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "glob",
          { pattern: "src/**/*.ts" },
        ),
      ).toBe(false);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "grep",
          { pattern: "safe", options: { directory: "src" } },
        ),
      ).toBe(false);
      expect(
        await shouldDenyGrokPermission(scopedRequest, "list_dir"),
      ).toBe(false);

      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "read_file",
          { path: outsideFile },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "read_file",
          { path: "../outside/secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "read_file",
          { path: "..\\outside\\secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "read_file",
          { path: "linked-outside/secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "read_file",
          { target: "dangling/secret.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "glob",
          { glob: "linked-outside/**/*.txt" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "glob",
          { pattern: "{src,../outside}/**/*" },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          scopedRequest,
          "read_file",
          { path: 42 },
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(scopedRequest, "read_file"),
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
          await shouldDenyGrokPermission(scopedRequest, permission),
        ).toBe(true);
      }
      expect(
        await shouldDenyGrokPermission(scopedRequest, "web_search"),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
          { ...scopedRequest, networkAccess: true },
          "web_search",
        ),
      ).toBe(false);
      expect(
        await shouldDenyGrokPermission(
          { ...scopedRequest, sandboxMode: "workspaceWrite" },
          "web_fetch",
        ),
      ).toBe(true);
      expect(
        await shouldDenyGrokPermission(
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
    expect(grokSessionMeta({ ...request, instructions: longInstructions }))
      .toEqual({ rules: longInstructions });
    expect(grokSessionMeta({ ...request, instructions: "  " })).toBeUndefined();
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
    const state = createGrokEventState();
    const started = normalizeGrokSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hel" },
        },
      },
      state,
    );
    const delta = normalizeGrokSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "lo" },
        },
      },
      state,
    );

    expect(started.events).toEqual([{
      type: "messageStarted",
      id: "session-1:assistant:1",
      phase: "commentary",
      text: "Hel",
    }]);
    expect(delta.events).toEqual([{
      type: "messageDelta",
      id: "session-1:assistant:1",
      delta: "lo",
    }]);
    expect(finalizeGrokMessage(state, "end_turn")).toEqual([
      {
        type: "messageCompleted",
        id: "session-1:assistant:1",
        phase: "final",
        text: "Hello",
      },
      { type: "turnCompleted", status: "completed" },
    ]);
    expect(grokStopReasonSucceeded("end_turn")).toBe(true);
    expect(grokStopReasonSucceeded("cancelled")).toBe(false);
    expect(grokStopReasonSucceeded("max_tokens")).toBe(false);
    expect(grokStopReasonSucceeded(undefined)).toBe(false);
    expect(finalizeGrokMessage(createGrokEventState(), "max_tokens")).toEqual([
      { type: "turnCompleted", status: "max_tokens" },
    ]);
  });

  it("segments assistant messages around tool calls", () => {
    const state = createGrokEventState();
    normalizeGrokSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Checking the repository." },
        },
      },
      state,
    );
    const toolCall = normalizeGrokSessionUpdate(
      {
        sessionId: "session-1",
        update: { sessionUpdate: "tool_call", toolCallId: "tool-1" },
      },
      state,
    );
    const finalStarted = normalizeGrokSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: '{"action":"respond"}' },
        },
      },
      state,
    );

    expect(toolCall.events[0]).toEqual({
      type: "messageCompleted",
      id: "session-1:assistant:1",
      phase: "commentary",
      text: "Checking the repository.",
    });
    expect(finalStarted.events[0]).toEqual({
      type: "messageStarted",
      id: "session-1:assistant:2",
      phase: "commentary",
      text: '{"action":"respond"}',
    });
    expect(finalizeGrokMessage(state, "end_turn")[0]).toEqual({
      type: "messageCompleted",
      id: "session-1:assistant:2",
      phase: "final",
      text: '{"action":"respond"}',
    });
    expect(state.lastAssistantText).toBe('{"action":"respond"}');
  });

  it("normalizes ACP tool output and terminal outcomes", () => {
    const state = createGrokEventState();
    const update = (value: Record<string, unknown>) =>
      normalizeGrokSessionUpdate(
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
    })).toEqual([{
      type: "activityStarted",
      id: "tool-ok",
      kind: "command",
      title: "Run tests",
      text: "",
    }]);
    expect(update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-ok",
      rawOutput: "PASS first suite\n",
    })).toEqual([{
      type: "activityDelta",
      id: "tool-ok",
      delta: "PASS first suite\n",
    }]);
    expect(update({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-ok",
      status: "completed",
      rawOutput: "PASS first suite\nPASS second suite\n",
    })).toEqual([
      {
        type: "activityDelta",
        id: "tool-ok",
        delta: "PASS second suite\n",
      },
      {
        type: "activityCompleted",
        id: "tool-ok",
        kind: "command",
        title: "Run tests",
        text: "PASS first suite\nPASS second suite\n",
        status: "completed",
      },
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
    })).toContainEqual({
      type: "activityCompleted",
      id: "tool-failed",
      kind: "command",
      title: "Run failing tests",
      text: "1 test failed",
      status: "failed",
    });

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
    })).toEqual([{
      type: "activityCompleted",
      id: "tool-cancelled",
      kind: "command",
      title: "Push changes",
      text: "",
      status: "cancelled",
    }]);
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
    const state = createGrokEventState();
    normalizeGrokSessionUpdate(
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Checking the repository." },
        },
      },
      state,
    );
    normalizeGrokSessionUpdate(
      {
        sessionId: "session-1",
        update: { sessionUpdate: "tool_call", toolCallId: "tool-1" },
      },
      state,
    );
    normalizeGrokSessionUpdate(
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
    finalizeGrokMessage(state, "end_turn");

    expect(
      resolveGrokFinalMessage(state, undefined, { type: "object" }),
    ).toBe('{"action":"respond"}');
    expect(resolveGrokFinalMessage(state, undefined, null)).toBe(
      '```json\\n{"action":"respond"}\\n```',
    );
  });
});
