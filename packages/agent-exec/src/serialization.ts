import { create } from "@bufbuild/protobuf";
import type {
  ComputerUseArgs,
  ComputerUseResult,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import {
  ExecClientMessageSchema,
  type ExecClientMessage,
  ExecServerMessageSchema,
  type ExecServerMessage,
} from "@briar/contracts/gen/agent/v1/exec_pb";

export const COMPUTER_USE_ARGS_CASE = "computerUseArgs" as const;
export const COMPUTER_USE_RESULT_CASE = "computerUseResult" as const;

export const serializeComputerUseArgs = (
  id: number,
  args: ComputerUseArgs,
): ExecServerMessage => create(ExecServerMessageSchema, {
  id,
  message: { case: COMPUTER_USE_ARGS_CASE, value: args },
});

export const deserializeComputerUseArgs = (
  message: ExecServerMessage,
): { readonly id: number; readonly args: ComputerUseArgs } | undefined =>
  message.message.case === COMPUTER_USE_ARGS_CASE
    ? { id: message.id, args: message.message.value }
    : undefined;

export const serializeComputerUseResult = (
  id: number,
  result: ComputerUseResult,
): ExecClientMessage => create(ExecClientMessageSchema, {
  id,
  message: { case: COMPUTER_USE_RESULT_CASE, value: result },
});

export const deserializeComputerUseResult = (
  message: ExecClientMessage,
): ComputerUseResult | undefined =>
  message.message.case === COMPUTER_USE_RESULT_CASE
    ? message.message.value
    : undefined;
