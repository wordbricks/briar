import { describe, expect, it, vi } from "vitest";
import { runMemoryTools, type MemoryToolsIo } from "./memory-tools";
import { decodeMemoryToolsRequestFrame } from "./memory-tools-protocol";
import { parseWorkspaceToolsArgv, WorkspaceUsageError } from "./workspace-tools";
import { decodeWorkspaceToolsCommand } from "./workspace-tools-protocol";

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

const usageMessage = (argv: string[]) => {
  try {
    parseWorkspaceToolsArgv(argv);
  } catch (error) {
    if (error instanceof WorkspaceUsageError) return error.message;
    throw error;
  }
  return null;
};

describe("tools issue / tools channel argv", () => {
  it("parses every command with its flags", () => {
    expect(parseWorkspaceToolsArgv(["issue", "list", "--status", "Backlog, blocked", "--text=flaky", "--limit", "5"]))
      .toMatchObject({ command: { command: "issue.list", statuses: ["backlog", "blocked"], text: "flaky", limit: 5 }, body: null });
    expect(parseWorkspaceToolsArgv(["issue", "show", "AH-12"]))
      .toMatchObject({ command: { command: "issue.show", issue: "AH-12" } });
    expect(parseWorkspaceToolsArgv(["issue", "create", "--title", " Fix it ", "--description", "Why", "--priority", "urgent",
      "--parent", "AH-1", "--queue", "--request-key", "k-1"]))
      .toEqual({
        command: { command: "issue.create", title: "Fix it", priority: 1, parent: "AH-1", status: "queued" },
        body: { kind: "text", text: "Why" }, bodyField: "descriptionBase64", requestKey: "k-1",
      });
    expect(parseWorkspaceToolsArgv(["issue", "create", "--title", "T"]))
      .toMatchObject({ command: { status: "backlog" }, body: null, bodyField: null, requestKey: null });
    expect(parseWorkspaceToolsArgv(["issue", "note", "AH-3", "Root", "cause"]))
      .toMatchObject({ command: { command: "issue.note", issue: "AH-3" }, body: { kind: "text", text: "Root cause" } });
    expect(parseWorkspaceToolsArgv(["issue", "note", "AH-3"])).toMatchObject({ body: { kind: "stdin" } });
    expect(parseWorkspaceToolsArgv(["issue", "note", "AH-3", "--body-file", "notes.md"]))
      .toMatchObject({ body: { kind: "file", path: "notes.md" } });
    expect(parseWorkspaceToolsArgv(["issue", "status", "AH-3", "Blocked", "--reason", "Waiting on API keys"]))
      .toMatchObject({ command: { command: "issue.status", issue: "AH-3", status: "blocked", reason: "Waiting on API keys" } });
    expect(parseWorkspaceToolsArgv(["issue", "update", "AH-3", "--priority", "4"]))
      .toMatchObject({ command: { command: "issue.update", issue: "AH-3", priority: 4 }, body: null });
    expect(parseWorkspaceToolsArgv(["channel", "list"])).toMatchObject({ command: { command: "channel.list" } });
    expect(parseWorkspaceToolsArgv(["channel", "read", "#eng", "--thread", "m1", "--limit", "10"]))
      .toMatchObject({ command: { command: "channel.read", channel: "#eng", thread: "m1", limit: 10 } });
    expect(parseWorkspaceToolsArgv(["channel", "post", "eng", "--thread", "m1", "--", "--literal"]))
      .toMatchObject({ command: { command: "channel.post", channel: "eng", thread: "m1" }, body: { kind: "text", text: "--literal" } });
  });

  it("answers help", () => {
    for (const argv of [["issue"], ["issue", "--help"], ["channel", "help"], ["issue", "create", "--help"]]) {
      expect(parseWorkspaceToolsArgv(argv)).toBeNull();
    }
  });

  it.each([
    [["issue", "delete", "AH-1"], /unknown command/u],
    [["issue", "list", "--status", "paused"], /unknown status/u],
    [["issue", "list", "extra"], /takes no arguments/u],
    [["issue", "create"], /needs --title/u],
    [["issue", "create", "--title", "T", "--priority", "9"], /--priority/u],
    [["issue", "create", "--title", "T", "--description", "a", "--description-file", "b"], /not both/u],
    [["issue", "status", "AH-1", "running"], /needs one of backlog, queued, blocked, completed, cancelled/u],
    [["issue", "status", "AH-1"], /needs one of/u],
    [["issue", "update", "AH-1"], /needs --title/u],
    [["issue", "note", "AH-1", "text", "--body-file", "f"], /not both/u],
    [["issue", "note", "AH-1", "--request-key", "has space"], /--request-key/u],
    [["channel", "read"], /needs a channel/u],
    [["channel", "read", "eng", "--limit", "0"], /--limit/u],
    [["channel", "post", "eng", "--queue"], /unknown option --queue/u],
  ])("rejects %j as a usage error", (argv, message) => {
    expect(usageMessage(argv)).toMatch(message);
  });
});

