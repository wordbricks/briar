import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGrokPromptParts,
  buildPromptParts,
  createGrokEventState,
  extractJsonObject,
  finalizeGrokMessage,
  grokSessionMeta,
  mapEffortToGrok,
  normalizeGrokSessionUpdate,
  permissionDecisionResult,
  resolveGrokAuthMethodId,
  resolveGrokFinalMessage,
  resolveGrokModelId,
  shouldAutoApprovePermission,
  shouldDenyWritePermission,
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
  grokBinary: "/usr/local/bin/grok",
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

  it("denies write-like tools in read-only mode", () => {
    expect(shouldDenyWritePermission(request, "write_file")).toBe(true);
    expect(shouldDenyWritePermission(request, "read_file")).toBe(false);
    expect(
      shouldDenyWritePermission(
        { ...request, sandboxMode: "workspaceWrite" },
        "write_file",
      ),
    ).toBe(false);
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

    expect(started.event).toEqual({
      type: "messageStarted",
      id: "session-1:assistant:1",
      phase: "commentary",
      text: "Hel",
    });
    expect(delta.event).toEqual({
      type: "messageDelta",
      id: "session-1:assistant:1",
      delta: "lo",
    });
    expect(finalizeGrokMessage(state, "end_turn")).toEqual([
      {
        type: "messageCompleted",
        id: "session-1:assistant:1",
        phase: "final",
        text: "Hello",
      },
      { type: "turnCompleted", status: "completed" },
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

    expect(toolCall.event).toEqual({
      type: "messageCompleted",
      id: "session-1:assistant:1",
      phase: "commentary",
      text: "Checking the repository.",
    });
    expect(finalStarted.event).toEqual({
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

  it("extracts balanced JSON from fenced conversational output", () => {
    expect(
      extractJsonObject(
        'Done.\\n```json\\n{"message":"literal } brace","nested":{"ok":true}}\\n```',
      ),
    ).toBe('{"message":"literal } brace","nested":{"ok":true}}');
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

  it("maps models and efforts for Grok", () => {
    expect(resolveGrokModelId("  grok-4.5  ")).toBe("grok-4.5");
    expect(resolveGrokModelId("")).toBeUndefined();
    expect(mapEffortToGrok("ultra")).toBe("high");
    expect(mapEffortToGrok("medium")).toBe("medium");
  });
});
