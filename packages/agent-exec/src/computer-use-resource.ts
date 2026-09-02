import type {
  ComputerUseAction,
  ComputerUseArgs,
  ComputerUseResult,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import { SimpleControlledExecHandler, type SimpleControlledExecManager } from "./controlled-exec";
import type {
  ControlledExecutor,
  Executor,
  RemoteExecManager,
} from "./exec-resource";
import { ExecutorResource } from "./exec-resource";
import { createResource } from "./resource-provider";
import {
  deserializeComputerUseArgs,
  deserializeComputerUseResult,
  serializeComputerUseArgs,
  serializeComputerUseResult,
} from "./serialization";

export interface ComputerUseActionCounts {
  readonly mouse_move: number;
  readonly click: number;
  readonly mouse_down: number;
  readonly mouse_up: number;
  readonly drag: number;
  readonly scroll: number;
  readonly type: number;
  readonly key: number;
  readonly wait: number;
  readonly screenshot: number;
  readonly cursor_position: number;
}

export interface ComputerUseActionSummary {
  readonly actionCount: number;
  readonly actionCounts: ComputerUseActionCounts;
}

export const summarizeComputerUseActions = (
  actions: readonly ComputerUseAction[],
): ComputerUseActionSummary => {
  const actionCounts = {
    mouse_move: 0,
    click: 0,
    mouse_down: 0,
    mouse_up: 0,
    drag: 0,
    scroll: 0,
    type: 0,
    key: 0,
    wait: 0,
    screenshot: 0,
    cursor_position: 0,
  };
  for (const action of actions) {
    switch (action.action.case) {
      case "mouseMove": actionCounts.mouse_move += 1; break;
      case "click": actionCounts.click += 1; break;
      case "mouseDown": actionCounts.mouse_down += 1; break;
      case "mouseUp": actionCounts.mouse_up += 1; break;
      case "drag": actionCounts.drag += 1; break;
      case "scroll": actionCounts.scroll += 1; break;
      case "type": actionCounts.type += 1; break;
      case "key": actionCounts.key += 1; break;
      case "wait": actionCounts.wait += 1; break;
      case "screenshot": actionCounts.screenshot += 1; break;
      case "cursorPosition": actionCounts.cursor_position += 1; break;
      case undefined: break;
    }
  }
  return { actionCount: actions.length, actionCounts };
};

export type ComputerUseExecutor = Executor<ComputerUseArgs, ComputerUseResult>;
export type ControlledComputerUseExecutor = ControlledExecutor<
  ComputerUseArgs,
  ComputerUseResult
>;

export const computerUseExecutorResource = createResource<
  ComputerUseExecutor,
  RemoteExecManager,
  SimpleControlledExecManager
>(
  (manager) => new ExecutorResource(
    manager,
    serializeComputerUseArgs,
    deserializeComputerUseResult,
  ),
  (implementation, manager) => manager.register(
    new SimpleControlledExecHandler(
      implementation,
      deserializeComputerUseArgs,
      serializeComputerUseResult,
    ),
  ),
);
