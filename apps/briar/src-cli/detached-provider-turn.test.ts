import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDetachedProviderTurnSucceeded,
  claimPreparedRunner,
  detachedProviderBlockOf,
  DetachedProviderBlockedError,
  detachedProviderTurnFailure,
  executeDetachedProviderTurn,
  prepareComputerUseTurn,
  prepareDetachedProviderRunner,
  type DetachedProviderTurnInput,
  type DetachedProviderTurnResult,
} from "./detached-provider-turn";
import {
  encodeSidecarRunnerOutput,
  sidecarRunnerPrepared,
  sidecarRunResult,
} from "../src-agent/sidecar-protocol";
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

/*
  Pre-warming owns a live process between two phases of a reply, so the thing it
  must never do is leave one behind. These drive the real prepare/claim/discard
  path against a runner script that speaks the sidecar protocol, and check the
  process afterwards rather than the bookkeeping.
*/
describe("prepared provider runner", () => {
  const preparedFrame = Buffer.from(
    encodeSidecarRunnerOutput(sidecarRunnerPrepared()),
  ).toString("base64");
  const resultFrame = Buffer.from(
    encodeSidecarRunnerOutput(
      sidecarRunResult({ sessionId: "thread-1", message: "done" }),
    ),
  ).toString("base64");

  /**
   * Answers `prepared` to the first frame and a result to the second, and
   * records its own pid so a test can tell an adopted process from a new one.
   */
  const runnerSource = (pidFile: string) => `
    const fs = require('node:fs');
    fs.appendFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n");
    let frames = 0;
    process.stdin.on('data', () => {
      frames += 1;
      if (frames === 1) {
        process.stdout.write(Buffer.from('${preparedFrame}', 'base64'));
        return;
      }
      process.stdout.write(
        Buffer.from('${resultFrame}', 'base64'),
        () => process.exit(0),
      );
    });
    setInterval(() => {}, 1000);
  `;

  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; }
    catch { return false; }
  };

  const stillAlive = async (pid: number) => {
    for (let attempt = 0; attempt < 200 && alive(pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return alive(pid);
  };

  async function fixture(overrides: Partial<DetachedProviderTurnInput> = {}) {
    const directory = await mkdtemp(join(tmpdir(), "briar-prewarm-test-"));
    const pidFile = join(directory, "pids");
    const runner = join(directory, "runner.cjs");
    await writeFile(runner, runnerSource(pidFile));
    const diagnostics: { phase: string; reason?: unknown }[] = [];
    const input: DetachedProviderTurnInput = {
      agent: {
        id: "0f9d4b2a-1c3e-4d5f-8a7b-6c5d4e3f2a1b",
        name: "Briar Channel",
        provider: "codex",
        model: "gpt-5",
        responsibility: "Answer the channel.",
        skills: [],
      },
      prompt: "hi",
      workspacePath: directory,
      fullAccess: true,
      conversationId: null,
      toolInheritance: "briar",
      environment: { ...process.env },
      signal: new AbortController().signal,
      onDiagnostic: (diagnostic) =>
        diagnostics.push({
          phase: diagnostic.phase,
          reason: diagnostic.reason,
        }),
      ...overrides,
    };
    const pids = async () =>
      (await readFile(pidFile, "utf8")).trim().split("\n").map(Number);
    return { directory, runner, input, diagnostics, pids };
  }

  it("adopts the prepared process for a matching turn instead of spawning again", async () => {
    const { directory, runner, input, diagnostics, pids } = await fixture();
    try {
      const prepared = await prepareDetachedProviderRunner(
        input,
        runner,
        process.execPath,
      );
      expect(prepared).not.toBeNull();
      expect(diagnostics.map((entry) => entry.phase))
        .toEqual(expect.arrayContaining([
          "runner.prewarm_start",
          "runner.prewarm_ready",
        ]));
      const [preparedPid] = await pids();

      const claimed = await claimPreparedRunner(prepared!, input);
      expect(claimed).not.toBeNull();
      const result = await executeDetachedProviderTurn(
        input,
        runner,
        process.execPath,
        null,
        (phase, detail) => diagnostics.push({ phase, ...detail }),
        () => false,
        claimed,
      );

      expect(result).toMatchObject({ completed: true, resultText: "done" });
      // One process served both phases.
      expect(await pids()).toEqual([preparedPid]);
      expect(diagnostics.map((entry) => entry.phase))
        .toContain("runner.prewarm_used");
      expect(await stillAlive(preparedPid!)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("discards the process and reports why when the turn no longer fits", async () => {
    const { directory, runner, input, diagnostics, pids } = await fixture();
    try {
      const prepared = await prepareDetachedProviderRunner(
        input,
        runner,
        process.execPath,
      );
      const [preparedPid] = await pids();

      // What a memory-changed refresh does: the conversation the process was
      // prepared to resume is gone, so the process is too.
      const claimed = await claimPreparedRunner(prepared!, {
        ...input,
        conversationId: "thread-9",
      });

      expect(claimed).toBeNull();
      expect(await stillAlive(preparedPid!)).toBe(false);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          phase: "runner.prewarm_discarded",
          reason: "changed:conversationId",
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("kills a prepared process that was never used", async () => {
    const { directory, runner, input, pids } = await fixture();
    try {
      const prepared = await prepareDetachedProviderRunner(
        input,
        runner,
        process.execPath,
      );
      const [preparedPid] = await pids();

      await prepared!.discard("reply_finished");

      expect(await stillAlive(preparedPid!)).toBe(false);
      // Killing it twice is what the reply's `finally` does after a failure.
      await expect(prepared!.discard("reply_finished")).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("kills a prepared process when the claim is aborted", async () => {
    const abort = new AbortController();
    const { directory, runner, input, pids } = await fixture({
      signal: abort.signal,
    });
    try {
      await prepareDetachedProviderRunner(input, runner, process.execPath);
      const [preparedPid] = await pids();

      abort.abort(new Error("Worker execution was cancelled"));

      expect(await stillAlive(preparedPid!)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("gives up and lets the turn spawn cold when preparing never finishes", async () => {
    const { directory, input, diagnostics } = await fixture();
    const silent = join(directory, "silent.cjs");
    await writeFile(silent, "setInterval(() => {}, 1000);");
    try {
      const prepared = await prepareDetachedProviderRunner(
        input,
        silent,
        process.execPath,
        { readyTimeoutMs: 50 },
      );

      expect(prepared).toBeNull();
      expect(diagnostics.map((entry) => entry.phase))
        .toContain("runner.prewarm_failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
