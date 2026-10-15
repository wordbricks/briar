import {
  agentIssueStatuses,
  listableIssueStatuses,
  requestKeyPattern,
  workspaceToolsMaxBodyBytes,
  type AgentIssueStatus,
  type ListableIssueStatus,
  type WorkspaceToolsCommand,
} from "./workspace-tools-protocol";

/*
  Argument parsing for `tools issue …` and `tools channel …`
  (docs/plans/agent-workspace-tools.md). The `tools` entry point
  (memory-tools.ts) owns the process, the config and the relay; this module
  only turns argv into a workspace command whose body still has to be read.
*/

export const workspaceToolsHelp = `Issues (the team this run belongs to):
  issue list [--status S[,S]] [--text T] [--cursor C] [--limit N]
      Issues, most recently updated first. Statuses: ${listableIssueStatuses.join(", ")}.
  issue show <issue>
      Fields, description and the latest conversation notes. <issue> is a key (AH-12) or id.
  issue create --title T [--description D | --description-file F] [--priority 1-4|urgent|high|medium|low]
               [--parent <issue>] [--queue] [--request-key K]
      Creates a backlog issue as you. --queue asks a person to approve execution.
  issue note <issue> [text | --body-file F] [--request-key K]
      Adds a note to the issue's conversation as you. Text may also come on stdin.
  issue status <issue> <backlog|blocked|completed|cancelled|queued> [--reason R] [--request-key K]
      Moves the issue. queued never starts work: it asks a person for execution approval.
  issue update <issue> [--title T] [--description D | --description-file F] [--priority P] [--request-key K]

Channels (non-DM channels you are a member of):
  channel list
  channel read <channel> [--thread MESSAGE_ID] [--cursor C] [--limit N]
      <channel> is an id or name (#eng). Newest page first; follow next_cursor for older messages.
  channel post <channel> [text | --body-file F] [--thread MESSAGE_ID] [--request-key K]
      Posts as you. Posts never notify or start other agents. 30 agent posts per hour per organization.

Every write takes --request-key: reuse the same key when retrying after a timeout and the
write happens at most once. Without one, each invocation is a new write.`;

type Flag = { readonly name: string; readonly switch?: true };

const commandFlags = {
  "issue.list": [{ name: "status" }, { name: "text" }, { name: "cursor" }, { name: "limit" }],
  "issue.show": [],
  "issue.create": [
    { name: "title" }, { name: "description" }, { name: "description-file" }, { name: "priority" },
    { name: "parent" }, { name: "queue", switch: true }, { name: "request-key" },
  ],
  "issue.note": [{ name: "body-file" }, { name: "request-key" }],
  "issue.status": [{ name: "reason" }, { name: "request-key" }],
  "issue.update": [
    { name: "title" }, { name: "description" }, { name: "description-file" }, { name: "priority" },
    { name: "request-key" },
  ],
  "channel.list": [],
  "channel.read": [{ name: "thread" }, { name: "cursor" }, { name: "limit" }],
  "channel.post": [{ name: "body-file" }, { name: "thread" }, { name: "request-key" }],
} as const satisfies Readonly<Record<WorkspaceToolsCommand["command"], readonly Flag[]>>;

/** Where a write's body comes from; read after parsing, like `tools memory save`. */
export type BodySource =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "stdin" };

/**
 * A parsed command. Bodies are absent from `command`: `body` says where to read
 * the one body the command carries, and the caller base64-encodes it into
 * `bodyField`. A missing request key is filled in per invocation.
 */
export type ParsedWorkspaceCommand = {
  readonly command: DistributiveOmit<WorkspaceToolsCommand, "bodyBase64" | "descriptionBase64" | "requestKey">;
  readonly body: BodySource | null;
  readonly bodyField: "bodyBase64" | "descriptionBase64" | null;
  readonly requestKey: string | null;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class WorkspaceUsageError extends Error {}

const usage = (message: string): never => {
  throw new WorkspaceUsageError(message);
};

const priorityNames: Readonly<Record<string, number>> = { urgent: 1, high: 2, medium: 3, low: 4 };

const priority = (raw: string) => {
  const value = priorityNames[raw.toLowerCase()] ?? (/^[1-4]$/u.test(raw) ? Number(raw) : null);
  if (value === null) return usage("--priority must be 1-4 or urgent, high, medium, low");
  return value;
};

const limit = (raw: string) => {
  if (!/^\d{1,3}$/u.test(raw) || Number(raw) < 1 || Number(raw) > 100) usage("--limit must be between 1 and 100");
  return Number(raw);
};

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value);

