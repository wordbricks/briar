import { describe, expect, it } from "vitest";

import {
  agyArgs,
  agyBlockedRetry,
  agyConversationId,
  agyEnvironment,
  buildAgyPrompt,
  createAgyEventState,
  mapEffortToAgy,
  normalizeAgyEvent,
  type AgyRunnerRequest,
} from "./agy-runner-lib";

const request = (overrides: Partial<AgyRunnerRequest> = {}): AgyRunnerRequest => ({
  type: "run",
  message: "Fix the tests",
  workspaceRoot: "/repo",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: false,
  agyBinary: "/bin/agy",
  ...overrides,
});

describe("Antigravity runner helpers", () => {
  it("builds headless stream arguments without a shell", () => {
    expect(agyArgs(request({
      model: "gemini-3.7-flash",
      effort: "xhigh",
      conversationId: "conversation-1",
      outputSchema: { type: "object" },
    }))).toEqual(expect.arrayContaining([
      "--output-format", "stream-json",
      "--json-schema", '{"type":"object"}',
      "--model", "gemini-3.7-flash",
      "--effort", "high",
      "--conversation", "conversation-1",
      "--sandbox", "--mode", "accept-edits",
      "--dangerously-skip-permissions", "--print",
    ]));
    expect(mapEffortToAgy("ultra")).toBe("high");
  });

  it("keeps trusted instructions, no-network policy, and attachments in the prompt", () => {
    const prompt = buildAgyPrompt(request({
      instructions: "Follow repository instructions",
      attachments: [{
        type: "image",
        path: "/tmp/screen shot.png",
        name: "screen shot.png",
        mimeType: "image/png",
      }],
    }));
    expect(prompt).toContain("<briar_trusted_instructions>");
    expect(prompt).toContain("Do not use network");
    expect(prompt).toContain("@/tmp/screen shot.png");
  });

  it("extracts conversation ids from Antigravity stream events", () => {
    expect(agyConversationId({ event: "init", conversation_id: "abc" })).toBe("abc");
    expect(agyConversationId({
      event: "step_update",
      step_update: { conversation_id: "step" },
    })).toBe("step");
    expect(agyConversationId({ result: { conversationId: "def" } })).toBe("def");
  });

  it("normalizes the measured Antigravity delta stream and terminal events", () => {
    const state = createAgyEventState();
    expect(normalizeAgyEvent({
      event: "step_update",
      step_update: {
        conversation_id: "conversation-1",
        step_index: 2,
        state: "ACTIVE",
        step_type: "agent_response",
        text_delta: "Hello",
      },
    }, state)).toMatchObject([{ type: "messageStarted", text: "Hello" }]);
    expect(normalizeAgyEvent({
      event: "step_update",
      step_update: {
        conversation_id: "conversation-1",
        step_index: 2,
        state: "DONE",
        step_type: "agent_response",
        text_delta: " world",
      },
    }, state)).toMatchObject([{ type: "messageDelta", delta: " world" }]);
    expect(normalizeAgyEvent({
      event: "result",
      result: { conversation_id: "conversation-1", response: "Hello world" },
    }, state)).toMatchObject([
      { type: "messageCompleted", text: "Hello world" },
      { type: "turnCompleted", status: "completed" },
    ]);
  });

  it("maps tool steps and provider blockers", () => {
    const events = normalizeAgyEvent({
      event: "step_update",
      step_update: {
        step_index: 3,
        state: "ACTIVE",
        step_type: "tool",
        tool_name: "run_command",
        tool_info: { name: "run_command", parameters: { CommandLine: "bun test" } },
      },
    }, createAgyEventState());
    expect(events).toMatchObject([{ type: "activityStarted", id: "agy-step-3", kind: "command" }]);
    expect(agyBlockedRetry("RESOURCE_EXHAUSTED: quota reached")).toMatchObject({
      reason: "usage_exhausted",
      provider: "agy",
    });
    expect(agyBlockedRetry("[503] queue full")).toMatchObject({
      reason: "upstream_overloaded",
      statusCode: 503,
    });
  });

  it("forces local Google subscription auth instead of API-key or ADC auth", () => {
    expect(agyEnvironment({
      PATH: "/usr/bin",
      AGY_ADC_AUTH: "1",
      GEMINI_API_KEY: "secret",
      GOOGLE_API_KEY: "secret",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json",
    })).toEqual({ PATH: "/usr/bin" });
  });
});
