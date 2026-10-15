import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { exchangeDmFileRelay } from "../src-cli/dm-file-relay";
import {
  decodeMemoryToolsConfig,
  decodeMemoryToolsResponseFrame,
  memoryToolsDeadlineMs,
  memoryToolsMaxContentBytes,
  memoryToolsProtocolVersion,
  type AgentToolsCommand,
  type MemoryToolError,
  type MemoryToolsCommand,
  type MemoryToolsConfig,
} from "./memory-tools-protocol";
import {
  parseWorkspaceToolsArgv,
  workspaceToolsHelp,
  WorkspaceUsageError,
  type ParsedWorkspaceCommand,
} from "./workspace-tools";
import { decodeWorkspaceToolsCommand, workspaceToolsMaxBodyBytes } from "./workspace-tools-protocol";

/*
  `tools memory …`, `tools issue …`, `tools channel …`: the agent's command for
  the memory vault and for Briar's issues and channels
  (docs/plans/agent-workspace-tools.md). It runs inside
  the provider's sandbox with no network and no credential of its own. It
  writes one request into the turn's file relay in the workspace and prints
  the Worker CLI's answer as exactly one JSON object on stdout.

  Exit codes: 0 success, 1 tool error, 2 usage error.
*/

export const memoryToolsHelp = `Usage: tools memory <command> [options]

Commands:
  list [--type T] [--prefix P] [--status S] [--cursor C] [--limit N]
      Records, newest update first.
  read <id|path> [--revision N]
      One record: frontmatter fields and body. Latest revision by default.
  search <text> [--type T] [--prefix P] [--cursor C] [--limit N]
      Case-insensitive substring search. Follow next_cursor until it is null.
  journal <text> [--occurred-at ISO8601+offset] [--references id,id] [--user-requested]
      Append one event line to the day's timeline.
  save <id> --type T [--status S] [--aliases a,b] [--expected-revision N] [--user-requested] [--content-file F]
      Create or update a record. The Markdown body comes from --content-file or
      stdin, for example:
        tools memory save my-record --type fact <<'BRIAR_MEMORY'
        body
        BRIAR_MEMORY

Output is one JSON object on stdout. Exit 0 on success, 1 on a tool error
({"error":{"code","message","retryable"}}), 2 on a usage error.`;

/** `tools --help`: every tool family. */
export const toolsHelp = `Usage: tools <memory|issue|channel> <command> [options]

${memoryToolsHelp.replace(/^Usage: tools memory <command> \[options\]\n\n/u, "Memory:\n")}

${workspaceToolsHelp}`;

type Flag = {
  readonly name: string;
  /** A switch takes no value; every other option takes exactly one. */
  readonly switch?: true;
};

const commandFlags = {
  list: [{ name: "type" }, { name: "prefix" }, { name: "status" }, { name: "cursor" }, { name: "limit" }],
  read: [{ name: "revision" }],
  search: [{ name: "type" }, { name: "prefix" }, { name: "cursor" }, { name: "limit" }],
  journal: [{ name: "occurred-at" }, { name: "references" }, { name: "user-requested", switch: true }],
  save: [
    { name: "type" },
    { name: "status" },
    { name: "aliases" },
    { name: "expected-revision" },
    { name: "user-requested", switch: true },
    { name: "content-file" },
  ],
} as const satisfies Readonly<Record<MemoryToolsCommand["command"], readonly Flag[]>>;

export type ParsedMemoryToolsArgv =
  | { readonly kind: "help" }
  | { readonly kind: "usage"; readonly message: string }
  | {
      readonly kind: "command";
      /** `save` carries its body separately; it is read after parsing. */
      readonly command: Exclude<MemoryToolsCommand, { command: "save" }> |
        (Omit<Extract<MemoryToolsCommand, { command: "save" }>, "contentBase64">);
      readonly contentFile?: string;
    };

class UsageError extends Error {}

const usage = (message: string): never => {
  throw new UsageError(message);
};

const count = (flag: string, raw: string) => {
  if (!/^\d{1,10}$/u.test(raw)) usage(`--${flag} must be a non-negative integer`);
  const value = Number(raw);
  if (value > 0xffff_ffff) usage(`--${flag} is too large`);
  return value;
};

