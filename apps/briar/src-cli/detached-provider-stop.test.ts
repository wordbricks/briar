import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { normalizedActivityStarted } from "../src-agent/normalized-agent-event";
import { encodeSidecarRunnerOutput, sidecarProviderEvent, sidecarRunResult } from "../src-agent/sidecar-protocol";
import { executeDetachedProviderTurn, DetachedProviderStopUnconfirmedError,
  type DetachedProviderTurnInput } from "./detached-provider-turn";
import { supportsOwnedProcessSupervisor } from "./owned-process-supervisor";

describe("common provider stop facade", () => {
  it.skipIf(!supportsOwnedProcessSupervisor())("stops detached tools for either provider and accepts a natural exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-provider-stop-test-"));
    const runner = join(directory, "runner.cjs");
    const activity = Buffer.from(encodeSidecarRunnerOutput(sidecarProviderEvent({ raw: {},
      event: normalizedActivityStarted({ id: "tool", kind: AgentActivityKind.COMMAND, title: "test", text: "test" }),
    }))).toString("base64");
    const result = Buffer.from(encodeSidecarRunnerOutput(sidecarRunResult({ sessionId: "fresh", message: "done" }))).toString("base64");
    const delayedWrite = "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 1500)";
    await writeFile(runner, `process.stdin.once('data', () => {
      if (process.env.BRIAR_TEST_NATURAL) return process.stdout.write(Buffer.from('${result}', 'base64'), () => process.exit(0));
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(delayedWrite)}, process.env.BRIAR_TEST_MARKER], {detached:true, stdio:'ignore'});
      child.on('spawn', () => process.stdout.write(Buffer.from('${activity}', 'base64')));
      setInterval(() => {}, 1000);
    });`);
    const runTurn = (input: DetachedProviderTurnInput) =>
      executeDetachedProviderTurn(input, runner, process.execPath, null, () => undefined);
    const input = (provider: "codex" | "claude", signal: AbortSignal): DetachedProviderTurnInput => ({
      agent: { id: "test", name: "Test", provider, model: null, responsibility: "Test only.", skills: [] },
      prompt: "Test", workspacePath: directory, fullAccess: false, skillCatalog: null, signal,
      environment: { ...process.env, BRIAR_TEST_MARKER: join(directory, provider) },
    });
    const other = spawn(process.execPath, ["-e", delayedWrite, join(directory, "other")], { detached: true, stdio: "ignore" });
    const otherExit = once(other, "exit");
    try {
      await Promise.all((["codex", "claude"] as const).map(async (provider) => {
        const abort = new AbortController();
        const failure = await runTurn({ ...input(provider, abort.signal),
          onPayload: () => { abort.abort(new Error("stop requested")); },
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(DetachedProviderStopUnconfirmedError);
      }));
      await otherExit;
      expect(await readFile(join(directory, "other"), "utf8")).toBe("late");
      for (const provider of ["codex", "claude"]) await expect(readFile(join(directory, provider))).rejects.toMatchObject({ code: "ENOENT" });
      const natural = input("claude", new AbortController().signal);
      expect(await runTurn({ ...natural, environment: { ...natural.environment, BRIAR_TEST_NATURAL: "1" } }))
        .toMatchObject({ completed: true, resultText: "done" });
    } finally {
      other.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("allows ordinary turns without supervision but never acknowledges cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-unsupported-stop-test-"));
    const runner = join(directory, "runner.cjs");
    const activity = Buffer.from(encodeSidecarRunnerOutput(sidecarProviderEvent({ raw: {},
      event: normalizedActivityStarted({ id: "tool", kind: AgentActivityKind.COMMAND, title: "test", text: "test" }),
    }))).toString("base64");
    const result = Buffer.from(encodeSidecarRunnerOutput(sidecarRunResult({ sessionId: "fresh", message: "done" }))).toString("base64");
    await writeFile(runner, `process.stdin.once('data', () => {
      if (process.env.BRIAR_TEST_NATURAL) return process.stdout.write(Buffer.from('${result}', 'base64'), () => process.exit(0));
      process.stdout.write(Buffer.from('${activity}', 'base64'));
      setInterval(() => {}, 1000);
    });`);
    const runTurn = (input: DetachedProviderTurnInput) =>
      executeDetachedProviderTurn(input, runner, process.execPath, null, () => undefined, () => false);
    const abort = new AbortController();
    const input: DetachedProviderTurnInput = {
      agent: { id: "test", name: "Test", provider: "claude", model: null, responsibility: "Test only.", skills: [] },
      prompt: "Test", workspacePath: directory, fullAccess: false, skillCatalog: null, signal: abort.signal,
      environment: process.env,
    };
    try {
      expect(await runTurn({ ...input, environment: { ...process.env, BRIAR_TEST_NATURAL: "1" } }))
        .toMatchObject({ completed: true, resultText: "done" });
      await expect(runTurn({ ...input,
        onPayload: () => { abort.abort(new Error("stop requested")); },
      })).rejects.toBeInstanceOf(DetachedProviderStopUnconfirmedError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

});