/** Parses `issue …` or `channel …` (the arguments after `tools`). Null means help. */
export function parseWorkspaceToolsArgv(argv: readonly string[]): ParsedWorkspaceCommand | null {
  const [group, action] = argv;
  if (action === undefined || action === "--help" || action === "-h" || action === "help") return null;
  const name = `${group}.${action}`;
  if (!Object.hasOwn(commandFlags, name)) usage(`unknown command "${group} ${action}"`);
  const known: readonly Flag[] = commandFlags[name as keyof typeof commandFlags];
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let optionsEnded = false;
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (optionsEnded || !argument.startsWith("--") || argument === "--") {
      if (argument === "--" && !optionsEnded) { optionsEnded = true; continue; }
      positionals.push(argument);
      continue;
    }
    if (argument === "--help") return null;
    const equals = argument.indexOf("=");
    const flagName = argument.slice(2, equals === -1 ? undefined : equals);
    const flag = known.find((candidate) => candidate.name === flagName);
    if (!flag) usage(`unknown option --${flagName} for "${group} ${action}"`);
    if (flags.has(flagName)) usage(`--${flagName} given more than once`);
    if (flag!.switch) {
      if (equals !== -1) usage(`--${flagName} takes no value`);
      flags.set(flagName, true);
      continue;
    }
    let value: string;
    if (equals !== -1) value = argument.slice(equals + 1);
    else {
      const next = argv[index + 1];
      if (next === undefined) usage(`--${flagName} needs a value`);
      value = next!;
      index += 1;
    }
    if (value.length === 0) usage(`--${flagName} needs a value`);
    flags.set(flagName, value);
  }
  const text = (flag: string) => {
    const value = flags.get(flag);
    return typeof value === "string" ? value : undefined;
  };
  const requestKey = text("request-key") ?? null;
  if (requestKey !== null && !requestKeyPattern.test(requestKey)) {
    usage("--request-key must be 1-128 letters, digits or . _ : -");
  }
  const one = (what: string) => {
    if (positionals.length < 1) usage(`"${group} ${action}" needs ${what}`);
    return positionals[0]!;
  };
  const noMore = (count: number) => {
    if (positionals.length > count) usage(`"${group} ${action}" takes ${count === 0 ? "no" : count} argument${count === 1 ? "" : "s"}`);
  };
  const description = (): BodySource | null => {
    const inline = text("description");
    const file = text("description-file");
    if (inline !== undefined && file !== undefined) usage("give --description or --description-file, not both");
    if (inline !== undefined) return { kind: "text", text: inline };
    if (file !== undefined) return file === "-" ? { kind: "stdin" } : { kind: "file", path: file };
    return null;
  };
  /** Positional text, else --body-file, else stdin: a note or post always has a body. */
  const body = (from: number): BodySource => {
    const inline = positionals.slice(from).join(" ");
    const file = text("body-file");
    if (inline.trim() !== "" && file !== undefined) usage("give the text or --body-file, not both");
    if (inline.trim() !== "") return { kind: "text", text: inline };
    if (file !== undefined) return file === "-" ? { kind: "stdin" } : { kind: "file", path: file };
    return { kind: "stdin" };
  };
  const optionalPriority = () => {
    const raw = text("priority");
    return raw === undefined ? undefined : priority(raw);
  };
  switch (name as keyof typeof commandFlags) {
    case "issue.list": {
      noMore(0);
      const raw = text("status");
      const statuses = raw === undefined ? [] : raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      const invalid = statuses.find((status) => !isOneOf(listableIssueStatuses, status));
      if (invalid !== undefined) usage(`unknown status "${invalid}"; use ${listableIssueStatuses.join(", ")}`);
      const limitRaw = text("limit");
      return {
        command: {
          command: "issue.list",
          statuses: statuses as ListableIssueStatus[],
          text: text("text"),
          cursor: text("cursor"),
          limit: limitRaw === undefined ? undefined : limit(limitRaw),
        },
        body: null, bodyField: null, requestKey,
      };
    }
    case "issue.show":
      noMore(1);
      return { command: { command: "issue.show", issue: one("an issue key or id") }, body: null, bodyField: null, requestKey };
    case "issue.create": {
      noMore(0);
      const title = text("title");
      if (title === undefined || title.trim() === "") return usage(`"issue create" needs --title`);
      const source = description();
      return {
        command: {
          command: "issue.create",
          title: title.trim(),
          priority: optionalPriority(),
          parent: text("parent"),
          status: flags.get("queue") === true ? "queued" : "backlog",
        },
        body: source, bodyField: source === null ? null : "descriptionBase64", requestKey,
      };
    }
    case "issue.note": {
      const issue = one("an issue key or id");
      return { command: { command: "issue.note", issue }, body: body(1), bodyField: "bodyBase64", requestKey };
    }
    case "issue.status": {
      noMore(2);
      const issue = one("an issue key or id");
      const status = positionals[1]?.toLowerCase();
      if (status === undefined || !isOneOf(agentIssueStatuses, status)) {
        return usage(`"issue status" needs one of ${agentIssueStatuses.join(", ")}`);
      }
      return {
        command: { command: "issue.status", issue, status: status as AgentIssueStatus, reason: text("reason") },
        body: null, bodyField: null, requestKey,
      };
    }
    case "issue.update": {
      noMore(1);
      const issue = one("an issue key or id");
      const source = description();
      const title = text("title")?.trim();
      const newPriority = optionalPriority();
      if (title === undefined && source === null && newPriority === undefined) {
        usage(`"issue update" needs --title, --description, --description-file or --priority`);
      }
      return {
        command: { command: "issue.update", issue, title, priority: newPriority },
        body: source, bodyField: source === null ? null : "descriptionBase64", requestKey,
      };
    }
    case "channel.list":
      noMore(0);
      return { command: { command: "channel.list" }, body: null, bodyField: null, requestKey };
    case "channel.read": {
      noMore(1);
      const limitRaw = text("limit");
      return {
        command: {
          command: "channel.read",
          channel: one("a channel name or id"),
          thread: text("thread"),
          cursor: text("cursor"),
          limit: limitRaw === undefined ? undefined : limit(limitRaw),
        },
        body: null, bodyField: null, requestKey,
      };
    }
    case "channel.post": {
      const channel = one("a channel name or id");
      return {
        command: { command: "channel.post", channel, thread: text("thread") },
        body: body(1), bodyField: "bodyBase64", requestKey,
      };
    }
  }
}

export { workspaceToolsMaxBodyBytes };
