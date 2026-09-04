import { describe, expect, it } from "vitest";
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
  buildOpenCodeParts,
  buildOpenCodePermissionRules,
  buildOpenCodePrompt,
  completeOpenCodeMessages,
  createOpenCodeEventState,
  createOpenCodeUnhandledRejectionGuard,
  installOpenCodeRunnerSignalHandlers,
  normalizeOpenCodeEvent,
  openCodeBlockedRetry,
  openCodeSessionErrorMessage,
  openCodeSystemPrompt,
  openCodeTerminalOutcome,
  openCodeTransientOverload,
  parseOpenCodeModel,
  parseOpenCodeServerUrl,
  shouldAutoApproveOpenCodePermission,
  type OpenCodeRunnerSignal,
} from "./opencode-runner-lib";
import type { RunnerRequest } from "./runner-request";

const request = (overrides: Partial<RunnerRequest> = {}): RunnerRequest => ({
  message: "Fix the tests",
  workspaceRoot: "/repo",
  approvalPolicy: "on-request",
  sandboxMode: "workspaceWrite",
  networkAccess: false,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/bin/opencode",
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

  it("detects a free-tier retry without structured action metadata", () => {
    expect(
      openCodeBlockedRetry(
        {
          type: "session.status",
          properties: {
            sessionID: "session-1",
            status: {
              type: "retry",
              attempt: 8,
              message: "Free usage exceeded, subscribe to Go https://opencode.ai/go",
              next: 1_786_593_780_337,
            },
          },
        },
        "session-1",
      ),
    ).toEqual({
      reason: "free_tier_limit",
      provider: "opencode",
      message: "Free usage exceeded, subscribe to Go https://opencode.ai/go",
      nextRetryAt: "2026-08-13T04:03:00.337Z",
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
    expect(
      openCodeBlockedRetry(
        {
          type: "session.status",
          properties: {
            sessionID: "session-1",
            status: { type: "retry", message: "Rate limit exceeded" },
          },
        },
        "session-1",
      ),
    ).toBeNull();
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
    ).toContainEqual({ permission: "*", pattern: "*", action: "deny" });
    expect(
      buildOpenCodePermissionRules(request({ sandboxMode: "readOnly" })),
    ).toContainEqual({ permission: "read", pattern: "*", action: "allow" });
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never", sandboxMode: "readOnly" }),
        "external_directory",
      ),
    ).toBe(false);
    expect(
      buildOpenCodePermissionRules(request({ sandboxMode: "readOnly" })),
    ).toContainEqual({
      permission: "external_directory",
      pattern: "*",
      action: "deny",
    });
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never", sandboxMode: "readOnly" }),
        "deploy",
      ),
    ).toBe(false);
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
      normalizedMessageStarted({
        id: "msg_1",
        phase: "commentary",
        text: "Hi",
      }),
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
    ).toEqual([normalizedMessageDelta({ id: "msg_1", delta: " there" })]);
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
    }))).toEqual([normalizedActivityStarted({
      id: "call-ok",
      kind: AgentActivityKind.COMMAND,
      title: "bun test",
      text: "",
    })]);
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
    )).toEqual([normalizedActivityDelta({
      id: "call-ok",
      delta: "PASS first suite\n",
    })]);
    expect(updated(toolPart("call-ok", {
      status: "completed",
      input: { command: "bun test" },
      output: "PASS first suite\nPASS second suite\n",
      title: "Run tests",
      metadata: {},
      time: { start: 1, end: 2 },
    }))).toEqual([normalizedActivityCompleted({
      id: "call-ok",
      kind: AgentActivityKind.COMMAND,
      title: "Run tests",
      text: "PASS first suite\nPASS second suite\n",
      status: AgentActivityStatus.COMPLETED,
    })]);

    expect(updated(toolPart("call-failed", {
      status: "running",
      input: { command: "bun test" },
      title: "Run failing tests",
      metadata: {},
      time: { start: 3 },
    }))).toEqual([normalizedActivityStarted({
      id: "call-failed",
      kind: AgentActivityKind.COMMAND,
      title: "Run failing tests",
      text: "",
    })]);
    expect(updated(toolPart("call-failed", {
      status: "error",
      input: { command: "bun test" },
      error: "1 test failed",
      metadata: {},
      time: { start: 3, end: 4 },
    }))).toEqual([normalizedActivityCompleted({
      id: "call-failed",
      kind: AgentActivityKind.COMMAND,
      title: "Run failing tests",
      text: "1 test failed",
      status: AgentActivityStatus.FAILED,
    })]);
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
      normalizedMessageStarted({
        id: "msg_1",
        phase: "commentary",
        text: "저장소 구조를 확인합니다.",
      }),
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
      normalizedMessageDelta({
        id: "msg_1",
        delta: " 다음 단계로 진행합니다.",
      }),
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
      normalizedMessageCompleted({
        id: "msg_1",
        phase: "commentary",
        text: "저장소 구조를 확인합니다. 다음 단계로 진행합니다.",
      }),
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
      normalizedMessageStarted({
        id: "msg_1",
        phase: "commentary",
        text: "먼저 분석합니다.",
      }),
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
      normalizedMessageCompleted({
        id: "msg_1",
        phase: "commentary",
        text: "부분 응답",
      }),
      normalizedTurnCompleted("completed"),
    ]);

    expect(
      completeOpenCodeMessages(state, {
        messageId: "msg_1",
        text: "최종 전체 응답",
        phase: "final",
      }),
    ).toEqual([
      normalizedMessageCompleted({
        id: "msg_1",
        phase: "final",
        text: "최종 전체 응답",
      }),
    ]);
  });
});

