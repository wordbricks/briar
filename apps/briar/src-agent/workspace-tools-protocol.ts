/*
  The `tools issue …` and `tools channel …` half of the agent's `tools`
  command (docs/plans/agent-workspace-tools.md). Frames travel over the same
  per-turn file relay as `tools memory`, with the same envelope
  (`MemoryToolsRequestFrame`): only `command` differs. Workspace commands are
  namespaced (`issue.create`, `channel.post`) so they can never be mistaken
  for a memory command.

  Nothing here is an authority. The Worker CLI adds the claim identity and its
  own credential; the server derives the organization, the projects the run may
  touch and the acting Agent from that claim.

  Bodies (issue descriptions, notes, channel posts) travel base64-encoded, like
  memory bodies, so a body full of characters JSON escapes still fits a frame.
*/

/** Largest body any workspace write accepts; the server enforces its own column limits too. */
export const workspaceToolsMaxBodyBytes = 48 * 1024;

/** Issue statuses an agent may name. `queued` asks for human execution approval. */
export const agentIssueStatuses = ["backlog", "queued", "blocked", "completed", "cancelled"] as const;
export type AgentIssueStatus = (typeof agentIssueStatuses)[number];

/** Statuses `issue list` filters on; includes the lifecycle-owned ones an agent can read but not set. */
export const listableIssueStatuses = [
  "backlog", "queued", "running", "blocked", "failed", "completed", "cancelled",
] as const;
export type ListableIssueStatus = (typeof listableIssueStatuses)[number];

export type WorkspaceToolsCommand =
  | {
      readonly command: "issue.list";
      readonly statuses: readonly ListableIssueStatus[];
      readonly text?: string;
      readonly cursor?: string;
      readonly limit?: number;
    }
  | { readonly command: "issue.show"; readonly issue: string }
  | {
      readonly command: "issue.create";
      readonly requestKey: string;
      readonly title: string;
      readonly descriptionBase64?: string;
      readonly priority?: number;
      readonly parent?: string;
      readonly status: "backlog" | "queued";
    }
  | {
      readonly command: "issue.note";
      readonly requestKey: string;
      readonly issue: string;
      readonly bodyBase64: string;
    }
  | {
      readonly command: "issue.status";
      readonly requestKey: string;
      readonly issue: string;
      readonly status: AgentIssueStatus;
      readonly reason?: string;
    }
  | {
      readonly command: "issue.update";
      readonly requestKey: string;
      readonly issue: string;
      readonly title?: string;
      readonly descriptionBase64?: string;
      readonly priority?: number;
    }
  | { readonly command: "channel.list" }
  | {
      readonly command: "channel.read";
      readonly channel: string;
      readonly thread?: string;
      readonly cursor?: string;
      readonly limit?: number;
    }
  | {
      readonly command: "channel.post";
      readonly requestKey: string;
      readonly channel: string;
      readonly thread?: string;
      readonly bodyBase64: string;
    };

export type WorkspaceToolsCommandName = WorkspaceToolsCommand["command"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const boundedString = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= maximum;

const optionalString = (value: unknown, maximum: number): value is string | undefined =>
  value === undefined || boundedString(value, maximum);

const optionalLimit = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100);

const optionalPriority = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 4);

/** Base64 of at most `workspaceToolsMaxBodyBytes` bytes. */
const base64Body = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 4 &&
  value.length <= Math.ceil(workspaceToolsMaxBodyBytes / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);

const optionalBase64Body = (value: unknown): value is string | undefined =>
  value === undefined || base64Body(value);

/** A caller-chosen idempotency key: printable, no whitespace. */
export const requestKeyPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

const requestKey = (value: unknown): value is string =>
  typeof value === "string" && requestKeyPattern.test(value);

const reference = (value: unknown): value is string => boundedString(value, 200);

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const invalid = (): never => {
  throw new Error("memory_tools_request_invalid");
};

const present = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