const list = (raw: string) => raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);

const isCommand = (value: string): value is MemoryToolsCommand["command"] =>
  Object.hasOwn(commandFlags, value);

/** Parses `memory <command> …` (the arguments after `tools`). */
export function parseMemoryToolsArgv(argv: readonly string[]): ParsedMemoryToolsArgv {
  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
      return { kind: "help" };
    }
    if (argv[0] !== "memory") usage(`unknown tool "${argv[0]}"; use "tools memory", "tools issue" or "tools channel"`);
    const name = argv[1];
    if (name === undefined || name === "--help" || name === "-h" || name === "help") return { kind: "help" };
    if (!isCommand(name)) usage(`unknown command "${name}"`);
    const known: readonly Flag[] = commandFlags[name as MemoryToolsCommand["command"]];
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
      if (argument === "--help") return { kind: "help" };
      const equals = argument.indexOf("=");
      const flagName = argument.slice(2, equals === -1 ? undefined : equals);
      const flag = known.find((candidate) => candidate.name === flagName);
      if (!flag) usage(`unknown option --${flagName} for "${name}"`);
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
    // An absent option stays `undefined`, which the JSON frame then omits.
    const text = (flag: string) => {
      const value = flags.get(flag);
      return typeof value === "string" ? value : undefined;
    };
    const countOf = (flag: string) => {
      const raw = text(flag);
      return raw === undefined ? undefined : count(flag, raw);
    };
    const listOf = (flag: string) => {
      const raw = text(flag);
      return raw === undefined ? [] : list(raw);
    };
    const userRequested = flags.get("user-requested") === true;
    switch (name) {
      case "list":
        if (positionals.length > 0) usage(`"list" takes no arguments`);
        return {
          kind: "command",
          command: {
            command: "list",
            type: text("type"),
            prefix: text("prefix"),
            status: text("status"),
            cursor: text("cursor"),
            limit: countOf("limit"),
          },
        };
      case "read":
        if (positionals.length !== 1) usage(`"read" takes exactly one record id or path`);
        return {
          kind: "command",
          command: { command: "read", target: positionals[0]!, revision: countOf("revision") },
        };
      case "search": {
        const query = positionals.join(" ").trim();
        if (!query) usage(`"search" needs the text to find`);
        return {
          kind: "command",
          command: {
            command: "search",
            text: query,
            type: text("type"),
            prefix: text("prefix"),
            cursor: text("cursor"),
            limit: countOf("limit"),
          },
        };
      }
      case "journal": {
        const line = positionals.join(" ").trim();
        if (!line) usage(`"journal" needs the event text`);
        return {
          kind: "command",
          command: {
            command: "journal",
            text: line,
            occurredAt: text("occurred-at"),
            references: listOf("references"),
            userRequested,
          },
        };
      }
      case "save": {
        if (positionals.length !== 1) usage(`"save" takes exactly one record id`);
        const type = text("type");
        if (type === undefined) return usage(`"save" needs --type`);
        return {
          kind: "command",
          command: {
            command: "save",
            id: positionals[0]!,
            type,
            status: text("status"),
            aliases: listOf("aliases"),
            expectedRevision: countOf("expected-revision"),
            userRequested,
          },
          contentFile: text("content-file"),
        };
      }
    }
    return usage(`unknown command "${name}"`);
  } catch (error) {
    if (error instanceof UsageError) return { kind: "usage", message: error.message };
    throw error;
  }
}

export type MemoryToolsIo = {
  /** Resolves to the bytes piped in, or null when stdin is a terminal. */
  readonly readStdin: () => Promise<Uint8Array | null>;
  readonly readContentFile: (path: string) => Promise<Uint8Array>;
  readonly write: (text: string) => void;
  readonly exchange?: (directory: string, request: Uint8Array) => Promise<Uint8Array>;
};

const toolError = (code: string, message: string, retryable = false): MemoryToolError =>
  ({ code, message, retryable });

const unavailable = (message: string): MemoryToolError =>
  toolError("memory_unavailable", message, true);

