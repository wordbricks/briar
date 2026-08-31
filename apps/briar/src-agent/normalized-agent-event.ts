import { create } from "@bufbuild/protobuf";
import {
  NormalizedAgentEventSchema,
  type AgentActivityKind,
  type AgentActivityStatus,
  type NormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";

export const maxNormalizedActivityTextBytes = 16_000;
export const maxNormalizedActivityTitleBytes = 1_024;

export function normalizedActivityText(value: string): string {
  return boundedUtf8Text(
    value,
    maxNormalizedActivityTextBytes,
    "\n… output truncated …\n",
  );
}

export function normalizedActivityTitle(value: string): string {
  return boundedUtf8Text(value, maxNormalizedActivityTitleBytes, " … ");
}

function boundedUtf8Text(
  value: string,
  byteLimit: number,
  marker: string,
): string {
  if (Buffer.byteLength(value, "utf8") <= byteLimit) {
    return value;
  }
  const remaining = byteLimit - Buffer.byteLength(marker, "utf8");
  return `${utf8Prefix(value, Math.ceil(remaining / 2))}${marker}${utf8Suffix(value, Math.floor(remaining / 2))}`;
}

function utf8Prefix(value: string, byteLimit: number): string {
  let bytes = 0;
  let output = "";
  for (const character of value) {
    const length = Buffer.byteLength(character, "utf8");
    if (bytes + length > byteLimit) break;
    output += character;
    bytes += length;
  }
  return output;
}

function utf8Suffix(value: string, byteLimit: number): string {
  let bytes = 0;
  const output: string[] = [];
  const characters = Array.from(value);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    const length = Buffer.byteLength(character, "utf8");
    if (bytes + length > byteLimit) break;
    output.push(character);
    bytes += length;
  }
  return output.reverse().join("");
}

export const normalizedMessageStarted = (input: {
  id: string;
  phase?: string | null;
  text: string;
}): NormalizedAgentEvent =>
  create(NormalizedAgentEventSchema, {
    event: {
      case: "messageStarted",
      value: { ...input, phase: input.phase ?? undefined },
    },
  });

export const normalizedMessageDelta = (input: {
  id: string;
  delta: string;
}): NormalizedAgentEvent =>
  create(NormalizedAgentEventSchema, {
    event: { case: "messageDelta", value: input },
  });

export const normalizedMessageCompleted = (input: {
  id: string;
  phase?: string | null;
  text: string;
}): NormalizedAgentEvent =>
  create(NormalizedAgentEventSchema, {
    event: {
      case: "messageCompleted",
      value: { ...input, phase: input.phase ?? undefined },
    },
  });

export const normalizedActivityStarted = (input: {
  id: string;
  kind: AgentActivityKind;
  title: string;
  text: string;
}): NormalizedAgentEvent =>
  create(NormalizedAgentEventSchema, {
    event: { case: "activityStarted", value: input },
  });

export const normalizedActivityDelta = (input: {
  id: string;
  delta: string;
}): NormalizedAgentEvent =>
  create(NormalizedAgentEventSchema, {
    event: { case: "activityDelta", value: input },
  });

export const normalizedActivityCompleted = (input: {
  id: string;
  kind: AgentActivityKind;
  title: string;
  text: string;
  status: AgentActivityStatus;
}): NormalizedAgentEvent =>
  create(NormalizedAgentEventSchema, {
    event: { case: "activityCompleted", value: input },
  });

export const normalizedTurnCompleted = (status: string): NormalizedAgentEvent =>
  create(NormalizedAgentEventSchema, {
    event: { case: "turnCompleted", value: { status } },
  });
