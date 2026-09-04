import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createOpenCodeEventState } from "./opencode-runner-lib";
import {
  openCodeFinalTurnOutputs,
  openCodeIsolationProvider,
  openCodeReadOnlySeatbeltProfile,
  openCodeServerSpawnSpec,
  stopOpenCodeProcess,
} from "./opencode-runner";
import {
  ensureReadOnlyAgentEnvironment,
  readOnlyStateRootEnvironmentKey,
} from "./read-only-agent-environment";

describe("OpenCode read-only isolation", () => {
  it("selects the OpenRouter allowlist only when Briar generated its config", () => {
    expect(openCodeIsolationProvider({})).toBe("opencode");
    expect(openCodeIsolationProvider({ OPENCODE_CONFIG_CONTENT: "  " }))
      .toBe("opencode");
    expect(
      openCodeIsolationProvider({ OPENCODE_CONFIG_CONTENT: '{"provider":{}}' }),
    ).toBe("openrouter");
  });

  it("moves TMPDIR and the seatbelt state root inside the isolated home", async () => {
    const isolation = await ensureReadOnlyAgentEnvironment("openrouter", {
      readOnly: true,
      workspaceRoot: "/repo",
      environment: {
        HOME: "/Users/worker",
        TMPDIR: "/var/folders/real/T/",
        OPENROUTER_API_KEY: "sk-or-v1-secret",
        OPENCODE_CONFIG_CONTENT: '{"provider":{"openrouter":{}}}',
        BRIAR_WORKER_TOKEN: "worker-secret",
      },
    });
    try {
      const stateRoot = isolation.environment[readOnlyStateRootEnvironmentKey];
      // OpenCode recursively creates `$TMPDIR/opencode`, which the seatbelt
      // only permits under the state root it was given.
      expect(isolation.environment.HOME).toBe(stateRoot);
      expect(isolation.environment.TMPDIR).toBe(stateRoot);
      expect(
        openCodeReadOnlySeatbeltProfile({
          workspaceRoot: "/repo",
          stateRoot: isolation.environment.HOME!,
          executablePaths: [],
        }),
      ).toContain(
        `(subpath ${JSON.stringify(realpathSync(isolation.environment.TMPDIR!))})`,
      );
      expect(isolation.environment.OPENROUTER_API_KEY).toBe("sk-or-v1-secret");
      expect(isolation.environment.OPENCODE_CONFIG_CONTENT)
        .toBe('{"provider":{"openrouter":{}}}');
      expect(isolation.environment.BRIAR_WORKER_TOKEN).toBeUndefined();
    } finally {
      await isolation.cleanup();
    }
  });
});

