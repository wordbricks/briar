import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createOpenCodeEventState } from "./opencode-runner-lib";
import {
  openCodeFinalTurnOutputs,
  openCodeReadOnlySeatbeltProfile,
  openCodeServerSpawnSpec,
} from "./opencode-runner";

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
      (output) => output.event.type === "turnCompleted",
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
