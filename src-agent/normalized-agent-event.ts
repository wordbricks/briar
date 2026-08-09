export type AgentActivityKind =
  | "command"
  | "fileChange"
  | "webSearch"
  | "tool";

export type AgentActivityStatus = "completed" | "failed" | "cancelled";

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

export type NormalizedAgentEvent =
  | {
      type: "messageStarted";
      id: string;
      phase: string | null;
      text: string;
    }
  | {
      type: "messageDelta";
      id: string;
      delta: string;
    }
  | {
      type: "messageCompleted";
      id: string;
      phase: string | null;
      text: string;
    }
  | {
      type: "activityStarted";
      id: string;
      kind: AgentActivityKind;
      title: string;
      text: string;
    }
  | {
      type: "activityDelta";
      id: string;
      delta: string;
    }
  | {
      type: "activityCompleted";
      id: string;
      kind: AgentActivityKind;
      title: string;
      text: string;
      status: AgentActivityStatus;
    }
  | {
      type: "turnCompleted";
      status: string;
    };