describe("OpenCode runner terminal output", () => {
  it("wraps read-only OpenCode in a repository-scoped OS sandbox", () => {
    const profile = openCodeReadOnlySeatbeltProfile({
      workspaceRoot: "/repo",
      stateRoot: "/private/tmp/opencode-state",
      executablePaths: ["/opt/opencode"],
    });
    expect(profile).toContain('(subpath "/repo")');
    expect(profile).toContain('(subpath "/private/tmp/opencode-state")');
    expect(profile).toContain('(literal "/opt/opencode")');
    expect(profile).toContain("AGENTS|Agents");
    expect(profile).not.toContain('(subpath "/Users")');
    expect(() =>
      openCodeReadOnlySeatbeltProfile({
        workspaceRoot: "/repo",
        stateRoot: "/repo/.state",
        executablePaths: ["/opt/opencode"],
      })
    ).toThrow("outside the repository");
    expect(() =>
      openCodeServerSpawnSpec({
        binary: "/bin/echo",
        arguments: [],
        workspaceRoot: "/repo",
        environment: { HOME: "/private/tmp/opencode-state" },
        readOnly: true,
        platform: "linux",
      })
    ).toThrow("require the macOS OS sandbox");
  });

  it.skipIf(process.platform !== "darwin")(
    "enforces the read-only boundary across symlinks in Seatbelt",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "briar-opencode-seatbelt-"));
      const workspaceRoot = join(root, "repo");
      const stateRoot = join(root, "state");
      const outsidePath = join(root, "outside-secret.txt");
      await Promise.all([
        mkdir(workspaceRoot),
        mkdir(stateRoot),
        writeFile(outsidePath, "outside-secret"),
      ]);
      await Promise.all([
        writeFile(join(workspaceRoot, "public.txt"), "repository-data"),
        writeFile(join(workspaceRoot, "AGENTS.md"), "untrusted-instruction"),
        symlink(outsidePath, join(workspaceRoot, "leak")),
      ]);
      const profile = openCodeReadOnlySeatbeltProfile({
        workspaceRoot,
        stateRoot,
        executablePaths: ["/bin/sh"],
      });
      try {
        const result = spawnSync(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            profile,
            "/bin/sh",
            "-c",
            [
              "cat public.txt",
              "if cat leak >/dev/null 2>&1; then echo outside-allowed; else echo outside-denied; fi",
              "if cat AGENTS.md >/dev/null 2>&1; then echo instructions-allowed; else echo instructions-denied; fi",
              "if echo changed > public.txt 2>/dev/null; then echo workspace-write-allowed; else echo workspace-write-denied; fi",
              'echo state-ok > "$HOME/result.txt"',
            ].join("\n"),
          ],
          {
            cwd: workspaceRoot,
            env: { ...process.env, HOME: stateRoot, TMPDIR: stateRoot },
            encoding: "utf8",
          },
        );
        expect(
          result.status,
          JSON.stringify({
            stderr: result.stderr,
            error: result.error?.message,
            signal: result.signal,
          }),
        ).toBe(0);
        expect(result.stdout).toContain("repository-data");
        expect(result.stdout).toContain("outside-denied");
        expect(result.stdout).toContain("instructions-denied");
        expect(result.stdout).toContain("workspace-write-denied");
        expect(await readFile(join(workspaceRoot, "public.txt"), "utf8"))
          .toBe("repository-data");
        expect(await readFile(join(stateRoot, "result.txt"), "utf8"))
          .toBe("state-ok\n");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("preserves the complete response, including step-finish usage parts", () => {
    const response = {
      info: { id: "message-1", role: "assistant" },
      parts: [
        { type: "text", text: "Done" },
        {
          type: "step-finish",
          providerID: "anthropic",
          modelID: "claude-sonnet-4-5",
          tokens: { input: 120, output: 30 },
          cost: 0.0042,
        },
      ],
    };

    const outputs = openCodeFinalTurnOutputs(
      response,
      createOpenCodeEventState(),
      "Done",
    );
    const terminal = outputs.find(
      (output) => output.event.event.case === "turnCompleted",
    );

    expect(terminal).toBeDefined();
    expect(terminal?.raw).toBe(response);
    expect((terminal?.raw as typeof response).parts[1]).toEqual(
      response.parts[1],
    );
    for (const output of outputs) {
      expect(output.raw).toBe(response);
    }
  });
});

describe("stopOpenCodeProcess", () => {
  type FakeChild = {
    pid: undefined;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    signals: NodeJS.Signals[];
    destroyed: string[];
    unrefs: number;
    kill: (signal?: NodeJS.Signals) => boolean;
    unref: () => void;
    once: (event: string, listener: () => void) => void;
    stdin: { destroy: () => void };
    stdout: { destroy: () => void };
    stderr: { destroy: () => void };
    exit: () => void;
  };
  // `pid` stays undefined so the helper never signals a real process group.
  const fakeChild = (input: { exitsOn?: NodeJS.Signals[] } = {}) => {
    const listeners: Array<() => void> = [];
    const child: FakeChild = {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      signals: [],
      destroyed: [],
      unrefs: 0,
      kill: (signal = "SIGTERM") => {
        child.signals.push(signal);
        if ((input.exitsOn ?? ["SIGTERM", "SIGKILL"]).includes(signal)) {
          child.exit();
        }
        return true;
      },
      unref: () => {
        child.unrefs += 1;
      },
      once: (_event, listener) => {
        listeners.push(listener);
      },
      stdin: { destroy: () => child.destroyed.push("stdin") },
      stdout: { destroy: () => child.destroyed.push("stdout") },
      stderr: { destroy: () => child.destroyed.push("stderr") },
      exit: () => {
        child.signalCode = child.signals.at(-1) ?? null;
        for (const listener of listeners.splice(0)) listener();
      },
    };
    return child;
  };
  const asChild = (child: FakeChild) =>
    child as unknown as Parameters<typeof stopOpenCodeProcess>[0];

  it("terminates the server, drops its pipes and lets the runner exit", async () => {
    const child = fakeChild();
    stopOpenCodeProcess(asChild(child), 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(child.destroyed).toEqual(["stdin", "stdout", "stderr"]);
    expect(child.unrefs).toBe(1);
  });

  it("escalates to SIGKILL when the server survives SIGTERM", async () => {
    const child = fakeChild({ exitsOn: ["SIGKILL"] });
    stopOpenCodeProcess(asChild(child), 5);
    expect(child.signals).toEqual(["SIGTERM"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("leaves an already exited server alone", () => {
    const child = fakeChild();
    child.exitCode = 0;
    stopOpenCodeProcess(asChild(child));
    expect(child.signals).toEqual([]);
    expect(child.destroyed).toEqual([]);
  });
});
