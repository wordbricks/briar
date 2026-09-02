import { create } from "@bufbuild/protobuf";
import {
  ComputerUseArgsSchema,
  ComputerUseResultSchema,
  ComputerUseSuccessSchema,
  ScreenshotActionSchema,
  ComputerUseActionSchema,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import { describe, expect, it, vi } from "vitest";
import {
  ComputerUsePolicyBlockedError,
  GovernedComputerUseExecutor,
} from "./computer-use-governance";

const args = create(ComputerUseArgsSchema, {
  actions: [create(ComputerUseActionSchema, {
    action: { case: "screenshot", value: create(ScreenshotActionSchema) },
  })],
});

describe("Computer Use governance", () => {
  it("runs policy before executor and records metadata without content", async () => {
    const order: string[] = [];
    const record = vi.fn();
    const executor = new GovernedComputerUseExecutor({
      execute: async () => {
        order.push("execute");
        return create(ComputerUseResultSchema, {
          result: {
            case: "success",
            value: create(ComputerUseSuccessSchema, { actionCount: 1 }),
          },
        });
      },
    }, {
      review: async () => {
        order.push("review");
        return { allowed: true };
      },
    }, { record });

    await executor.execute(args, { displayIndex: 2 });
    expect(order).toEqual(["review", "execute"]);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      displayIndex: 2,
      outcome: "success",
      completedActionCount: 1,
      summary: expect.objectContaining({ actionCount: 1 }),
    }));
    expect(JSON.stringify(record.mock.calls)).not.toContain("screenshotPath");
  });

  it("does not call the executor when policy blocks", async () => {
    const execute = vi.fn();
    const executor = new GovernedComputerUseExecutor({ execute }, {
      review: async () => ({ allowed: false, reason: "human takeover required" }),
    });

    await expect(executor.execute(args, { displayIndex: 2 })).rejects.toThrow(
      ComputerUsePolicyBlockedError,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
