import type { DescField } from "@bufbuild/protobuf";
import { file_agent_v1_computer_use_tool } from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import { file_agent_v1_exec } from "@briar/contracts/gen/agent/v1/exec_pb";
import {
  ExecService,
  file_agent_v1_exec_service,
} from "@briar/contracts/gen/agent/v1/exec_service_pb";
import { expect, it } from "vitest";

interface ScalarTypeLabels {
  readonly [value: number]: string;
}

const scalarTypes: ScalarTypeLabels = {
  5: "int32",
  8: "bool",
  9: "string",
  13: "uint32",
};

const describeField = (field: DescField): string => {
  const type = field.message?.typeName
    ?? field.enum?.typeName
    ?? scalarTypes[field.scalar ?? -1];
  if (type === undefined) {
    throw new Error(`Unsupported Computer Use field type: ${field}`);
  }

  const cardinality = field.fieldKind === "list"
    ? "repeated "
    : field.proto.proto3Optional
      ? "optional "
      : "";
  const oneof = field.oneof === undefined ? "" : `@${field.oneof.name}`;
  return `${field.number}:${cardinality}${type}:${field.name}${oneof}`;
};

it("matches the Grok Bot 0.18 Computer Use descriptor manifest", () => {
  const file = file_agent_v1_computer_use_tool;

  expect(file.proto.package).toBe("agent.v1");
  expect(Object.fromEntries(file.enums.map((descriptor) => [
    descriptor.name,
    descriptor.values.map((value) => `${value.number}:${value.name}`),
  ]))).toEqual({
    MouseButton: [
      "0:MOUSE_BUTTON_UNSPECIFIED",
      "1:MOUSE_BUTTON_LEFT",
      "2:MOUSE_BUTTON_RIGHT",
      "3:MOUSE_BUTTON_MIDDLE",
      "4:MOUSE_BUTTON_BACK",
      "5:MOUSE_BUTTON_FORWARD",
    ],
    ScrollDirection: [
      "0:SCROLL_DIRECTION_UNSPECIFIED",
      "1:SCROLL_DIRECTION_UP",
      "2:SCROLL_DIRECTION_DOWN",
      "3:SCROLL_DIRECTION_LEFT",
      "4:SCROLL_DIRECTION_RIGHT",
    ],
  });
  expect(Object.fromEntries(file.messages.map((message) => [
    message.name,
    message.fields.map(describeField),
  ]))).toEqual({
    Coordinate: ["1:int32:x", "2:int32:y"],
    ComputerUseArgs: [
      "1:string:tool_call_id",
      "2:repeated agent.v1.ComputerUseAction:actions",
      "3:optional string:description",
      "4:optional bool:bind_unmapped_characters",
    ],
    ComputerUseAction: [
      "1:agent.v1.MouseMoveAction:mouse_move@action",
      "2:agent.v1.ClickAction:click@action",
      "3:agent.v1.MouseDownAction:mouse_down@action",
      "4:agent.v1.MouseUpAction:mouse_up@action",
      "5:agent.v1.DragAction:drag@action",
      "6:agent.v1.ScrollAction:scroll@action",
      "7:agent.v1.TypeAction:type@action",
      "8:agent.v1.KeyAction:key@action",
      "9:agent.v1.WaitAction:wait@action",
      "10:agent.v1.ScreenshotAction:screenshot@action",
      "11:agent.v1.CursorPositionAction:cursor_position@action",
    ],
    MouseMoveAction: ["1:agent.v1.Coordinate:coordinate"],
    ClickAction: [
      "1:optional agent.v1.Coordinate:coordinate",
      "2:agent.v1.MouseButton:button",
      "3:int32:count",
      "4:optional string:modifier_keys",
    ],
    MouseDownAction: ["1:agent.v1.MouseButton:button"],
    MouseUpAction: ["1:agent.v1.MouseButton:button"],
    DragAction: [
      "1:repeated agent.v1.Coordinate:path",
      "2:agent.v1.MouseButton:button",
      "3:optional string:modifier_keys",
    ],
    ScrollAction: [
      "1:optional agent.v1.Coordinate:coordinate",
      "2:agent.v1.ScrollDirection:direction",
      "3:int32:amount",
      "4:optional string:modifier_keys",
    ],
    TypeAction: ["1:string:text"],
    KeyAction: ["1:string:key", "2:optional int32:hold_duration_ms"],
    WaitAction: ["1:int32:duration_ms"],
    ScreenshotAction: [],
    CursorPositionAction: [],
    ComputerUseResult: [
      "1:agent.v1.ComputerUseSuccess:success@result",
      "2:agent.v1.ComputerUseError:error@result",
    ],
    ComputerUseSuccess: [
      "1:int32:action_count",
      "2:int32:duration_ms",
      "3:optional string:screenshot",
      "4:optional string:log",
      "5:optional string:screenshot_path",
      "6:optional agent.v1.Coordinate:cursor_position",
    ],
    ComputerUseError: [
      "1:string:error",
      "2:int32:action_count",
      "3:int32:duration_ms",
      "4:optional string:log",
      "5:optional string:screenshot",
      "6:optional string:screenshot_path",
    ],
    ComputerUseToolCall: [
      "1:agent.v1.ComputerUseArgs:args",
      "2:agent.v1.ComputerUseResult:result",
    ],
  });
});

it("keeps the Grok exec envelope fields used by Computer Use", () => {
  expect(Object.fromEntries(file_agent_v1_exec.messages.map((message) => [
    message.name,
    message.fields.map(describeField),
  ]))).toEqual({
    ExecClientStreamClose: ["1:uint32:id"],
    ExecClientThrow: [
      "1:uint32:id",
      "2:string:error",
      "3:optional string:stack_trace",
      "4:optional string:error_code",
    ],
    ExecClientHeartbeat: ["1:uint32:id"],
    ExecClientControlMessage: [
      "1:agent.v1.ExecClientStreamClose:stream_close@message",
      "2:agent.v1.ExecClientThrow:throw@message",
      "3:agent.v1.ExecClientHeartbeat:heartbeat@message",
    ],
    ExecServerMessage: [
      "1:uint32:id",
      "15:string:exec_id",
      "22:agent.v1.ComputerUseArgs:computer_use_args@message",
    ],
    ExecClientMessage: [
      "1:uint32:id",
      "15:string:exec_id",
      "22:agent.v1.ComputerUseResult:computer_use_result@message",
      "39:optional int32:local_execution_time_ms",
    ],
  });
  expect(file_agent_v1_exec_service.messages[0]?.fields.map(describeField)).toEqual([
    "1:agent.v1.ExecClientMessage:exec_client_message@element",
    "2:agent.v1.ExecClientControlMessage:exec_client_control_message@element",
  ]);
  expect(ExecService.typeName).toBe("agent.v1.ExecService");
  expect(ExecService.methods.map((method) => ({
    input: method.input.typeName,
    kind: method.methodKind,
    name: method.name,
    output: method.output.typeName,
  }))).toEqual([{
    input: "agent.v1.ExecServerMessage",
    kind: "server_streaming",
    name: "Exec",
    output: "agent.v1.ExecStreamElement",
  }]);
});