export const isWorkspaceToolsCommandName = (value: unknown): value is WorkspaceToolsCommandName =>
  typeof value === "string" && (value.startsWith("issue.") || value.startsWith("channel."));

/** Validates a workspace frame field by field; anything else fails closed. */
export function decodeWorkspaceToolsCommand(value: unknown): WorkspaceToolsCommand {
  if (!isRecord(value) || typeof value.command !== "string") return invalid();
  switch (value.command) {
    case "issue.list": {
      const statuses = value.statuses;
      if (!Array.isArray(statuses) || statuses.length > listableIssueStatuses.length ||
          !statuses.every((status) => isOneOf(listableIssueStatuses, status)) ||
          !optionalString(value.text, 500) || !optionalString(value.cursor, 500) ||
          !optionalLimit(value.limit)) return invalid();
      return {
        command: "issue.list",
        statuses: [...new Set(statuses as ListableIssueStatus[])],
        ...present("text", value.text),
        ...present("cursor", value.cursor),
        ...present("limit", value.limit),
      };
    }
    case "issue.show":
      if (!reference(value.issue)) return invalid();
      return { command: "issue.show", issue: value.issue };
    case "issue.create":
      if (!requestKey(value.requestKey) || !boundedString(value.title, 300) || value.title.trim() !== value.title ||
          !optionalBase64Body(value.descriptionBase64) || !optionalPriority(value.priority) ||
          !(value.parent === undefined || reference(value.parent)) ||
          (value.status !== "backlog" && value.status !== "queued")) return invalid();
      return {
        command: "issue.create",
        requestKey: value.requestKey,
        title: value.title,
        ...present("descriptionBase64", value.descriptionBase64),
        ...present("priority", value.priority),
        ...present("parent", value.parent),
        status: value.status,
      };
    case "issue.note":
      if (!requestKey(value.requestKey) || !reference(value.issue) || !base64Body(value.bodyBase64)) return invalid();
      return { command: "issue.note", requestKey: value.requestKey, issue: value.issue, bodyBase64: value.bodyBase64 };
    case "issue.status":
      if (!requestKey(value.requestKey) || !reference(value.issue) || !isOneOf(agentIssueStatuses, value.status) ||
          !optionalString(value.reason, 2_000)) return invalid();
      return {
        command: "issue.status",
        requestKey: value.requestKey,
        issue: value.issue,
        status: value.status,
        ...present("reason", value.reason),
      };
    case "issue.update":
      if (!requestKey(value.requestKey) || !reference(value.issue) ||
          !(value.title === undefined || (boundedString(value.title, 300) && value.title.trim() === value.title)) ||
          !optionalBase64Body(value.descriptionBase64) || !optionalPriority(value.priority) ||
          (value.title === undefined && value.descriptionBase64 === undefined && value.priority === undefined)) {
        return invalid();
      }
      return {
        command: "issue.update",
        requestKey: value.requestKey,
        issue: value.issue,
        ...present("title", value.title),
        ...present("descriptionBase64", value.descriptionBase64),
        ...present("priority", value.priority),
      };
    case "channel.list":
      return { command: "channel.list" };
    case "channel.read":
      if (!reference(value.channel) || !(value.thread === undefined || reference(value.thread)) ||
          !optionalString(value.cursor, 500) || !optionalLimit(value.limit)) return invalid();
      return {
        command: "channel.read",
        channel: value.channel,
        ...present("thread", value.thread),
        ...present("cursor", value.cursor),
        ...present("limit", value.limit),
      };
    case "channel.post":
      if (!requestKey(value.requestKey) || !reference(value.channel) ||
          !(value.thread === undefined || reference(value.thread)) || !base64Body(value.bodyBase64)) return invalid();
      return {
        command: "channel.post",
        requestKey: value.requestKey,
        channel: value.channel,
        ...present("thread", value.thread),
        bodyBase64: value.bodyBase64,
      };
    default:
      return invalid();
  }
}
