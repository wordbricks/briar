import { describe, expect, it } from "vitest";
import {
  buildComputerUseArgs,
  ComputerToolInputError,
  decodeComputerToolInput,
} from "./computer-tool";

const viewport = { width: 1_280, height: 720 };

describe("Computer tool input", () => {
  it("maps a Grok-style action sequence and appends a screenshot", () => {
    const args = buildComputerUseArgs({
      raw: {
        action: "click",
        x: 120,
        y: 80,
        count: 2,
        description: "Open settings",
        then: [
          { action: "type", text: "hello" },
          { action: "wait", durationMs: 250 },
        ],
      },
      toolCallId: "tool-1",
      viewport,
      bindUnmappedCharacters: true,
    });

    expect(args.toolCallId).toBe("tool-1");
    expect(args.description).toBe("Open settings");
    expect(args.bindUnmappedCharacters).toBe(true);
    expect(args.actions.map((action) => action.action.case)).toEqual([
      "click",
      "type",
      "wait",
      "screenshot",
    ]);
    expect(args.actions[0]?.action.value).toMatchObject({
      coordinate: { x: 120, y: 80 },
      count: 2,
    });
  });

  it("does not append a second screenshot", () => {
    const args = buildComputerUseArgs({
      raw: { action: "screenshot" },
      toolCallId: "tool-2",
      viewport,
    });
    expect(args.actions.map((action) => action.action.case)).toEqual(["screenshot"]);
  });

  it("rejects Grok-incompatible wait, click, drag, and follow-up inputs", () => {
    expect(() => decodeComputerToolInput({ action: "wait", durationMs: 30_001 }))
      .toThrow();
    expect(() => decodeComputerToolInput({ action: "click", count: 4 }))
      .toThrow();
    expect(() => decodeComputerToolInput({ action: "drag", x: 1, y: 2 }))
      .toThrow();
    expect(() => decodeComputerToolInput({
      action: "click",
      then: Array.from({ length: 10 }, () => ({ action: "wait" })),
    })).toThrow();
    expect(() => decodeComputerToolInput({
      action: "click",
      then: [{ action: "screenshot" }],
    })).toThrow();
  });

  it("rejects coordinates outside the latest screenshot", () => {
    expect(() => buildComputerUseArgs({
      raw: { action: "click", x: 1_280, y: 20 },
      toolCallId: "tool-3",
      viewport,
    })).toThrow(ComputerToolInputError);
  });
});
