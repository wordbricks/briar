import { describe, expect, it, vi } from "vitest";
import { parseMemoryToolsArgv, runMemoryTools, type MemoryToolsIo } from "./memory-tools";
import { decodeMemoryToolsCommand } from "./memory-tools-protocol";

const io = (overrides: Partial<MemoryToolsIo> = {}) => {
  const output: string[] = [];
  return {
    output,
    json: () => output.map((line) => JSON.parse(line) as Record<string, any>),
    io: {
      readStdin: async () => null,
      readContentFile: async () => { throw new Error("no file"); },
      write: (text: string) => { output.push(text); },
      ...overrides,
    } satisfies MemoryToolsIo,
  };
};

describe("tools memory argv", () => {
  it("parses every subcommand with its flags", () => {
    expect(parseMemoryToolsArgv(["memory", "list", "--type", "fact", "--prefix=knowledge/", "--status", "active", "--cursor", "c1", "--limit", "5"]))
      .toEqual({ kind: "command", command: { command: "list", type: "fact", prefix: "knowledge/", status: "active", cursor: "c1", limit: 5 } });
    expect(parseMemoryToolsArgv(["memory", "read", "README.md", "--revision", "3"]))
      .toEqual({ kind: "command", command: { command: "read", target: "README.md", revision: 3 } });
    expect(parseMemoryToolsArgv(["memory", "search", "relocation", "plan", "--limit", "50"]))
      .toEqual({ kind: "command", command: { command: "search", text: "relocation plan", limit: 50 } });
    expect(parseMemoryToolsArgv(["memory", "journal", "Shipped v2", "--occurred-at", "2026-10-13T09:00:00+09:00", "--references", "a, b,,c", "--user-requested"]))
      .toEqual({ kind: "command", command: { command: "journal", text: "Shipped v2", occurredAt: "2026-10-13T09:00:00+09:00", references: ["a", "b", "c"], userRequested: true } });
    expect(parseMemoryToolsArgv(["memory", "save", "bay-area", "--type", "workstream", "--status", "active", "--aliases", "relocation", "--expected-revision", "4", "--content-file", "body.md"]))
      .toEqual({
        kind: "command",
        command: { command: "save", id: "bay-area", type: "workstream", status: "active", aliases: ["relocation"], expectedRevision: 4, userRequested: false },
        contentFile: "body.md",
      });
    expect(parseMemoryToolsArgv(["memory", "journal", "--", "--not-a-flag"]))
      .toMatchObject({ kind: "command", command: { command: "journal", text: "--not-a-flag" } });
  });

  it("answers help in every spelling", () => {
    for (const argv of [[], ["--help"], ["memory"], ["memory", "--help"], ["memory", "help"], ["memory", "save", "--help"]]) {
      expect(parseMemoryToolsArgv(argv)).toEqual({ kind: "help" });
    }
  });

  it.each([
    [["files", "list"], /use "tools memory", "tools issue" or "tools channel"/u],
    [["memory", "delete", "x"], /unknown command/u],
    [["memory", "list", "extra"], /takes no arguments/u],
    [["memory", "list", "--bogus"], /unknown option --bogus/u],
    [["memory", "list", "--limit", "ten"], /non-negative integer/u],
    [["memory", "list", "--limit", "-1"], /non-negative integer/u],
    [["memory", "list", "--limit"], /needs a value/u],
    [["memory", "list", "--type", "a", "--type", "b"], /more than once/u],
    [["memory", "read"], /exactly one/u],
    [["memory", "read", "a", "b"], /exactly one/u],
    [["memory", "search"], /needs the text/u],
    [["memory", "journal", "  "], /needs the event text/u],
    [["memory", "journal", "x", "--user-requested=yes"], /takes no value/u],
    [["memory", "save", "id"], /needs --type/u],
    [["memory", "save", "--type", "fact"], /exactly one record id/u],
    [["memory", "read", "x", "--revision", "99999999999"], /non-negative integer|too large/u],
  ])("rejects %j as a usage error", (argv, message) => {
    const parsed = parseMemoryToolsArgv(argv);
    expect(parsed.kind).toBe("usage");
    expect(parsed.kind === "usage" && parsed.message).toMatch(message);
  });
});

describe("tools memory process", () => {
  it("prints help as one JSON object and exits 0", async () => {
    const harness = io();
    await expect(runMemoryTools(["memory", "--help"], harness.io)).resolves.toBe(0);
    expect(harness.output).toHaveLength(1);
    expect(harness.json()[0]!.help).toContain("tools memory <command>");
  });

  it("exits 2 with an invalid_request error for usage mistakes", async () => {
    const harness = io();
    await expect(runMemoryTools(["memory", "list", "--nope"], harness.io)).resolves.toBe(2);
    expect(harness.json()[0]).toMatchObject({ error: { code: "invalid_request", retryable: false, usage: true } });
  });

  it("exits 2 when save has no body", async () => {
    const harness = io();
    await expect(runMemoryTools(["memory", "save", "x", "--type", "fact"], harness.io)).resolves.toBe(2);
    expect(harness.json()[0]!.error.code).toBe("invalid_request");
  });

  it("refuses a body over 64 KiB before it reaches the relay", async () => {
    const exchange = vi.fn();
    const harness = io({ readStdin: async () => new Uint8Array(64 * 1024 + 1), exchange });
    await expect(runMemoryTools(["memory", "save", "x", "--type", "fact"], harness.io)).resolves.toBe(1);
    expect(harness.json()[0]!.error.code).toBe("invalid_record");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("is memory_unavailable without a turn config", async () => {
    const exchange = vi.fn();
    const harness = io({ exchange });
    await expect(runMemoryTools(["--config", "/nonexistent/config.json", "memory", "list"], harness.io)).resolves.toBe(1);
    expect(harness.json()[0]).toEqual({
      error: { code: "memory_unavailable", message: "Memory tools are not available outside an active Briar turn", retryable: true },
    });
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe("tools memory wire", () => {
  it("fails closed on frames it does not know", () => {
    expect(() => decodeMemoryToolsCommand({ command: "forget", id: "x" })).toThrow();
    expect(() => decodeMemoryToolsCommand({ command: "read" })).toThrow();
    expect(() => decodeMemoryToolsCommand({ command: "journal", text: "x", references: [], userRequested: "yes" })).toThrow();
    expect(() => decodeMemoryToolsCommand({ command: "list", limit: -1 })).toThrow();
  });
});
