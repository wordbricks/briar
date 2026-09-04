import { describe, expect, it } from "vitest";
import { resolveAcpAuthMethodId } from "./acp-runner";
import {
  mapEffortToPi,
  PI_AUTH_METHOD,
  piAgentArgs,
  piAgentEnvironment,
  piAgentSpawnSpec,
  piProfile,
  piThoughtLevelConfigUpdate,
  resolvePiModelId,
} from "./pi-runner";
import type { RunnerRequest } from "./runner-request";

const request: RunnerRequest = {
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "anthropic/claude-sonnet-4-5",
  effort: "extra-high",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/usr/local/bin/pi-acp",
};

/** Shaped like the `session/new` result `pi-acp` 0.0.33 returns. */
const setup = {
  sessionId: "pi-session",
  models: {
    currentModelId: "anthropic/claude-opus-4-8",
    availableModels: [
      { modelId: "anthropic/claude-opus-4-8", name: "anthropic/Claude Opus 4.8" },
      { modelId: "anthropic/claude-sonnet-4-5", name: "anthropic/Claude Sonnet 4.5" },
      { modelId: "openai/gpt-5.2", name: "openai/GPT-5.2" },
    ],
  },
  configOptions: [
    {
      id: "model",
      category: "model",
      currentValue: "anthropic/claude-opus-4-8",
      options: [
        { value: "anthropic/claude-opus-4-8", name: "anthropic/Claude Opus 4.8" },
        { value: "anthropic/claude-sonnet-4-5", name: "anthropic/Claude Sonnet 4.5" },
      ],
    },
    {
      id: "thought_level",
      category: "thought_level",
      currentValue: "medium",
      options: [
        { value: "off", name: "Thinking: off" },
        { value: "low", name: "Thinking: low" },
        { value: "medium", name: "Thinking: medium" },
        { value: "xhigh", name: "Thinking: xhigh" },
      ],
    },
  ],
};

describe("Pi ACP profile", () => {
  it("spawns the bare adapter and fails closed without an isolated state root", () => {
    expect(piAgentArgs()).toEqual([]);
    expect(
      piProfile.spawn({
        binary: "/usr/local/bin/pi-acp",
        workspaceRoot: "/repo",
        environment: {},
        readOnly: false,
      }),
    ).toEqual({ command: "/usr/local/bin/pi-acp", arguments: [] });
    // Pi has no state-directory environment override, so an absent HOME means
    // the turn would write into the user's real `~/.pi/agent`.
    expect(() =>
      piAgentSpawnSpec({
        binary: "/usr/local/bin/pi-acp",
        workspaceRoot: "/repo",
        environment: {},
        readOnly: true,
      })
    ).toThrow("Pi read-only state is not isolated");
  });

  it("refuses a read-only turn where the OS sandbox is unavailable", () => {
    // Pi's own `--mode rpc` has no sandbox of its own, so the Seatbelt
    // profile is the only thing confining the turn.
    expect(() =>
      piAgentSpawnSpec({
        binary: "/usr/local/bin/pi-acp",
        workspaceRoot: "/repo",
        environment: { HOME: "/private/tmp/pi-state" },
        readOnly: true,
        platform: "linux",
      })
    ).toThrow("require the macOS OS sandbox");
  });

  it("opts out of pi telemetry on every turn", () => {
    expect(piAgentEnvironment({ PATH: "/usr/bin" }, false)).toMatchObject({
      PATH: "/usr/bin",
      PI_TELEMETRY: "0",
    });
    expect(piAgentEnvironment({}, true).PI_TELEMETRY).toBe("0");
  });

  it("keeps the Pi lifecycle labels and its single terminal login method", () => {
    expect(piProfile.providerId).toBe("pi");
    expect(piProfile.providerName).toBe("Pi Agent");
    expect(piProfile.displayName).toBe("Pi");
    expect(piProfile.clientCapabilities.fs).toEqual({
      readTextFile: false,
      writeTextFile: false,
    });
    expect(PI_AUTH_METHOD).toBe("pi_terminal_login");
    expect(resolveAcpAuthMethodId(piProfile, {})).toBe("pi_terminal_login");
    expect(piProfile.serverRequestResponses).toBeUndefined();
  });

  it("resolves a bare model id against pi's provider-qualified catalog", () => {
    expect(resolvePiModelId(setup, "anthropic/claude-sonnet-4-5")).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    // A user who typed only the model name still reaches the right upstream.
    expect(resolvePiModelId(setup, "gpt-5.2")).toBe("openai/gpt-5.2");
    // Pi accepts ids it never advertised, so an unknown one passes through.
    expect(resolvePiModelId(setup, "anthropic/claude-opus-9")).toBe(
      "anthropic/claude-opus-9",
    );
    expect(resolvePiModelId(setup, "  ")).toBeUndefined();
    expect(resolvePiModelId(undefined, "openai/gpt-5.2")).toBe("openai/gpt-5.2");
  });

  it("maps Briar's effort onto pi's thinking levels", () => {
    expect(mapEffortToPi("extra-high")).toBe("xhigh");
    expect(mapEffortToPi("Extra High")).toBe("xhigh");
    expect(mapEffortToPi("low")).toBe("low");
    expect(mapEffortToPi(undefined)).toBeUndefined();
  });

  it("only sends a thinking level pi advertised for this session", () => {
    expect(piThoughtLevelConfigUpdate(setup, "xhigh")).toEqual({
      configId: "thought_level",
      value: "xhigh",
    });
    // `minimal` exists in pi but is not offered by this model's session.
    expect(piThoughtLevelConfigUpdate(setup, "minimal")).toBeUndefined();
    expect(piThoughtLevelConfigUpdate(undefined, "xhigh")).toBeUndefined();
  });

  it("selects the model and the thinking level through config options", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const emitted: Array<{ method: string; params: unknown }> = [];
    await piProfile.configureSession({
      request,
      sessionId: "pi-session",
      setup,
      call: (method, params) => {
        calls.push({ method, params });
        return Promise.resolve(undefined);
      },
      emitRpc: (method, params) => emitted.push({ method, params }),
    });

    expect(calls).toEqual([
      {
        method: "session/set_config_option",
        params: {
          sessionId: "pi-session",
          configId: "model",
          value: "anthropic/claude-sonnet-4-5",
        },
      },
      {
        method: "session/set_config_option",
        params: {
          sessionId: "pi-session",
          configId: "thought_level",
          value: "xhigh",
        },
      },
    ]);
    // Only the model selection is replayed to the desktop app.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.method).toBe("session/set_config_option");
  });

  it("keeps the session default when pi rejects the requested model", async () => {
    const calls: string[] = [];
    await piProfile.configureSession({
      request,
      sessionId: "pi-session",
      setup,
      call: (method) => {
        calls.push(method);
        return calls.length === 1
          ? Promise.reject(new Error("unknown model"))
          : Promise.resolve(undefined);
      },
      emitRpc: () => {},
    });
    // The rejected model does not abort the turn before the effort is applied.
    expect(calls).toEqual([
      "session/set_config_option",
      "session/set_config_option",
    ]);
  });
});
