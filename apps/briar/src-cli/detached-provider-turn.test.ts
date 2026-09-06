import { describe, expect, it } from "vitest";
import {
  assertDetachedProviderTurnSucceeded,
  detachedProviderBlockOf,
  DetachedProviderBlockedError,
  detachedProviderTurnFailure,
  prepareComputerUseTurn,
  type DetachedProviderTurnInput,
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

describe("prepareComputerUseTurn", () => {
  function computerUseInput(
    overrides: Partial<DetachedProviderTurnInput> = {},
  ): DetachedProviderTurnInput {
    return {
      agent: {
        id: "8b0f2e1c-58bd-4a2e-9b41-5f8f1a2c9d33",
        name: "Briar Developer",
        provider: "opencode",
        model: null,
        computerUsePolicy: "unattended",
        responsibility: "Ship the release.",
        skills: [],
      },
      prompt: "Release the desktop app.",
      workspacePath: "/tmp/workspace",
      fullAccess: false,
      environment: {
        // An absolute path that cannot exist, so the box is unreachable here
        // no matter what the machine running the suite has installed.
        BRIAR_BOX_EXEC_AUTH_TOKEN_FILE: "/nonexistent/briar/box-exec-token",
      },
      signal: new AbortController().signal,
      ...overrides,
    };
  }

  it("runs an unattended Agent on a host that has no Computer Use box", async () => {
    // The incident this guards: `/Release Desktop app` needs no desktop, but
    // its Agent carries the unattended policy, so every box-less Worker
    // refused the work and the task sat queued forever.
    const diagnostics: string[] = [];
    const input = computerUseInput({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.phase),
    });

    const prepared = await prepareComputerUseTurn(input);

    expect(prepared.input).toBe(input);
    expect(prepared.input.computerUseBinding).toBeUndefined();
    expect(diagnostics).toContain("computer_use.unavailable");
    await expect(prepared.release()).resolves.toBeUndefined();
  });

  it("leaves a turn alone when the Agent has no Computer Use policy", async () => {
    const diagnostics: string[] = [];
    const input = computerUseInput({
      agent: {
        ...computerUseInput().agent,
        computerUsePolicy: "disabled",
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.phase),
    });

    const prepared = await prepareComputerUseTurn(input);

    expect(prepared.input).toBe(input);
    expect(diagnostics).toEqual([]);
  });

  it("still rejects a Computer Use child that lost its display binding", async () => {
    await expect(
      prepareComputerUseTurn(computerUseInput({ runKind: "computerUse" })),
    ).rejects.toThrow("Computer Use child is missing its display binding");
  });
});
