import { describe, expect, it } from "vitest";
import { resolveAcpAuthMethodId } from "./acp-runner";
import {
  buildCursorPromptParts,
  cursorAgentArgs,
  cursorAgentSpawnSpec,
  cursorEffortConfigUpdate,
  cursorModelConfigId,
  cursorProfile,
  mapEffortToCursor,
  resolveCursorModelId,
} from "./cursor-runner";
import type { RunnerRequest } from "./runner-request";

const request: RunnerRequest = {
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "gpt-5.4-medium-fast[reasoning=medium]",
  effort: "xhigh",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  attachments: [],
  additionalDirectories: [],
  providerBinaryPath: "/usr/local/bin/cursor-agent",
};

describe("Cursor ACP profile", () => {
  it("spawns cursor-agent acp and fails closed without an isolated state root", () => {
    expect(cursorAgentArgs()).toEqual(["acp"]);
    expect(
      cursorProfile.spawn({
        binary: "/usr/local/bin/cursor-agent",
        workspaceRoot: "/repo",
        environment: {},
        readOnly: false,
      }),
    ).toEqual({
      command: "/usr/local/bin/cursor-agent",
      arguments: ["acp"],
    });
    expect(() =>
      cursorAgentSpawnSpec({
        binary: "/usr/local/bin/cursor-agent",
        workspaceRoot: "/repo",
        environment: {},
        readOnly: true,
      })
    ).toThrow("Cursor read-only state is not isolated");
    expect(() =>
      cursorAgentSpawnSpec({
        binary: "/usr/local/bin/cursor-agent",
        workspaceRoot: "/repo",
        environment: { HOME: "/private/tmp/cursor-state" },
        readOnly: true,
        platform: "linux",
      })
    ).toThrow("require the macOS OS sandbox");
  });

  it("keeps the Cursor lifecycle labels, capabilities, and login method", () => {
    expect(cursorProfile.providerName).toBe("Cursor Agent");
    expect(cursorProfile.displayName).toBe("Cursor");
    expect(cursorProfile.missingSessionIdMessage).toBe(
      "Cursor Agent did not return a session id.",
    );
    expect(cursorProfile.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      _meta: { parameterizedModelPicker: true },
    });
    expect(resolveAcpAuthMethodId(cursorProfile, {})).toBe("cursor_login");
    // Cursor inherits the process environment untouched.
    expect(cursorProfile.environment({ HOME: "/state" }, true)).toEqual({
      HOME: "/state",
    });
  });

  it("answers Cursor's own server requests without an approval prompt", () => {
    expect(cursorProfile.serverRequestResponses).toEqual({
      "cursor/create_plan": { accepted: true },
      "cursor/ask_question": { answers: {} },
    });
  });

  it("preserves trusted instructions in the ACP prompt", async () => {
    expect(await buildCursorPromptParts({
      ...request,
      instructions: "Read the Briar workflow skill first.",
      outputSchema: { type: "object" },
    })).toEqual([
      {
        type: "text",
        text: 'Return only the JSON value that matches this schema, without Markdown fences or commentary:\n{"type":"object"}',
      },
      {
        type: "text",
        text: [
          "Follow these trusted Briar instructions:",
          "Read the Briar workflow skill first.",
          "User request:",
          "Inspect the repository",
        ].join("\n\n"),
      },
    ]);
    expect(await buildCursorPromptParts(request)).toEqual([
      { type: "text", text: "Inspect the repository" },
    ]);
    expect(cursorProfile.sessionMeta({ ...request, instructions: "Be terse" }))
      .toEqual({ rules: "Be terse" });
  });

  it("strips model picker suffixes and normalizes the effort label", () => {
    expect(resolveCursorModelId("gpt-5.4-medium-fast[reasoning=medium]")).toBe(
      "gpt-5.4-medium-fast",
    );
    expect(resolveCursorModelId("  ")).toBe("default");
    expect(mapEffortToCursor("extra-high")).toBe("xhigh");
    expect(mapEffortToCursor("Extra High")).toBe("xhigh");
    expect(mapEffortToCursor("high")).toBe("high");
    expect(mapEffortToCursor(undefined)).toBeUndefined();
  });

  it("discovers the model and effort config option ids from the session setup", () => {
    const setup = {
      configOptions: [
        { id: "cursor.model", category: "model", name: "Model" },
        {
          id: "cursor.effort",
          category: "model_option",
          name: "Reasoning effort",
          options: [
            { name: "Group", options: [{ value: "xhigh", name: "Extra high" }] },
            { value: "low", name: "Low" },
          ],
        },
      ],
    };
    expect(cursorModelConfigId(setup)).toBe("cursor.model");
    expect(cursorModelConfigId(undefined)).toBe("model");
    expect(cursorEffortConfigUpdate(setup, "xhigh")).toEqual({
      configId: "cursor.effort",
      value: "xhigh",
    });
    expect(cursorEffortConfigUpdate(setup, "medium")).toBeUndefined();
    expect(cursorEffortConfigUpdate(undefined, "xhigh")).toBeUndefined();
  });

  it("sets the model, then the effort discovered from the refreshed setup", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const emitted: Array<{ method: string; params: unknown }> = [];
    await cursorProfile.configureSession({
      request,
      sessionId: "cursor-session",
      setup: { sessionId: "cursor-session" },
      call: (method, params) => {
        calls.push({ method, params });
        return Promise.resolve(calls.length === 1
          ? {
            configOptions: [
              {
                id: "cursor.effort",
                category: "model_option",
                options: [{ value: "xhigh", name: "Extra high" }],
              },
            ],
          }
          : undefined);
      },
      emitRpc: (method, params) => emitted.push({ method, params }),
    });

    expect(calls).toEqual([
      {
        method: "session/set_config_option",
        params: {
          sessionId: "cursor-session",
          configId: "model",
          value: "gpt-5.4-medium-fast",
        },
      },
      {
        method: "session/set_config_option",
        params: {
          sessionId: "cursor-session",
          configId: "cursor.effort",
          value: "xhigh",
        },
      },
    ]);
    // Only the model selection is replayed to the desktop app.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.method).toBe("session/set_config_option");
  });

  it("keeps the session default when the effort option is unavailable", async () => {
    const calls: string[] = [];
    await cursorProfile.configureSession({
      request,
      sessionId: "cursor-session",
      setup: {
        configOptions: [
          {
            id: "cursor.effort",
            category: "model_option",
            options: [{ value: "xhigh" }],
          },
        ],
      },
      call: (method) => {
        calls.push(method);
        return calls.length === 1
          ? Promise.resolve(undefined)
          : Promise.reject(new Error("unsupported"));
      },
      emitRpc: () => undefined,
    });
    expect(calls).toEqual([
      "session/set_config_option",
      "session/set_config_option",
    ]);
  });
});
