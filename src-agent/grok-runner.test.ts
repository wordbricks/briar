import { describe, expect, it, vi } from "vitest";

import {
  createGrokPromptInvocation,
  grokPromptResultEnvelope,
  grokPromptStartEnvelope,
  grokRpcResultEnvelope,
  shouldSuppressGrokNotification,
} from "./grok-runner";

describe("Grok runner protocol preservation", () => {
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