async function readConfig(path: string | undefined): Promise<MemoryToolsConfig | null> {
  if (!path || !isAbsolute(path)) return null;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) return null;
    return decodeMemoryToolsConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

/** Runs one invocation and returns its exit code. `argv` excludes the runtime and script. */
export async function runMemoryTools(argv: readonly string[], io: MemoryToolsIo): Promise<number> {
  const emit = (value: unknown) => io.write(`${JSON.stringify(value)}\n`);
  let configPath: string | undefined;
  let rest = [...argv];
  if (rest[0] === "--config") {
    configPath = rest[1];
    rest = rest.slice(2);
  }
  if (rest[0] === "issue" || rest[0] === "channel") return runWorkspaceTools(rest, configPath, io);
  const parsed = parseMemoryToolsArgv(rest);
  if (parsed.kind === "help") {
    emit({ help: rest[0] === "memory" ? memoryToolsHelp : toolsHelp });
    return 0;
  }
  if (parsed.kind === "usage") {
    emit({ error: { ...toolError("invalid_request", `${parsed.message}. Run \`tools memory --help\`.`), usage: true } });
    return 2;
  }
  let command: MemoryToolsCommand;
  if (parsed.command.command === "save") {
    let content: Uint8Array | null;
    try {
      content = parsed.contentFile === undefined || parsed.contentFile === "-"
        ? await io.readStdin()
        : await io.readContentFile(parsed.contentFile);
    } catch {
      emit({ error: toolError("invalid_request", "--content-file could not be read") });
      return 2;
    }
    if (content === null || content.byteLength === 0) {
      emit({ error: { ...toolError("invalid_request", "save needs the Markdown body on stdin or in --content-file. Run `tools memory --help`."), usage: true } });
      return 2;
    }
    if (content.byteLength > memoryToolsMaxContentBytes) {
      emit({ error: toolError("invalid_record", "The body exceeds 64 KiB; split it into smaller records") });
      return 1;
    }
    command = { ...parsed.command, contentBase64: Buffer.from(content).toString("base64") };
  } else {
    command = parsed.command;
  }
  const config = await readConfig(configPath);
  if (!config) {
    emit({ error: unavailable("Memory tools are not available outside an active Briar turn") });
    return 1;
  }
  const response = await relay(command, config, io, {
    unavailable,
    timeout: "Memory did not answer in time; the operation may or may not have been applied. Read before retrying a write.",
    unreachable: "Memory is unreachable from this turn",
    unreadable: "Memory returned an unreadable answer",
  });
  if (!response.ok) {
    emit({ error: response.error });
    return 1;
  }
  emit(response.bodyBase64 === undefined
    ? response.result
    : { ...response.result, body: Buffer.from(response.bodyBase64, "base64").toString("utf8") });
  return 0;
}

const workspaceUnavailable = (message: string): MemoryToolError => toolError("unavailable", message, true);

/** Relays one frame and prints the answer; shared by every tool family. */
async function relay(
  command: AgentToolsCommand,
  config: MemoryToolsConfig,
  io: MemoryToolsIo,
  messages: {
    readonly unavailable: (message: string) => MemoryToolError;
    readonly timeout: string;
    readonly unreachable: string;
    readonly unreadable: string;
  },
): Promise<{ ok: true; result: Readonly<Record<string, unknown>>; bodyBase64?: string } | { ok: false; error: MemoryToolError }> {
  const frame = Buffer.from(JSON.stringify({
    version: memoryToolsProtocolVersion,
    invocationId: config.invocationId,
    capability: config.capability,
    command,
  }), "utf8");
  let responseBytes: Uint8Array;
  try {
    responseBytes = await (io.exchange ?? ((directory, request) =>
      exchangeDmFileRelay(directory, request, { deadlineMs: memoryToolsDeadlineMs })))(config.relayDirectory, frame);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error: reason === "dm_file_relay_payload_invalid"
        ? toolError("invalid_request", "The request is too large")
        : messages.unavailable(reason.includes("timeout") ? messages.timeout : messages.unreachable),
    };
  }
  try {
    return decodeMemoryToolsResponseFrame(responseBytes);
  } catch {
    return { ok: false, error: messages.unavailable(messages.unreadable) };
  }
}

