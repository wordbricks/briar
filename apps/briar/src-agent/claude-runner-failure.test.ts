import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import {
  claudeResultBlock,
  createClaudeFailureState,
  observeClaudeFailure,
} from "./claude-runner-lib";

const now = () => Date.parse("2026-09-04T10:00:00.000Z");

const resultError = (
  input: Partial<Extract<SDKMessage, { type: "result" }>> & { errors?: string[] },
) =>
  ({
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    errors: [],
    uuid: "u",
    session_id: "s",
    ...input,
  }) as unknown as Extract<SDKMessage, { type: "result" }>;

describe("Claude failure classification", () => {
  it("turns a rejected subscription limit into a usage block with its reset", () => {
    const state = createClaudeFailureState();
    observeClaudeFailure({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        resetsAt: 1_757_000_000,
        rateLimitType: "five_hour",
      },
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage, state, now);
    expect(state.block).toMatchObject({
      reason: "usage_exhausted",
      provider: "claude",
      nextRetryAt: "2025-09-04T15:33:20.000Z",
      providerCode: "rate_limit",
    });
    expect(claudeResultBlock(resultError({ errors: ["Execution error"] }), state, now))
      .toBe(state.block);
  });

  it("ignores allowed and warning rate limit events", () => {
    const state = createClaudeFailureState();
    observeClaudeFailure({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed_warning", utilization: 0.9 },
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage, state, now);
    expect(state.block).toBeNull();
    expect(claudeResultBlock(resultError({ errors: ["Execution error"] }), state, now))
      .toBeNull();
  });

  it("reads the API error code off a synthetic assistant message", () => {
    for (const [code, reason] of [
      ["rate_limit", "usage_exhausted"],
      ["billing_error", "billing_required"],
      ["authentication_failed", "auth_required"],
      ["overloaded", "upstream_overloaded"],
      ["model_not_found", "model_unavailable"],
    ] as const) {
      const state = createClaudeFailureState();
      observeClaudeFailure({
        type: "assistant",
        error: code,
        message: { id: "m", content: [{ type: "text", text: "API Error" }] },
        parent_tool_use_id: null,
        uuid: "u",
        session_id: "s",
      } as unknown as SDKMessage, state, now);
      expect(state.block?.reason, code).toBe(reason);
      expect(state.block?.providerCode).toBe(code);
    }
    const state = createClaudeFailureState();
    observeClaudeFailure({
      type: "assistant",
      error: "max_output_tokens",
      message: { id: "m", content: [] },
      parent_tool_use_id: null,
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage, state, now);
    expect(state.block).toBeNull();
  });

  it("maps terminal reasons and result text when nothing structured arrived", () => {
    const state = createClaudeFailureState();
    expect(claudeResultBlock(
      resultError({ terminal_reason: "blocking_limit" }),
      state,
      now,
    )).toMatchObject({ reason: "usage_exhausted", providerCode: "blocking_limit" });
    expect(claudeResultBlock(
      resultError({ terminal_reason: "prompt_too_long" }),
      state,
      now,
    )).toMatchObject({ reason: "context_window_exceeded" });
    expect(claudeResultBlock(
      resultError({ errors: ["Claude AI usage limit reached|1757000000"] }),
      state,
      now,
    )).toMatchObject({
      reason: "usage_exhausted",
      nextRetryAt: "2025-09-04T15:33:20.000Z",
    });
    expect(claudeResultBlock(
      resultError({ errors: ["Tool use failed"] }),
      state,
      now,
    )).toBeNull();
  });

  it("falls back to the last API retry status", () => {
    const state = createClaudeFailureState();
    observeClaudeFailure({
      type: "system",
      subtype: "api_retry",
      attempt: 3,
      max_retries: 3,
      retry_delay_ms: 1,
      error_status: 529,
      error: "overloaded",
      uuid: "u",
      session_id: "s",
    } as unknown as SDKMessage, state, now);
    expect(claudeResultBlock(resultError({ errors: [] }), state, now))
      .toMatchObject({ reason: "upstream_overloaded", statusCode: 529 });
  });
});
