import { isAbsolute } from "node:path";
import {
  decodeWorkspaceToolsCommand,
  isWorkspaceToolsCommandName,
  type WorkspaceToolsCommand,
} from "./workspace-tools-protocol";

/*
  The local wire between `tools memory …` (running inside the provider's
  sandbox) and the Worker CLI process that holds the claim. Frames are UTF-8
  JSON. Memory bodies travel base64-encoded so a 64 KiB body full of
  characters JSON has to escape still fits the file relay's frame limit.

  Nothing here is ever an authority over the vault: the frame only names an
  operation. The Worker CLI adds the claim identity and its own credential,
  and the server derives the vault from that claim.
*/

export const memoryToolsProtocolVersion = 1;

/** End-to-end budget of one `tools memory …` call, relay included. */
export const memoryToolsDeadlineMs = 120_000;

/** Largest Markdown body `save` accepts; the server enforces the same limit. */
export const memoryToolsMaxContentBytes = 64 * 1024;

export type MemoryToolsCommand =
  | {
      readonly command: "list";
      readonly type?: string;
      readonly prefix?: string;
      readonly status?: string;
      readonly cursor?: string;
      readonly limit?: number;
    }
  | {
      readonly command: "read";
      readonly target: string;
      readonly revision?: number;
    }
  | {
      readonly command: "search";
      readonly text: string;
      readonly type?: string;
      readonly prefix?: string;
      readonly cursor?: string;
      readonly limit?: number;
    }
  | {
      readonly command: "journal";
      readonly text: string;
      readonly occurredAt?: string;
      readonly references: readonly string[];
      readonly userRequested: boolean;
    }
  | {
      readonly command: "save";
      readonly id: string;
      readonly type: string;
      readonly status?: string;
      readonly aliases: readonly string[];
      readonly expectedRevision?: number;
      readonly userRequested: boolean;
      readonly contentBase64: string;
    };

/** Every command the `tools` launcher relays: memory, issue and channel. */
export type AgentToolsCommand = MemoryToolsCommand | WorkspaceToolsCommand;

export type MemoryToolsRequestFrame = {
  readonly version: 1;
  readonly invocationId: string;
  readonly capability: string;
  readonly command: AgentToolsCommand;
};

export type MemoryToolError = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  /** `revision_conflict` and `expected_revision_required` only. */
  readonly current_revision?: number;
};

export type MemoryToolsResponseFrame =
  | {
      readonly ok: true;
      readonly result: Readonly<Record<string, unknown>>;
      /** `read` only: the body, which the tool puts back as `result.body`. */
      readonly bodyBase64?: string;
    }
  | { readonly ok: false; readonly error: MemoryToolError };

/** Written by the Worker CLI for the duration of one provider turn. */
export type MemoryToolsConfig = {
  readonly version: 1;
  readonly invocationId: string;
  readonly capability: string;
  readonly relayDirectory: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const optionalString = (value: unknown, maximum: number): value is string | undefined =>
  value === undefined || (typeof value === "string" && value.length <= maximum);

const optionalCount = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff);

const stringList = (value: unknown, maximumItems: number): value is string[] =>
  Array.isArray(value) && value.length <= maximumItems &&
  value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 200);

const invalid = (): never => {
  throw new Error("memory_tools_request_invalid");
};

