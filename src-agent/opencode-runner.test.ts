import { describe, expect, it } from "vitest";

import { createOpenCodeEventState } from "./opencode-runner-lib";
import { openCodeFinalTurnOutputs } from "./opencode-runner";

describe("OpenCode runner terminal output", () => {
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
      (output) =>
        output.type === "event" && output.event?.type === "turnCompleted",
    );

    expect(terminal).toBeDefined();
    expect(terminal?.type === "event" ? terminal.raw : undefined).toBe(response);
    expect(
      terminal?.type === "event"
        ? (terminal.raw as typeof response).parts[1]
        : undefined,
    ).toEqual(response.parts[1]);
    for (const output of outputs) {
      if (output.type === "event") {
        expect(output.raw).toBe(response);
      }
    }
  });
});