describe("OpenCode terminal session outcomes", () => {
  const usageLimitError = {
    type: "session.error",
    properties: {
      sessionID: "ses_1",
      error: {
        name: "APIError",
        data: {
          message: "AI_APICallError: Monthly usage limit reached",
        },
      },
    },
  };

  it("reads a readable message out of the OpenCode error shape", () => {
    expect(
      openCodeSessionErrorMessage({
        name: "APIError",
        data: { message: "AI_APICallError: Monthly usage limit reached" },
      }),
    ).toBe("AI_APICallError: Monthly usage limit reached");
    expect(openCodeSessionErrorMessage("  Session aborted  ")).toBe(
      "Session aborted",
    );
    expect(
      openCodeSessionErrorMessage({ error: { message: "nested failure" } }),
    ).toBe("nested failure");
    expect(
      openCodeSessionErrorMessage({ data: { message: '"quoted failure"' } }),
    ).toBe("quoted failure");
    expect(openCodeSessionErrorMessage({ name: "UnknownError", data: {} }))
      .toBe("UnknownError");
    expect(openCodeSessionErrorMessage(undefined)).toBe(
      "OpenCode reported a session error without a message.",
    );
  });

  it("blocks the run on a usage-limit session error", () => {
    expect(openCodeTerminalOutcome(usageLimitError, "ses_1")).toEqual({
      type: "blocked",
      blocker: {
        reason: "usage_exhausted",
        provider: "opencode",
        message: "AI_APICallError: Monthly usage limit reached",
        nextRetryAt: null,
      },
    });
    expect(
      openCodeTerminalOutcome(
        {
          type: "session.error",
          properties: {
            sessionID: "ses_1",
            error: {
              name: "APIError",
              data: { message: "Insufficient credits", statusCode: 402 },
            },
          },
        },
        "ses_1",
        "openrouter",
      ),
    ).toMatchObject({
      type: "blocked",
      blocker: { reason: "billing_required", provider: "openrouter", statusCode: 402 },
    });
    expect(
      openCodeTerminalOutcome(
        {
          type: "session.error",
          properties: {
            sessionID: "ses_1",
            error: { name: "ProviderAuthError", data: { message: "Not signed in to Anthropic" } },
          },
        },
        "ses_1",
      ),
    ).toMatchObject({ type: "blocked", blocker: { reason: "auth_required" } });
  });

  it("ends the run on a non-transient session error", () => {
    expect(
      openCodeTerminalOutcome(
        {
          type: "session.error",
          properties: { sessionID: "ses_1", error: "Session aborted" },
        },
        "ses_1",
      ),
    ).toEqual({ type: "failed", message: "Session aborted" });
    expect(
      openCodeTerminalOutcome(
        { type: "session.error", properties: { sessionID: "ses_1" } },
        "ses_1",
      ),
    ).toEqual({
      type: "failed",
      message: "OpenCode reported a session error without a message.",
    });
  });

  it("keeps transient and free-tier blockers resumable", () => {
    expect(
      openCodeTerminalOutcome(
        {
          type: "session.error",
          properties: {
            sessionID: "ses_1",
            error: {
              name: "UnknownError",
              data: { message: "Streaming response failed: [503] queue full" },
            },
          },
        },
        "ses_1",
      ),
    ).toEqual({
      type: "blocked",
      blocker: {
        reason: "upstream_overloaded",
        provider: "opencode",
        message: "Streaming response failed: [503] queue full",
        nextRetryAt: null,
        statusCode: 503,
      },
    });
    expect(
      openCodeTerminalOutcome(
        {
          type: "session.status",
          properties: {
            sessionID: "ses_1",
            status: {
              type: "retry",
              message: "Free usage exceeded, subscribe to Go",
              next: 1_785_974_400_864,
            },
          },
        },
        "ses_1",
      ),
    ).toMatchObject({ type: "blocked", blocker: { reason: "free_tier_limit" } });
  });

  it("ignores events that do not end this session", () => {
    expect(
      openCodeTerminalOutcome(
        {
          type: "session.error",
          properties: { sessionID: "ses_2", error: { name: "APIError" } },
        },
        "ses_1",
      ),
    ).toBeNull();
    expect(
      openCodeTerminalOutcome(
        { type: "session.idle", properties: { sessionID: "ses_1" } },
        "ses_1",
      ),
    ).toBeNull();
    expect(openCodeTerminalOutcome(null, "ses_1")).toBeNull();
    expect(openCodeTerminalOutcome("session.error", "ses_1")).toBeNull();
  });

  it("still reports the failed turn before the runner throws", () => {
    const state = createOpenCodeEventState();
    expect(normalizeOpenCodeEvent(usageLimitError, "ses_1", state)).toEqual([
      normalizedTurnCompleted("failed"),
    ]);
    expect(openCodeBlockedRetry(usageLimitError, "ses_1")).toMatchObject({
      reason: "usage_exhausted",
    });
    expect(openCodeTerminalOutcome(usageLimitError, "ses_1")).toMatchObject({
      type: "blocked",
    });
  });
});

