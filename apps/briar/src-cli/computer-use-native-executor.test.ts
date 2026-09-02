import { create } from "@bufbuild/protobuf";
import {
  ClickActionSchema,
  ComputerUseActionSchema,
  ComputerUseArgsSchema,
  CoordinateSchema,
  MouseButton,
  TypeActionSchema,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import { describe, expect, it } from "vitest";
import {
  NativeComputerUseExecutor,
  toNativeComputerAction,
  type NativeComputerUseProcessRunner,
  type NativeComputerUseRequest,
} from "./computer-use-native-executor";

describe("NativeComputerUseExecutor", () => {
  it("projects protobuf actions without forming shell commands", () => {
    const action = create(ComputerUseActionSchema, {
      action: {
        case: "click",
        value: create(ClickActionSchema, {
          coordinate: create(CoordinateSchema, { x: 20, y: 30 }),
          button: MouseButton.RIGHT,
          count: 2,
          modifierKeys: "Control",
        }),
      },
    });
    expect(toNativeComputerAction(action)).toEqual({
      type: "click",
      x: 20,
      y: 30,
      button: "right",
      count: 2,
      modifierKeys: "Control",
    });
  });

  it("passes the assigned display and preserves success evidence", async () => {
    let captured: NativeComputerUseRequest | undefined;
    const runner: NativeComputerUseProcessRunner = {
      run: async (request) => {
        captured = request;
        return {
          success: true,
          actionCount: 1,
          durationMs: 12,
          screenshot: "cG5n",
          screenshotPath: "/var/lib/briar-computer-use/screenshots/test.png",
          cursorPosition: { x: 5, y: 7 },
        };
      },
    };
    const executor = new NativeComputerUseExecutor(runner);
    const result = await executor.execute(create(ComputerUseArgsSchema, {
      toolCallId: "call-1",
      bindUnmappedCharacters: true,
      actions: [create(ComputerUseActionSchema, {
        action: {
          case: "type",
          value: create(TypeActionSchema, { text: "안녕" }),
        },
      })],
    }), { displayIndex: 4 });

    expect(captured).toMatchObject({
      displayIndex: 4,
      toolCallId: "call-1",
      bindUnmappedCharacters: true,
      actions: [{ type: "type", text: "안녕" }],
    });
    expect(result.result.case).toBe("success");
    if (result.result.case !== "success") throw new Error("expected success");
    expect(result.result.value).toMatchObject({
      actionCount: 1,
      screenshot: "cG5n",
      cursorPosition: { x: 5, y: 7 },
    });
  });

  it("returns action-level errors with the last screenshot", async () => {
    const executor = new NativeComputerUseExecutor({
      run: async () => ({
        success: false,
        error: "coordinate is outside the desktop",
        actionCount: 2,
        durationMs: 7,
        screenshot: "cG5n",
      }),
    });
    const result = await executor.execute(create(ComputerUseArgsSchema, {
      actions: [create(ComputerUseActionSchema, {
        action: { case: "type", value: create(TypeActionSchema, { text: "x" }) },
      })],
    }), { displayIndex: 2 });
    expect(result.result.case).toBe("error");
    if (result.result.case !== "error") throw new Error("expected error");
    expect(result.result.value).toMatchObject({
      actionCount: 2,
      screenshot: "cG5n",
      error: "coordinate is outside the desktop",
    });
  });
});