describe("tools issue / tools channel process", () => {
  it("prints help as one JSON object, and the top-level help lists every family", async () => {
    const issue = io();
    await expect(runMemoryTools(["issue", "--help"], issue.io)).resolves.toBe(0);
    expect(issue.json()[0]!.help).toContain("issue create --title T");
    const top = io();
    await expect(runMemoryTools(["--help"], top.io)).resolves.toBe(0);
    expect(top.json()[0]!.help).toMatch(/Usage: tools <memory\|issue\|channel>/u);
    expect(top.json()[0]!.help).toContain("channel post <channel>");
    expect(top.json()[0]!.help).toContain("save <id> --type T");
  });

  it("exits 2 for usage mistakes and for a write without text", async () => {
    const exchange = vi.fn();
    const bad = io({ exchange });
    await expect(runMemoryTools(["issue", "status", "AH-1", "running"], bad.io)).resolves.toBe(2);
    expect(bad.json()[0]).toMatchObject({ error: { code: "invalid_request", usage: true } });
    const empty = io({ exchange, readStdin: async () => Buffer.from("  \n") });
    await expect(runMemoryTools(["channel", "post", "eng"], empty.io)).resolves.toBe(2);
    expect(empty.json()[0]!.error.message).toMatch(/needs text/u);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("refuses text over 48 KiB before it reaches the relay", async () => {
    const exchange = vi.fn();
    const harness = io({ exchange, readStdin: async () => new Uint8Array(48 * 1024 + 1).fill(97) });
    await expect(runMemoryTools(["issue", "note", "AH-1"], harness.io)).resolves.toBe(1);
    expect(harness.json()[0]!.error.code).toBe("invalid_request");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("is unavailable without a turn config", async () => {
    const exchange = vi.fn();
    const harness = io({ exchange });
    await expect(runMemoryTools(["--config", "/nonexistent/config.json", "channel", "list"], harness.io)).resolves.toBe(1);
    expect(harness.json()[0]).toEqual({
      error: { code: "unavailable", message: "Briar tools are not available outside an active Briar turn", retryable: true },
    });
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe("tools issue / tools channel wire", () => {
  it("decodes workspace frames through the shared envelope and fails closed otherwise", () => {
    const frame = (command: unknown) => Buffer.from(JSON.stringify({ version: 1, invocationId: "i", capability: "c", command }));
    expect(decodeMemoryToolsRequestFrame(frame({ command: "channel.list" })).command).toEqual({ command: "channel.list" });
    expect(decodeMemoryToolsRequestFrame(frame({ command: "list" })).command).toEqual({ command: "list" });
    expect(() => decodeMemoryToolsRequestFrame(frame({ command: "issue.delete", issue: "x" }))).toThrow();
    expect(() => decodeWorkspaceToolsCommand({ command: "issue.status", requestKey: "k", issue: "x", status: "running" })).toThrow();
    expect(() => decodeWorkspaceToolsCommand({ command: "issue.note", requestKey: "k", issue: "x", bodyBase64: "!!!!" })).toThrow();
    expect(() => decodeWorkspaceToolsCommand({ command: "issue.note", issue: "x", bodyBase64: "aGk=" })).toThrow();
    expect(() => decodeWorkspaceToolsCommand({ command: "issue.update", requestKey: "k", issue: "x" })).toThrow();
    expect(() => decodeWorkspaceToolsCommand({ command: "channel.read", channel: "c", limit: 500 })).toThrow();
    expect(decodeWorkspaceToolsCommand({ command: "issue.list", statuses: ["queued", "queued"] }))
      .toEqual({ command: "issue.list", statuses: ["queued"] });
  });
});
