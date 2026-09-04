import { describe, expect, it } from "vitest";
import {
  assertDetachedProviderTurnSucceeded,
  detachedProviderBlockOf,
  DetachedProviderBlockedError,
  detachedProviderTurnFailure,
  type DetachedProviderTurnResult,
} from "./detached-provider-turn";
import {
  providerBlockReplyMessage,
  type ProviderBlock,
} from "../src/lib/provider-block";

function turn(
  overrides: Partial<DetachedProviderTurnResult> = {},
): DetachedProviderTurnResult {
  return {
    exitCode: 0,
    stderr: "",
    runnerError: null,
    completed: true,
    resultText: "Task completed",
    conversationId: "opencode:conversation-1",
    block: null,
    ...overrides,
  };
}

const usageBlock: ProviderBlock = {
  reason: "usage_exhausted",
  provider: "opencode",
  message: "Usage limit reached",
  nextRetryAt: "2026-09-04T10:00:00.000Z",
};

describe("detachedProviderTurnFailure", () => {
  it("accepts a completed turn whose runner process then died", () => {
    // The incident this guards: an OpenCode runner delivered its terminal
    // result frame and then crashed on an unhandled AbortError, so every agent
    // task session was reported as failed and re-executed by the server.
    const result = turn({
      exitCode: 1,
      stderr: "AbortError: The operation was aborted\n",
    });

    expect(detachedProviderTurnFailure(result)).toBeNull();
    expect(() => assertDetachedProviderTurnSucceeded(result)).not.toThrow();
  });

  it("keeps the runner exit code and stderr on the result for inspection", () => {
    const result = turn({ exitCode: 143, stderr: "terminated\n" });

    expect(detachedProviderTurnFailure(result)).toBeNull();
    expect(result.exitCode).toBe(143);
    expect(result.stderr).toBe("terminated\n");
  });

  it("accepts a completed turn that exited cleanly", () => {
    expect(detachedProviderTurnFailure(turn())).toBeNull();
    expect(() => assertDetachedProviderTurnSucceeded(turn())).not.toThrow();
  });

  it("fails a turn that never completed and exited nonzero", () => {
    const result = turn({
      completed: false,
      resultText: null,
      exitCode: 1,
      stderr: "opencode: command not found\n",
    });

    expect(detachedProviderTurnFailure(result)).toBe(
      "opencode: command not found",
    );
    expect(() => assertDetachedProviderTurnSucceeded(result)).toThrow(
      "opencode: command not found",
    );
  });

  it("falls back to the exit code when an unfinished turn left no stderr", () => {
    const result = turn({ completed: false, resultText: null, exitCode: 7 });

    expect(detachedProviderTurnFailure(result)).toBe("Agent exited with 7");
  });

  it("fails a turn whose runner reported a terminal error frame", () => {
    const result = turn({
      exitCode: 0,
      completed: false,
      resultText: null,
      runnerError: "Agent failed to reach the provider",
    });

    expect(detachedProviderTurnFailure(result)).toBe(
      "Agent failed to reach the provider",
    );
    expect(() => assertDetachedProviderTurnSucceeded(result)).toThrow(
      "Agent failed to reach the provider",
    );
  });

  it("prefers the runner error over a completed result", () => {
    // A runner cannot emit both frames today, but the error frame is the
    // runner's own verdict and must never be masked by a stale result.
    const result = turn({ runnerError: "Agent failed", exitCode: 0 });

    expect(detachedProviderTurnFailure(result)).toBe("Agent failed");
  });

  it("reports a block with its shared reply copy", () => {
    const result = turn({
      block: usageBlock,
      completed: false,
      resultText: null,
    });

    expect(detachedProviderTurnFailure(result)).toBe(
      providerBlockReplyMessage(usageBlock),
    );
  });

  it("requires a result by default when the runner exited cleanly", () => {
    const result = turn({ completed: false, resultText: null });

    expect(detachedProviderTurnFailure(result)).toBe(
      "Agent runner exited without a result",
    );
    expect(() => assertDetachedProviderTurnSucceeded(result)).toThrow(
      "Agent runner exited without a result",
    );
  });

  it("allows a clean exit without a result when requireResult is false", () => {
    const result = turn({ completed: false, resultText: null });

    expect(detachedProviderTurnFailure(result, { requireResult: false }))
      .toBeNull();
    expect(() =>
      assertDetachedProviderTurnSucceeded(result, { requireResult: false })
    ).not.toThrow();
  });

  it("still fails a nonzero exit without a result when requireResult is false", () => {
    const result = turn({
      completed: false,
      resultText: null,
      exitCode: 1,
      stderr: "runner crashed before starting\n",
    });

    expect(detachedProviderTurnFailure(result, { requireResult: false })).toBe(
      "runner crashed before starting",
    );
  });
});

describe("assertDetachedProviderTurnSucceeded", () => {
  it("throws a structured block error callers can unwrap", () => {
    const result = turn({
      block: usageBlock,
      completed: false,
      resultText: null,
      exitCode: 1,
    });

    try {
      assertDetachedProviderTurnSucceeded(result);
      expect.unreachable("blocked turn must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DetachedProviderBlockedError);
      expect(detachedProviderBlockOf(error)).toEqual(usageBlock);
      expect((error as Error).message).toBe(
        providerBlockReplyMessage(usageBlock),
      );
    }
  });

  it("reports a block even after the runner delivered a result", () => {
    const result = turn({ block: usageBlock, exitCode: 1 });

    expect(() => assertDetachedProviderTurnSucceeded(result)).toThrow(
      DetachedProviderBlockedError,
    );
  });
});
