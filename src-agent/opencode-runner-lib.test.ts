import { describe, expect, it } from "vitest";

import {
  buildOpenCodeParts,
  buildOpenCodePermissionRules,
  buildOpenCodePrompt,
  completeOpenCodeMessages,
  createOpenCodeEventState,
  mapEffortToOpenCode,
  normalizeOpenCodeEvent,
  openCodeBlockedRetry,
  openCodeSystemPrompt,
  openCodeTransientOverload,
  parseOpenCodeModel,
  parseOpenCodeServerUrl,
  shouldAutoApproveOpenCodePermission,
  type OpenCodeRunnerRequest,
} from "./opencode-runner-lib";

const request = (overrides: Partial<OpenCodeRunnerRequest> = {}): OpenCodeRunnerRequest => ({
  type: "run",
  message: "Fix the tests",
  workspaceRoot: "/repo",
  approvalPolicy: "on-request",
  sandboxMode: "workspaceWrite",
  networkAccess: false,
  opencodeBinary: "/bin/opencode",
  ...overrides,
});

describe("OpenCode runner helpers", () => {
  it("maps common image attachments to OpenCode file parts", () => {
    expect(buildOpenCodeParts(request({
      attachments: [{
        type: "image",
        path: "/tmp/briar images/screen.png",
        name: "screen.png",
        mimeType: "image/png",
      }],
    }))).toEqual([
      { type: "text", text: "Fix the tests" },
      {
        type: "file",
        mime: "image/png",
        filename: "screen.png",
        url: "file:///tmp/briar%20images/screen.png",
      },
    ]);
  });

  it("parses the server URL and provider-qualified models", () => {
    expect(
      parseOpenCodeServerUrl("opencode server listening on http://127.0.0.1:4321\n"),
    ).toBe("http://127.0.0.1:4321");
    expect(parseOpenCodeModel("anthropic/claude-sonnet-4-5")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
    expect(parseOpenCodeModel("sonnet")).toBeUndefined();
  });

  it("maps unsupported high effort aliases to OpenCode's high variant", () => {
    expect(mapEffortToOpenCode("ultra")).toBe("high");
    expect(mapEffortToOpenCode("medium")).toBe("medium");
  });

  it("detects a free-tier retry as a blocking provider state", () => {
    expect(
      openCodeBlockedRetry(
        {
          type: "session.status",
          properties: {
            sessionID: "session-1",
            status: {
              type: "retry",
              attempt: 1,
              message: "Free usage exceeded, subscribe to Go",
              action: {
                reason: "free_tier_limit",
                provider: "opencode",
                message: "Subscribe to OpenCode Go for reliable access.",
              },
              next: 1_785_974_400_864,
            },
          },
        },
        "session-1",
      ),
    ).toEqual({
      reason: "free_tier_limit",
      provider: "opencode",
      message: "Subscribe to OpenCode Go for reliable access.",
      nextRetryAt: "2026-08-06T00:00:00.864Z",
    });
  });

  it("ignores retry states that are not free-tier blockers", () => {
    const state = {
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          action: { reason: "rate_limit", provider: "opencode" },
        },
      },
    };
    expect(openCodeBlockedRetry(state, "session-1")).toBeNull();
    expect(openCodeBlockedRetry(state, "another-session")).toBeNull();
  });

  it.each([502, 503, 504] as const)(
    "detects an OpenCode upstream HTTP %i failure as a blocking provider state",
    (statusCode) => {
      const error = {
        name: "UnknownError",
        data: {
          message: `\"Streaming response failed: [${statusCode}] The request queue is full.\"`,
        },
      };
      expect(openCodeTransientOverload(error)).toEqual({
        reason: "upstream_overloaded",
        provider: "opencode",
        message: `Streaming response failed: [${statusCode}] The request queue is full.`,
        nextRetryAt: null,
        statusCode,
      });
      expect(
        openCodeBlockedRetry(
          {
            type: "session.error",
            properties: { sessionID: "session-1", error },
          },
          "session-1",
        ),
      ).toMatchObject({ reason: "upstream_overloaded", statusCode });
    },
  );

  it("does not block permanent or unrelated OpenCode errors", () => {
    expect(
      openCodeTransientOverload({ message: "Streaming response failed: [400] Bad request" }),
    ).toBeNull();
    expect(
      openCodeBlockedRetry(
        {
          type: "session.error",
          properties: {
            sessionID: "another-session",
            error: { message: "Streaming response failed: [503] queue full" },
          },
        },
        "session-1",
      ),
    ).toBeNull();
  });

  it("separates trusted system instructions from the user prompt", () => {
    const input = request({
      instructions: "Be concise",
      outputSchema: { type: "object" },
    });
    expect(openCodeSystemPrompt(input)).toBe("Be concise");
    expect(buildOpenCodePrompt(input)).not.toContain("Be concise");
    expect(buildOpenCodePrompt(request({ outputSchema: { type: "object" } }))).toContain(
      '"type":"object"',
    );
  });

  it("auto-approves never policy but preserves read-only write denial", () => {
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never" }),
        "edit",
      ),
    ).toBe(true);
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never", sandboxMode: "readOnly" }),
        "edit",
      ),
    ).toBe(false);
    expect(
      buildOpenCodePermissionRules(request({ sandboxMode: "readOnly" })),
    ).toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never" }),
        "external_directory",
      ),
    ).toBe(false);
    expect(
      buildOpenCodePermissionRules(request({ approvalPolicy: "never" })),
    ).toContainEqual({
      permission: "webfetch",
      pattern: "*",
      action: "deny",
    });
  });

  it("normalizes assistant part updates without replaying snapshots", () => {
    const state = createOpenCodeEventState();
    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.updated",
          properties: { sessionID: "ses_1", info: { id: "msg_1", role: "assistant" } },
        },
        "ses_1",
        state,
      ),
    ).toEqual([]);
    const part = (text: string) => ({
      id: "part_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text" as const,
      text,
    });
    expect(
      normalizeOpenCodeEvent(
        { type: "message.part.updated", properties: { sessionID: "ses_1", part: part("Hi") } },
        "ses_1",
        state,
      ),
    ).toEqual([
      { type: "messageStarted", id: "msg_1", phase: "commentary", text: "Hi" },
    ]);
    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.part.updated",
          properties: { sessionID: "ses_1", part: part("Hi there") },
        },
        "ses_1",
        state,
      ),
    ).toEqual([{ type: "messageDelta", id: "msg_1", delta: " there" }]);
  });

  it("normalizes OpenCode tool output and terminal outcomes", () => {
    const state = createOpenCodeEventState();
    const toolPart = (
      callID: string,
      stateValue: Record<string, unknown>,
    ) => ({
      id: `part-${callID}`,
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID,
      tool: "bash",
      state: stateValue,
    });
    const updated = (part: ReturnType<typeof toolPart>) =>
      normalizeOpenCodeEvent(
        {
          type: "message.part.updated",
          properties: { sessionID: "ses_1", part },
        },
        "ses_1",
        state,
      );

    expect(updated(toolPart("call-ok", {
      status: "pending",
      input: { command: "bun test" },
      raw: "",
    }))).toEqual([{
      type: "activityStarted",
      id: "call-ok",
      kind: "command",
      title: "bun test",
      text: "",
    }]);
    expect(normalizeOpenCodeEvent(
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_1",
          messageID: "msg_1",
          partID: "part-call-ok",
          field: "output",
          delta: "PASS first suite\n",
        },
      },
      "ses_1",
      state,
    )).toEqual([{
      type: "activityDelta",
      id: "call-ok",
      delta: "PASS first suite\n",
    }]);
    expect(updated(toolPart("call-ok", {
      status: "completed",
      input: { command: "bun test" },
      output: "PASS first suite\nPASS second suite\n",
      title: "Run tests",
      metadata: {},
      time: { start: 1, end: 2 },
    }))).toEqual([{
      type: "activityCompleted",
      id: "call-ok",
      kind: "command",
      title: "Run tests",
      text: "PASS first suite\nPASS second suite\n",
      status: "completed",
    }]);

    expect(updated(toolPart("call-failed", {
      status: "running",
      input: { command: "bun test" },
      title: "Run failing tests",
      metadata: {},
      time: { start: 3 },
    }))).toEqual([{
      type: "activityStarted",
      id: "call-failed",
      kind: "command",
      title: "Run failing tests",
      text: "",
    }]);
    expect(updated(toolPart("call-failed", {
      status: "error",
      input: { command: "bun test" },
      error: "1 test failed",
      metadata: {},
      time: { start: 3, end: 4 },
    }))).toEqual([{
      type: "activityCompleted",
      id: "call-failed",
      kind: "command",
      title: "Run failing tests",
      text: "1 test failed",
      status: "failed",
    }]);
  });

  it("skips empty starts and completes durable text under the message id", () => {
    const state = createOpenCodeEventState();
    normalizeOpenCodeEvent(
      {
        type: "message.updated",
        properties: { sessionID: "ses_1", info: { id: "msg_1", role: "assistant" } },
      },
      "ses_1",
      state,
    );

    // Empty first snapshot must not create a blank "writing…" work-log row.
    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_1",
            part: {
              id: "part_1",
              sessionID: "ses_1",
              messageID: "msg_1",
              type: "text",
              text: "",
            },
          },
        },
        "ses_1",
        state,
      ),
    ).toEqual([]);

    // Streaming deltas are ephemeral for detached transcripts, but still track text.
    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.part.delta",
          properties: {
            sessionID: "ses_1",
            messageID: "msg_1",
            partID: "part_1",
            field: "text",
            delta: "저장소 구조를 확인합니다.",
          },
        },
        "ses_1",
        state,
      ),
    ).toEqual([
      {
        type: "messageStarted",
        id: "msg_1",
        phase: "commentary",
        text: "저장소 구조를 확인합니다.",
      },
    ]);

    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.part.delta",
          properties: {
            sessionID: "ses_1",
            messageID: "msg_1",
            partID: "part_1",
            field: "text",
            delta: " 다음 단계로 진행합니다.",
          },
        },
        "ses_1",
        state,
      ),
    ).toEqual([
      {
        type: "messageDelta",
        id: "msg_1",
        delta: " 다음 단계로 진행합니다.",
      },
    ]);

    // Completing the assistant message must emit full text under the same id so
    // durable work logs (which drop deltas) still show the body.
    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.updated",
          properties: {
            sessionID: "ses_1",
            info: {
              id: "msg_1",
              role: "assistant",
              time: { created: 1, completed: 2 },
            },
          },
        },
        "ses_1",
        state,
      ),
    ).toEqual([
      {
        type: "messageCompleted",
        id: "msg_1",
        phase: "commentary",
        text: "저장소 구조를 확인합니다. 다음 단계로 진행합니다.",
      },
    ]);
  });

  it("buffers part text before the assistant role is known", () => {
    const state = createOpenCodeEventState();
    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_1",
            part: {
              id: "part_1",
              sessionID: "ses_1",
              messageID: "msg_1",
              type: "text",
              text: "먼저 분석합니다.",
            },
          },
        },
        "ses_1",
        state,
      ),
    ).toEqual([]);

    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.updated",
          properties: {
            sessionID: "ses_1",
            info: { id: "msg_1", role: "assistant" },
          },
        },
        "ses_1",
        state,
      ),
    ).toEqual([
      {
        type: "messageStarted",
        id: "msg_1",
        phase: "commentary",
        text: "먼저 분석합니다.",
      },
    ]);
  });

  it("completes open messages on session idle and final response text", () => {
    const state = createOpenCodeEventState();
    normalizeOpenCodeEvent(
      {
        type: "message.updated",
        properties: { sessionID: "ses_1", info: { id: "msg_1", role: "assistant" } },
      },
      "ses_1",
      state,
    );
    normalizeOpenCodeEvent(
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_1",
          messageID: "msg_1",
          partID: "part_1",
          field: "text",
          delta: "부분 응답",
        },
      },
      "ses_1",
      state,
    );

    expect(
      normalizeOpenCodeEvent(
        { type: "session.idle", properties: { sessionID: "ses_1" } },
        "ses_1",
        state,
      ),
    ).toEqual([
      {
        type: "messageCompleted",
        id: "msg_1",
        phase: "commentary",
        text: "부분 응답",
      },
      { type: "turnCompleted", status: "completed" },
    ]);

    expect(
      completeOpenCodeMessages(state, {
        messageId: "msg_1",
        text: "최종 전체 응답",
        phase: "final",
      }),
    ).toEqual([
      {
        type: "messageCompleted",
        id: "msg_1",
        phase: "final",
        text: "최종 전체 응답",
      },
    ]);
  });
});
