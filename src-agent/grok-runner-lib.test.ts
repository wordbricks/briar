import { describe, expect, it } from "vitest";
import {
  buildPromptParts,
  createGrokEventState,
  finalizeGrokMessage,
  mapEffortToGrok,
  normalizeGrokSessionUpdate,
  permissionDecisionResult,
  resolveGrokAuthMethodId,
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

  it("builds prompt parts with instructions and schema", () => {
    expect(
      buildPromptParts({
        ...request,
        instructions: "Be concise",
        outputSchema: { type: "string" },
      }),
    ).toEqual([
      {
        type: "text",
        text: "Additional instructions for this turn:\nBe concise",
      },
      {
        type: "text",
        text: 'Respond with JSON that matches this schema:\n{"type":"string"}',
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
      id: "session-1:assistant",
      phase: "commentary",
      text: "Hel",
    });
    expect(delta.event).toEqual({
      type: "messageDelta",
      id: "session-1:assistant",
      delta: "lo",
    });
    expect(finalizeGrokMessage(state, "end_turn")).toEqual([
      {
        type: "messageCompleted",
        id: "session-1:assistant",
        phase: "final",
        text: "Hello",
      },
      { type: "turnCompleted", status: "completed" },
    ]);
  });

  it("maps models and efforts for Grok", () => {
    expect(resolveGrokModelId("  grok-4.5  ")).toBe("grok-4.5");
    expect(resolveGrokModelId("")).toBeUndefined();
    expect(mapEffortToGrok("ultra")).toBe("high");
    expect(mapEffortToGrok("medium")).toBe("medium");
  });
});
