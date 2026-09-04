import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareReadOnlyAgentEnvironment } from "../src-cli/read-only-agent-environment";

const installedGrokBinary = (process.env.PATH ?? "")
  .split(delimiter)
  .map((directory) => join(directory, "grok"))
  .find(existsSync);

import { resolveAcpAuthMethodId } from "./acp-runner";
import {
  grokAgentArgs,
  grokAgentEnvironment,
  grokAgentSpawnSpec,
  grokProfile,
} from "./grok-runner";

describe("Grok ACP profile", () => {
  it("forces local, offline Grok mode for read-only turns", () => {
    expect(grokAgentArgs(true)).toEqual([
      "--disable-web-search",
      "--no-memory",
      "--no-subagents",
      "agent",
      "--no-leader",
      "stdio",
    ]);
    expect(grokAgentArgs(false)).toEqual(["agent", "stdio"]);
    expect(
      grokProfile.spawn({
        binary: "/bin/echo",
        workspaceRoot: "/repo",
        environment: {},
        readOnly: false,
      }),
    ).toEqual({ command: "/bin/echo", arguments: ["agent", "stdio"] });
  });

  it("fails closed when a read-only Grok OS sandbox is unavailable", () => {
    expect(() =>
      grokAgentSpawnSpec({
        binary: "/bin/echo",
        arguments: ["agent", "stdio"],
        workspaceRoot: "/repo",
        environment: { GROK_HOME: "/private/tmp/grok-state" },
        readOnly: true,
        platform: "linux",
      })
    ).toThrow("require the macOS OS sandbox");
    expect(() =>
      grokAgentSpawnSpec({
        binary: "/bin/echo",
        arguments: ["agent", "stdio"],
        workspaceRoot: "/repo",
        environment: {},
        readOnly: true,
      })
    ).toThrow("Grok read-only state is not isolated");
    expect(
      grokAgentSpawnSpec({
        binary: "/bin/echo",
        arguments: ["agent", "stdio"],
        workspaceRoot: "/repo",
        environment: {},
        readOnly: false,
      }),
    ).toEqual({ command: "/bin/echo", arguments: ["agent", "stdio"] });
  });

  it("uses only the outer Seatbelt profile for read-only Grok", () => {
    expect(
      grokAgentEnvironment(
        { GROK_SANDBOX: "briar_read_only", GROK_HOME: "/state" },
        true,
      ),
    ).toMatchObject({ GROK_SANDBOX: "off", GROK_HOME: "/state" });
    expect(
      grokProfile.environment({ GROK_HOME: "/state" }, false),
    ).toEqual({ GROK_HOME: "/state", GROK_OAUTH2_REFERRER: "briar" });
  });

  it("prefers the API key auth method when XAI_API_KEY is set", () => {
    expect(resolveAcpAuthMethodId(grokProfile, { XAI_API_KEY: "sk-test" }))
      .toBe("xai.api_key");
    expect(resolveAcpAuthMethodId(grokProfile, { XAI_API_KEY: "  " }))
      .toBe("cached_token");
    expect(resolveAcpAuthMethodId(grokProfile, {})).toBe("cached_token");
  });

  it("keeps the Grok lifecycle labels the desktop app matches on", () => {
    expect(grokProfile.providerName).toBe("Grok Agent");
    expect(grokProfile.displayName).toBe("Grok");
    expect(grokProfile.missingSessionIdMessage).toBe(
      "Grok agent did not return a session id.",
    );
    expect(grokProfile.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
    });
    expect(grokProfile.serverRequestResponses).toBeUndefined();
  });

  it("selects the Grok model and reasoning effort, tolerating older builds", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const emitted: Array<{ method: string; result: unknown }> = [];
    await grokProfile.configureSession({
      request: {
        message: "Inspect the repository",
        workspaceRoot: "/repo",
        model: "  grok-code-fast-1  ",
        effort: "high",
        approvalPolicy: "never",
        sandboxMode: "readOnly",
        networkAccess: false,
        attachments: [],
        additionalDirectories: [],
        providerBinaryPath: "/usr/local/bin/grok",
      },
      sessionId: "session-1",
      setup: { sessionId: "session-1" },
      call: (method, params) => {
        calls.push({ method, params });
        if (method === "session/set_config_option") {
          return Promise.reject(new Error("unsupported"));
        }
        return Promise.resolve({ ok: true });
      },
      emitRpc: (method, _params, result) => emitted.push({ method, result }),
    });

    expect(calls).toEqual([
      {
        method: "session/set_model",
        params: { sessionId: "session-1", modelId: "grok-code-fast-1" },
      },
      {
        method: "session/set_config_option",
        params: {
          sessionId: "session-1",
          configId: "reasoning_effort",
          value: "high",
        },
      },
    ]);
    expect(emitted).toEqual([
      { method: "session/set_model", result: { ok: true } },
    ]);
  });

  it("keeps the session default when set_model is unavailable", async () => {
    const emitted: string[] = [];
    const calls: string[] = [];
    await grokProfile.configureSession({
      request: {
        message: "Inspect the repository",
        workspaceRoot: "/repo",
        model: "grok-4.5",
        approvalPolicy: "never",
        sandboxMode: "readOnly",
        networkAccess: false,
        attachments: [],
        additionalDirectories: [],
        providerBinaryPath: "/usr/local/bin/grok",
      },
      sessionId: "session-1",
      setup: undefined,
      call: (method) => {
        calls.push(method);
        return Promise.reject(new Error("unsupported"));
      },
      emitRpc: (method) => emitted.push(method),
    });
    // A rejected set_model must not emit an event and must not fail the turn,
    // and an absent effort must not touch the session configuration at all.
    expect(calls).toEqual(["session/set_model"]);
    expect(emitted).toEqual([]);
  });

  it.skipIf(process.platform !== "darwin" || !installedGrokBinary)(
    "starts the installed Grok CLI without loading project instructions",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "briar-grok-seatbelt-"));
      const workspaceRoot = join(root, "repo");
      await mkdir(workspaceRoot);
      await writeFile(
        join(workspaceRoot, "AGENT.md"),
        "BRIAR_UNTRUSTED_GROK_INSTRUCTION",
      );
      const prepared = await prepareReadOnlyAgentEnvironment("grok", {
        workspaceRoot,
      });
      try {
        const binary = installedGrokBinary!;
        const spec = grokAgentSpawnSpec({
          binary,
          arguments: ["inspect", "--json"],
          workspaceRoot,
          environment: prepared.environment,
          readOnly: true,
        });
        const result = spawnSync(spec.command, spec.arguments, {
          cwd: workspaceRoot,
          env: grokAgentEnvironment(prepared.environment, true),
          encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain(
          "BRIAR_UNTRUSTED_GROK_INSTRUCTION",
        );
      } finally {
        await prepared.cleanup();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