/** Validates a frame field by field; anything else fails closed. */
export function decodeMemoryToolsCommand(value: unknown): MemoryToolsCommand {
  if (!isRecord(value) || typeof value.command !== "string") return invalid();
  switch (value.command) {
    case "list":
      if (!optionalString(value.type, 100) || !optionalString(value.prefix, 500) ||
          !optionalString(value.status, 100) || !optionalString(value.cursor, 4_000) ||
          !optionalCount(value.limit)) return invalid();
      return {
        command: "list",
        ...(value.type === undefined ? {} : { type: value.type }),
        ...(value.prefix === undefined ? {} : { prefix: value.prefix }),
        ...(value.status === undefined ? {} : { status: value.status }),
        ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
        ...(value.limit === undefined ? {} : { limit: value.limit }),
      };
    case "read":
      if (typeof value.target !== "string" || value.target.length < 1 || value.target.length > 500 ||
          !optionalCount(value.revision)) return invalid();
      return {
        command: "read",
        target: value.target,
        ...(value.revision === undefined ? {} : { revision: value.revision }),
      };
    case "search":
      if (typeof value.text !== "string" || value.text.length < 1 || value.text.length > 1_000 ||
          !optionalString(value.type, 100) || !optionalString(value.prefix, 500) ||
          !optionalString(value.cursor, 4_000) || !optionalCount(value.limit)) return invalid();
      return {
        command: "search",
        text: value.text,
        ...(value.type === undefined ? {} : { type: value.type }),
        ...(value.prefix === undefined ? {} : { prefix: value.prefix }),
        ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
        ...(value.limit === undefined ? {} : { limit: value.limit }),
      };
    case "journal":
      if (typeof value.text !== "string" || value.text.length < 1 || value.text.length > 4_000 ||
          !optionalString(value.occurredAt, 100) || !stringList(value.references, 50) ||
          typeof value.userRequested !== "boolean") return invalid();
      return {
        command: "journal",
        text: value.text,
        ...(value.occurredAt === undefined ? {} : { occurredAt: value.occurredAt }),
        references: [...value.references],
        userRequested: value.userRequested,
      };
    case "save":
      if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 200 ||
          typeof value.type !== "string" || value.type.length < 1 || value.type.length > 100 ||
          !optionalString(value.status, 100) || !stringList(value.aliases, 50) ||
          !optionalCount(value.expectedRevision) || typeof value.userRequested !== "boolean" ||
          typeof value.contentBase64 !== "string") return invalid();
      return {
        command: "save",
        id: value.id,
        type: value.type,
        ...(value.status === undefined ? {} : { status: value.status }),
        aliases: [...value.aliases],
        ...(value.expectedRevision === undefined ? {} : { expectedRevision: value.expectedRevision }),
        userRequested: value.userRequested,
        contentBase64: value.contentBase64,
      };
    default:
      return invalid();
  }
}

export function decodeMemoryToolsRequestFrame(bytes: Uint8Array): MemoryToolsRequestFrame {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return invalid(); }
  if (!isRecord(value) || value.version !== memoryToolsProtocolVersion ||
      typeof value.invocationId !== "string" || typeof value.capability !== "string") {
    return invalid();
  }
  return {
    version: 1,
    invocationId: value.invocationId,
    capability: value.capability,
    command: isRecord(value.command) && isWorkspaceToolsCommandName(value.command.command)
      ? decodeWorkspaceToolsCommand(value.command)
      : decodeMemoryToolsCommand(value.command),
  };
}

export function decodeMemoryToolsResponseFrame(bytes: Uint8Array): MemoryToolsResponseFrame {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (isRecord(value) && value.ok === true && isRecord(value.result) &&
      (value.bodyBase64 === undefined || typeof value.bodyBase64 === "string")) {
    return {
      ok: true,
      result: value.result,
      ...(value.bodyBase64 === undefined ? {} : { bodyBase64: value.bodyBase64 }),
    };
  }
  if (isRecord(value) && value.ok === false && isRecord(value.error) &&
      typeof value.error.code === "string" && typeof value.error.message === "string" &&
      typeof value.error.retryable === "boolean") {
    return {
      ok: false,
      error: {
        code: value.error.code,
        message: value.error.message,
        retryable: value.error.retryable,
        ...(typeof value.error.current_revision === "number"
          ? { current_revision: value.error.current_revision }
          : {}),
      },
    };
  }
  throw new Error("memory_tools_response_invalid");
}

export function decodeMemoryToolsConfig(value: unknown): MemoryToolsConfig {
  if (!isRecord(value) || value.version !== memoryToolsProtocolVersion ||
      typeof value.invocationId !== "string" || value.invocationId.length < 1 ||
      typeof value.capability !== "string" || !/^[A-Za-z0-9_-]{22,128}$/u.test(value.capability) ||
      typeof value.relayDirectory !== "string" || !isAbsolute(value.relayDirectory)) {
    throw new Error("memory_tools_config_invalid");
  }
  return {
    version: 1,
    invocationId: value.invocationId,
    capability: value.capability,
    relayDirectory: value.relayDirectory,
  };
}