async function readBody(parsed: ParsedWorkspaceCommand, io: MemoryToolsIo): Promise<Uint8Array | null> {
  const source = parsed.body;
  if (source === null) return null;
  if (source.kind === "text") return Buffer.from(source.text, "utf8");
  return source.kind === "stdin" ? io.readStdin() : io.readContentFile(source.path);
}

/** `tools issue …` / `tools channel …`. */
async function runWorkspaceTools(argv: readonly string[], configPath: string | undefined, io: MemoryToolsIo) {
  const emit = (value: unknown) => io.write(`${JSON.stringify(value)}\n`);
  let parsed: ParsedWorkspaceCommand | null;
  try {
    parsed = parseWorkspaceToolsArgv(argv);
  } catch (error) {
    if (!(error instanceof WorkspaceUsageError)) throw error;
    emit({ error: { ...toolError("invalid_request", `${error.message}. Run \`tools ${argv[0]} --help\`.`), usage: true } });
    return 2;
  }
  if (parsed === null) {
    emit({ help: workspaceToolsHelp });
    return 0;
  }
  let body: Uint8Array | null;
  try {
    body = await readBody(parsed, io);
  } catch {
    emit({ error: toolError("invalid_request", "The body file could not be read") });
    return 2;
  }
  if (parsed.bodyField !== null && (body === null || Buffer.from(body).toString("utf8").trim() === "")) {
    emit({ error: { ...toolError("invalid_request", `"${argv[0]} ${argv[1]}" needs text: an argument, --body-file F, or stdin. Run \`tools ${argv[0]} --help\`.`), usage: true } });
    return 2;
  }
  if (body !== null && body.byteLength > workspaceToolsMaxBodyBytes) {
    emit({ error: toolError("invalid_request", "The text exceeds 48 KiB; shorten it or split it") });
    return 1;
  }
  const isWrite = ["issue.create", "issue.note", "issue.status", "issue.update", "channel.post"]
    .includes(parsed.command.command);
  let command: AgentToolsCommand;
  try {
    // Validated here as well, so a malformed value is a usage error before any relay.
    command = decodeWorkspaceToolsCommand({
      ...parsed.command,
      ...(isWrite ? { requestKey: parsed.requestKey ?? randomUUID() } : {}),
      ...(parsed.bodyField !== null && body !== null
        ? { [parsed.bodyField]: Buffer.from(body).toString("base64") }
        : {}),
    });
  } catch {
    emit({ error: { ...toolError("invalid_request", `Invalid arguments. Run \`tools ${argv[0]} --help\`.`), usage: true } });
    return 2;
  }
  const config = await readConfig(configPath);
  if (!config) {
    emit({ error: workspaceUnavailable("Briar tools are not available outside an active Briar turn") });
    return 1;
  }
  const response = await relay(command, config, io, {
    unavailable: workspaceUnavailable,
    timeout: "Briar did not answer in time; the write may or may not have been applied. Retry it with the same --request-key, or read before writing again.",
    unreachable: "Briar is unreachable from this turn",
    unreadable: "Briar returned an unreadable answer",
  });
  if (!response.ok) {
    emit({ error: response.error });
    return 1;
  }
  emit(response.result);
  return 0;
}

async function readStdin(): Promise<Uint8Array | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    bytes += buffer.byteLength;
    // One byte over the limit is enough to report it; never buffer unbounded input.
    if (bytes > memoryToolsMaxContentBytes + 1) break;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readContentFile(path: string): Promise<Uint8Array> {
  const handle = await open(resolve(path), constants.O_RDONLY);
  try {
    const buffer = Buffer.alloc(memoryToolsMaxContentBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

if (import.meta.main) {
  void runMemoryTools(process.argv.slice(2), {
    readStdin,
    readContentFile,
    write: (text) => process.stdout.write(text),
  }).then(
    (code) => { process.exitCode = code; },
    () => {
      process.stdout.write(`${JSON.stringify({ error: unavailable("Memory tools failed unexpectedly") })}\n`);
      process.exitCode = 1;
    },
  );
}