describe("OpenCode runner signal handlers", () => {
  const install = (close?: (signal: OpenCodeRunnerSignal) => void) => {
    const listeners = new Map<OpenCodeRunnerSignal, () => void>();
    const calls: string[] = [];
    installOpenCodeRunnerSignalHandlers({
      on: (signal, listener) => listeners.set(signal, listener),
      exit: (code) => calls.push(`exit:${code}`),
      close: (signal) => {
        calls.push(`close:${signal}`);
        close?.(signal);
      },
    });
    return { listeners, calls };
  };

  it("closes the OpenCode server before exiting 143 on SIGTERM", () => {
    const { listeners, calls } = install();
    expect([...listeners.keys()]).toEqual(["SIGTERM", "SIGINT"]);
    listeners.get("SIGTERM")?.();
    expect(calls).toEqual(["close:SIGTERM", "exit:143"]);
  });

  it("exits 130 on SIGINT and ignores every later signal", () => {
    const { listeners, calls } = install();
    listeners.get("SIGINT")?.();
    listeners.get("SIGINT")?.();
    listeners.get("SIGTERM")?.();
    expect(calls).toEqual(["close:SIGINT", "exit:130"]);
  });

  it("exits even when closing the OpenCode server fails", () => {
    const { listeners, calls } = install(() => {
      throw new Error("kill failed");
    });
    expect(() => listeners.get("SIGTERM")?.()).not.toThrow();
    expect(calls).toEqual(["close:SIGTERM", "exit:143"]);
  });
});

describe("OpenCode runner unhandled rejection guard", () => {
  const create = () => {
    const diagnostics: Array<{
      phase: string;
      detail?: Record<string, unknown>;
    }> = [];
    const failures: unknown[] = [];
    const guard = createOpenCodeUnhandledRejectionGuard({
      diagnose: (phase, detail) => diagnostics.push({ phase, detail }),
      fail: (reason) => failures.push(reason),
    });
    return { guard, diagnostics, failures };
  };

  it("swallows the runner's own event-stream abort and says so", () => {
    const { guard, diagnostics, failures } = create();
    const reason = new DOMException("Briar closed the stream.", "AbortError");
    guard.expect(reason);

    guard.handle(reason);

    expect(failures).toEqual([]);
    expect(diagnostics).toEqual([
      {
        phase: "runner.event_stream_abort_ignored",
        detail: { reason: "Briar closed the stream." },
      },
    ]);
  });

  it("fails on a look-alike AbortError the runner never raised", () => {
    const { guard, diagnostics, failures } = create();
    const ours = new DOMException("Briar closed the stream.", "AbortError");
    const theirs = new DOMException("Briar closed the stream.", "AbortError");
    guard.expect(ours);

    guard.handle(theirs);

    expect(failures).toEqual([theirs]);
    expect(diagnostics).toEqual([]);
  });

  it("fails on every rejection while no abort is in flight", () => {
    const { guard, failures } = create();
    const boom = new Error("boom");

    guard.handle(boom);
    guard.handle("plain string");
    guard.handle(undefined);

    expect(failures).toEqual([boom, "plain string", undefined]);
  });

  it("only forgives the expected abort once", () => {
    const { guard, failures } = create();
    const reason = new DOMException("Briar closed the stream.", "AbortError");
    guard.expect(reason);

    guard.handle(reason);
    guard.handle(reason);

    expect(failures).toEqual([reason]);
  });

  it("never treats a primitive reason as expected", () => {
    const { guard, failures } = create();
    guard.expect("AbortError");

    guard.handle("AbortError");

    expect(failures).toEqual(["AbortError"]);
  });
});
