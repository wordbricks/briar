import { describe, expect, it } from "vitest";
import {
  cursorAgentArgs,
  cursorAgentSpawnSpec,
  cursorModelConfigId,
  shouldSuppressCursorNotification,
} from "./cursor-runner";

describe("Cursor runner transport", () => {
  it("starts the Cursor ACP command", () => {
    expect(cursorAgentArgs()).toEqual(["acp"]);
    expect(cursorAgentSpawnSpec({
      binary: "/usr/local/bin/cursor-agent",
      workspaceRoot: "/repo",
      environment: {},
      readOnly: false,
    })).toEqual({
      command: "/usr/local/bin/cursor-agent",
      arguments: ["acp"],
    });
  });

  it("suppresses replay and load-time notifications", () => {
    expect(shouldSuppressCursorNotification({
      method: "session/update",
      params: { _meta: { isReplay: true } },
    }, false)).toBe(true);
    expect(shouldSuppressCursorNotification({ method: "session/update" }, true)).toBe(true);
    expect(shouldSuppressCursorNotification({ method: "session/update" }, false)).toBe(false);
  });

  it("selects Cursor's negotiated model configuration", () => {
    expect(cursorModelConfigId({
      configOptions: [
        { id: "thought", category: "thought_level" },
        { id: "cursor-model", category: "model" },
      ],
    })).toBe("cursor-model");
    expect(cursorModelConfigId(undefined)).toBe("model");
  });
});
