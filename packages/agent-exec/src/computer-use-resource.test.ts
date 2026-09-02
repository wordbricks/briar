import { create } from "@bufbuild/protobuf";
import {
  ComputerUseResultSchema,
  ComputerUseSuccessSchema,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import {
  ExecClientControlMessageSchema,
  ExecClientThrowSchema,
  ExecServerMessageSchema,
  type ExecServerMessage,
} from "@briar/contracts/gen/agent/v1/exec_pb";
import {
  ExecStreamElementSchema,
  type ExecStreamElement,
} from "@briar/contracts/gen/agent/v1/exec_service_pb";
import { describe, expect, it } from "vitest";
import { buildComputerUseArgs } from "./computer-tool";
import {
  computerUseExecutorResource,
  summarizeComputerUseActions,
} from "./computer-use-resource";
import { ConnectRemoteExecManager } from "./connect-exec-manager";
import { SimpleControlledExecManager } from "./controlled-exec";
import { RemoteResourceAccessor, RegistryResourceAccessor } from "./resource-provider";

describe("Computer Use executor resource", () => {
  it("runs through the resource, exec envelope, and controlled handler", async () => {
    const registry = new RegistryResourceAccessor<SimpleControlledExecManager>();
    registry.register(computerUseExecutorResource, {
      async execute(args) {
        return create(ComputerUseResultSchema, {
          result: {
            case: "success",
            value: create(ComputerUseSuccessSchema, {
              actionCount: args.actions.length,
              durationMs: 12,
              screenshot: "cG5n",
            }),
          },
        });
      },
    });
    const controlled = SimpleControlledExecManager.fromResources(registry, 5);
    const client = {
      exec: (message: ExecServerMessage) => controlled.handle(message),
    };
    const accessor = new RemoteResourceAccessor(
      new ConnectRemoteExecManager(client),
    );
    const args = buildComputerUseArgs({
      raw: { action: "click", x: 10, y: 20 },
      toolCallId: "tool-resource",
      viewport: { width: 1_280, height: 720 },
    });

    const result = await accessor.get(computerUseExecutorResource).execute(args);

    expect(result.result.case).toBe("success");
    expect(result.result.value).toMatchObject({
      actionCount: 2,
      screenshot: "cG5n",
    });
    expect(summarizeComputerUseActions(args.actions)).toEqual({
      actionCount: 2,
      actionCounts: {
        mouse_move: 0,
        click: 1,
        mouse_down: 0,
        mouse_up: 0,
        drag: 0,
        scroll: 0,
        type: 0,
        key: 0,
        wait: 0,
        screenshot: 1,
        cursor_position: 0,
      },
    });
  });

  it("turns remote throw controls into errors", async () => {
    const client = {
      async *exec(): AsyncIterable<ExecStreamElement> {
        yield create(ExecStreamElementSchema, {
          element: {
            case: "execClientControlMessage",
            value: create(ExecClientControlMessageSchema, {
              message: {
                case: "throw",
                value: create(ExecClientThrowSchema, {
                  id: 1,
                  error: "executor unavailable",
                  errorCode: "EXEC_BACKEND_UNAVAILABLE",
                }),
              },
            }),
          },
        });
      },
    };
    const manager = new ConnectRemoteExecManager(client);

    await expect(async () => {
      for await (const _message of manager.createExecInstance((id) =>
        create(ExecServerMessageSchema, { id }))) {
        // A throw control never yields a result message.
      }
    }).rejects.toThrow("executor unavailable");
  });
});
