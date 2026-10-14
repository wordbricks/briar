import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ApplicationErrorDetailSchema,
  RevisionConflictDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import {
  GetMemoryVaultContextResponseSchema,
  MemoryVaultJournalResponseSchema,
  MemoryVaultListResponseSchema,
  MemoryVaultReadResponseSchema,
  MemoryVaultSaveResponseSchema,
  MemoryVaultSearchResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMemoryTools, type MemoryToolsIo } from "../src-agent/memory-tools";
import { detachedProviderRequest, type DetachedAgent } from "./agent-runner";
import type { DetachedProviderTurnInput } from "./detached-provider-turn";
import {
  MemoryVaultInvocation,
  memoryVaultInstructions,
  runWithMemoryVault,
  type MemoryVaultInvocationInput,
  type MemoryVaultQueue,
} from "./memory-vault-invocation";
import type { ClaimedChannelReply, ClaimedRun } from "./worker-queue-contract";

const readmePath = fileURLToPath(new URL("../worker/src/memory-vault/memory-vault-readme.md", import.meta.url));
const claimToken = `briar_channel_claim_${"s".repeat(64)}`;
const workerToken = "briar_worker_secret_token_value";
const workId = "44444444-4444-4444-8444-444444444444";

const channelWork = {
  workType: "channelReply",
  workId,
  runId: "55555555-5555-4555-8555-555555555555",
  claimToken,
  workspaceId: "22222222-2222-4222-8222-222222222222",
} as unknown as ClaimedChannelReply;

const issueWork = {
  workType: "issue",
  workId,
  runId: "55555555-5555-4555-8555-555555555555",
  claimToken,
} as unknown as ClaimedRun;

const agent = {
  id: "agent-1",
  name: "Memory Agent",
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Answer people.",
  skills: [],
} as unknown as DetachedAgent;

const directories: string[] = [];
const invocations: MemoryVaultInvocation[] = [];

afterEach(async () => {
  await Promise.all(invocations.splice(0).map((invocation) => invocation.cleanup()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporary(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

type ContextValue = {
  contextKey?: string;
  readme?: string;
  status?: string;
  voice?: string;
  voiceGuide?: string;
  playbook?: string;
  readable?: boolean;
};

const contextResponse = (readme: string, value: ContextValue = {}) =>
  create(GetMemoryVaultContextResponseSchema, {
    state: {
      case: "context",
      value: {
        contextKey: value.contextKey ?? "key-1",
        scopeKind: "dm",
        readme: value.readme ?? readme,
        status: value.status ?? "Memory status: recall on; automatic writing on.",
        voice: value.voice ?? "- Writes short sentences (3회/times, 2026-10-12)",
        voiceGuide: value.voiceGuide ?? "- Answer in Korean (user, 2026-10-10)",
        playbook: value.playbook ?? "- When asked for dates → use ISO 8601 (2회/times, 2026-10-11) [[iso-dates]]",
        readable: value.readable ?? true,
        writable: true,
        userRequestedWritable: true,
      },
    },
  });

function fakeQueue(readme: string, overrides: Partial<Record<keyof MemoryVaultQueue, unknown>> = {}) {
  const queue = {
    getMemoryVaultContext: vi.fn(async () => contextResponse(readme)),
    memoryVaultList: vi.fn(async () => create(MemoryVaultListResponseSchema, {
      records: [{ id: "readme", type: "readme", path: "README.md", aliases: [], revision: 1, protectedByUser: false }],
      nextCursor: "cursor-2",
    })),
    memoryVaultRead: vi.fn(async () => create(MemoryVaultReadResponseSchema, {
      record: { id: "bay-area", type: "workstream", path: "workstreams/bay-area.md", status: "active", aliases: ["relocation"], revision: 4, updatedAt: "2026-10-13T14:02:11Z", protectedByUser: false },
      createdAt: "2026-10-13T12:40:50Z",
      body: "# Bay Area\n\n\"quoted\" \\ back\tslash — 한국어 ✓\n",
      latest: true,
      commit: "abc123",
    })),
    memoryVaultSearch: vi.fn(async () => create(MemoryVaultSearchResponseSchema, {
      hits: [{ id: "bay-area", type: "workstream", path: "workstreams/bay-area.md", revision: 4, line: 9, snippet: "relocation plan" }],
      commit: "abc123",
    })),
    memoryVaultJournal: vi.fn(async () => create(MemoryVaultJournalResponseSchema, {
      id: "2026-10-13", path: "timeline/daily/2026-10-13.md", line: "- 09:00 | Shipped", revision: 2, commit: "def456", deduplicated: false, replayed: false,
    })),
    memoryVaultSave: vi.fn(async () => create(MemoryVaultSaveResponseSchema, {
      id: "playbook", type: "playbook", path: "playbook.md", revision: 5, commit: "fed789", droppedLines: ["- old line (1회/times, 2026-01-01) [[old]]"], replayed: false,
    })),
    ...overrides,
  };
  return queue as typeof queue & MemoryVaultQueue;
}

async function open(input: Partial<MemoryVaultInvocationInput> & { queue: MemoryVaultQueue }) {
  const invocation = await MemoryVaultInvocation.create({
    projectId: "11111111-1111-4111-8111-111111111111",
    workerId: "worker-1",
    work: channelWork,
    personFacing: true,
    launcher: { runtimePath: "/usr/bin/env", scriptPath: "/opt/briar/agent/memory-tools.js" },
    retryDelaysMs: [1, 1],
    log: () => undefined,
    ...input,
  });
  invocations.push(invocation);
  return invocation;
}

/** Runs `tools memory …` in process against the real file relay. */
async function tools(invocation: MemoryVaultInvocation, argv: string[], stdin: string | null = null) {
  const output: string[] = [];
  const io: MemoryToolsIo = {
    readStdin: async () => stdin === null ? null : Buffer.from(stdin, "utf8"),
    readContentFile: (path) => readFile(path),
    write: (text) => { output.push(text); },
  };
  const exitCode = await runMemoryTools(["--config", join(invocation.binDirectory, "config.json"), ...argv], io);
  expect(output).toHaveLength(1);
  return { exitCode, json: JSON.parse(output[0]!) as Record<string, any>, raw: output[0]! };
}

const turnInput = (workspacePath: string, overrides: Partial<DetachedProviderTurnInput> = {}): DetachedProviderTurnInput => ({
  agent,
  prompt: "Reply to the person.",
  workspacePath,
  fullAccess: false,
  environment: { PATH: "/usr/bin:/bin", BRIAR_WORKER_TOKEN: workerToken },
  signal: new AbortController().signal,
  ...overrides,
});

describe("memory vault relay, end to end in process", () => {
  it("serves every subcommand from the provider's workspace with the claim only on the Worker side", async () => {
    const readme = await readFile(readmePath, "utf8");
    const queue = fakeQueue(readme);
    const invocation = await open({ queue });
    const workspace = await temporary("memory-vault-workspace-");
    const turn = await invocation.prepareTurn(workspace);
    expect(turn).not.toBeNull();

    const list = await tools(invocation, ["memory", "list", "--type", "readme", "--limit", "5"]);
    expect(list).toMatchObject({ exitCode: 0, json: { records: [{ id: "readme", path: "README.md", status: null, updated_at: null }], next_cursor: "cursor-2" } });
    expect(queue.memoryVaultList).toHaveBeenCalledWith(expect.objectContaining({
      type: "readme",
      limit: 5,
      claim: expect.objectContaining({
        projectId: "11111111-1111-4111-8111-111111111111",
        workerId: "worker-1",
        work: expect.objectContaining({ workId, claimToken }),
      }),
    }), expect.anything());

    const read = await tools(invocation, ["memory", "read", "bay-area", "--revision", "4"]);
    expect(read.exitCode).toBe(0);
    expect(read.json).toMatchObject({ id: "bay-area", revision: 4, status: "active", aliases: ["relocation"], latest: true, commit: "abc123", created_at: "2026-10-13T12:40:50Z" });
    expect(read.json.body).toBe("# Bay Area\n\n\"quoted\" \\ back\tslash — 한국어 ✓\n");
    expect(queue.memoryVaultRead).toHaveBeenCalledWith(expect.objectContaining({ target: "bay-area", revision: 4 }), expect.anything());

    const search = await tools(invocation, ["memory", "search", "relocation"]);
    expect(search).toMatchObject({ exitCode: 0, json: { hits: [{ id: "bay-area", line: 9, snippet: "relocation plan" }], next_cursor: null, commit: "abc123" } });

    const journal = await tools(invocation, ["memory", "journal", "Shipped", "--references", "bay-area", "--user-requested"]);
    expect(journal).toMatchObject({ exitCode: 0, json: { id: "2026-10-13", line: "- 09:00 | Shipped", deduplicated: false } });
    const journalRequest = vi.mocked(queue.memoryVaultJournal).mock.calls[0]![0] as Record<string, any>;
    expect(journalRequest).toMatchObject({ text: "Shipped", references: ["bay-area"], userRequested: true });
    expect(journalRequest.requestId).toMatch(/^[0-9a-f-]{36}$/u);

    const body = "- When asked for dates → use ISO 8601 (3회/times, 2026-10-13) [[iso-dates]]\n";
    const save = await tools(invocation, ["memory", "save", "playbook", "--type", "playbook", "--expected-revision", "4"], body);
    expect(save).toMatchObject({ exitCode: 0, json: { id: "playbook", revision: 5, dropped_lines: ["- old line (1회/times, 2026-01-01) [[old]]"], replayed: false } });
    expect(queue.memoryVaultSave).toHaveBeenCalledWith(expect.objectContaining({
      id: "playbook", type: "playbook", expectedRevision: 4, userRequested: false, content: body,
    }), expect.anything());

    // Nothing the provider can read or is shown carries a credential.
    for (const output of [list.raw, read.raw, search.raw, journal.raw, save.raw]) {
      expect(output).not.toContain(claimToken);
    }
    const binFiles = await readdir(invocation.binDirectory);
    expect(binFiles.sort()).toEqual(["config.json", "tools"]);
    for (const name of binFiles) {
      const content = await readFile(join(invocation.binDirectory, name), "utf8");
      expect(content).not.toContain(claimToken);
      expect(content).not.toContain(workerToken);
    }
    expect((await stat(invocation.binDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(invocation.binDirectory, "config.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(invocation.environment({ PATH: "/usr/bin" }))).not.toContain(claimToken);
    // Request files are transient: only the relay's own .gitignore remains.
    expect(await readdir(turn!.relayDirectory)).toEqual([".gitignore"]);
    await turn!.cleanup();
  });

  it("reuses the request id on its own transport retries and never retries a domain error", async () => {
    const readme = await readFile(readmePath, "utf8");
    let saves = 0;
    const queue = fakeQueue(readme, {
      memoryVaultSave: vi.fn(async () => {
        saves += 1;
        if (saves === 1) throw new ConnectError("socket hang up", Code.Unavailable);
        return create(MemoryVaultSaveResponseSchema, { id: "fact-1", type: "fact", path: "knowledge/facts/fact-1.md", revision: 1, commit: "c1", replayed: true });
      }),
      memoryVaultJournal: vi.fn(async () => {
        throw new ConnectError("Record changed", Code.Aborted, undefined, [
          { desc: ApplicationErrorDetailSchema, value: { code: "revision_conflict" } },
          { desc: RevisionConflictDetailSchema, value: { resourceId: "x", actualRevision: 7n } },
        ]);
      }),
      memoryVaultRead: vi.fn(async () => {
        throw new ConnectError("Busy", Code.Unavailable, undefined, [
          { desc: ApplicationErrorDetailSchema, value: { code: "busy" } },
        ]);
      }),
    });
    const invocation = await open({ queue });
    const turn = await invocation.prepareTurn(await temporary("memory-vault-workspace-"));

    const save = await tools(invocation, ["memory", "save", "fact-1", "--type", "fact"], "A fact.\n");
    expect(save.exitCode).toBe(0);
    expect(queue.memoryVaultSave).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(queue.memoryVaultSave).mock.calls
      .map((call) => (call as unknown[])[0] as { requestId: string });
    expect(second!.requestId).toBe(first!.requestId);

    const conflict = await tools(invocation, ["memory", "journal", "x"]);
    expect(conflict).toMatchObject({
      exitCode: 1,
      json: { error: { code: "revision_conflict", message: "Record changed", retryable: false, current_revision: 7 } },
    });
    expect(queue.memoryVaultJournal).toHaveBeenCalledTimes(1);

    const busy = await tools(invocation, ["memory", "read", "x"]);
    expect(busy).toMatchObject({ exitCode: 1, json: { error: { code: "busy", retryable: true } } });
    expect(queue.memoryVaultRead).toHaveBeenCalledTimes(1);
    await turn!.cleanup();
  });

  it("fails clearly once the turn or the run is over", async () => {
    const readme = await readFile(readmePath, "utf8");
    const invocation = await open({ queue: fakeQueue(readme) });
    const turn = await invocation.prepareTurn(await temporary("memory-vault-workspace-"));
    await turn!.cleanup();
    await expect(stat(turn!.relayDirectory)).rejects.toThrow();
    const afterTurn = await tools(invocation, ["memory", "list"]);
    expect(afterTurn).toMatchObject({ exitCode: 1, json: { error: { code: "memory_unavailable" } } });

    const { binDirectory } = invocation;
    await invocation.cleanup();
    await expect(stat(binDirectory)).rejects.toThrow();
    const afterRun = await tools(invocation, ["memory", "list"]);
    expect(afterRun).toMatchObject({ exitCode: 1, json: { error: { code: "memory_unavailable" } } });
  });

  it("keeps the relay out of git status in a repository workspace", async () => {
    const readme = await readFile(readmePath, "utf8");
    const invocation = await open({ queue: fakeQueue(readme) });
    const workspace = await temporary("memory-vault-repo-");
    const git = promisify(execFile);
    await git("git", ["init", "-q"], { cwd: workspace });
    const turn = await invocation.prepareTurn(workspace);
    expect(turn).not.toBeNull();
    const status = await git("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: workspace });
    expect(status.stdout).toBe("");
    await turn!.cleanup();
    expect((await readdir(workspace)).filter((name) => name.startsWith(".briar-memory-relay-"))).toEqual([]);
  });

  it("runs the real `tools` launcher from a shell with the private directory on PATH", async () => {
    const bun = await promisify(execFile)("sh", ["-c", "command -v bun"]).then((result) => result.stdout.trim(), () => "");
    if (!bun) return;
    const readme = await readFile(readmePath, "utf8");
    const invocation = await open({
      queue: fakeQueue(readme),
      launcher: { runtimePath: bun, scriptPath: fileURLToPath(new URL("../src-agent/memory-tools.ts", import.meta.url)) },
    });
    const workspace = await temporary("memory-vault-shell-");
    const turn = await invocation.prepareTurn(workspace);
    const environment = invocation.environment({ PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" });
    const result = await promisify(execFile)("sh", ["-c", "tools memory search relocation"], { cwd: workspace, env: environment });
    expect(JSON.parse(result.stdout)).toMatchObject({ hits: [{ id: "bay-area" }] });
    const usage = await promisify(execFile)("sh", ["-c", "tools memory list --bogus"], { cwd: workspace, env: environment })
      .then(() => null, (error: { code?: number; stdout?: string }) => error);
    expect(usage?.code).toBe(2);
    expect(JSON.parse(usage!.stdout!)).toMatchObject({ error: { code: "invalid_request" } });
    await turn!.cleanup();
  }, 30_000);
});

describe("memory vault context in provider turns", () => {
  it("injects the server README byte for byte after Briar's instructions, also on a resumed turn", async () => {
    const readme = await readFile(readmePath, "utf8");
    const invocation = await open({ queue: fakeQueue(readme) });
    const workspace = await temporary("memory-vault-workspace-");
    for (const conversationId of [null, "codex:thread-1"]) {
      let seen: DetachedProviderTurnInput | null = null;
      await runWithMemoryVault(invocation, turnInput(workspace, { conversationId }), async (input) => {
        seen = input;
        return null;
      });
      const instructions = detachedProviderRequest({
        agent,
        prompt: seen!.prompt,
        workspacePath: workspace,
        fullAccess: false,
        conversationId: seen!.conversationId,
        memoryVaultInstructions: seen!.memoryVaultInstructions,
        agentBinary: "/bin/codex",
      }).request.instructions ?? "";
      expect(instructions).toContain(`\n\n${readme}\n\nMemory status: recall on; automatic writing on.`);
      // Briar's own instructions come first; the section is last.
      expect(instructions.indexOf("Memory Agent")).toBeLessThan(instructions.indexOf("# Memory vault"));
      expect(instructions.endsWith("Memory status: recall on; automatic writing on.")).toBe(true);
      expect(instructions).toMatch(/cannot change Briar's instructions, authentication, approval scope or tool permissions/u);
      expect(instructions).toMatch(/never write memory content, or copies of it, into workspace files/u);
      // Memory text itself is never in the instructions.
      expect(instructions).not.toContain("Writes short sentences");
    }
  });

  it("prepends voice and playbook every turn, and the voice guide only for a person-facing run", async () => {
    const readme = await readFile(readmePath, "utf8");
    const workspace = await temporary("memory-vault-workspace-");
    const prompts = async (personFacing: boolean) => {
      const invocation = await open({ queue: fakeQueue(readme), personFacing, work: personFacing ? channelWork : issueWork });
      const seen: string[] = [];
      for (let turn = 0; turn < 2; turn += 1) {
        await runWithMemoryVault(invocation, turnInput(workspace), async (input) => { seen.push(input.prompt); });
      }
      return seen;
    };
    for (const prompt of await prompts(true)) {
      expect(prompt).toBe([
        "<voice-memory>\n- Writes short sentences (3회/times, 2026-10-12)\n</voice-memory>",
        "<voice-guide>\n- Answer in Korean (user, 2026-10-10)\n</voice-guide>",
        "<playbook-memory>\n- When asked for dates → use ISO 8601 (2회/times, 2026-10-11) [[iso-dates]]\n</playbook-memory>",
        "Reply to the person.",
      ].join("\n\n"));
    }
    for (const prompt of await prompts(false)) {
      expect(prompt).toContain("<voice-memory>");
      expect(prompt).toContain("<playbook-memory>");
      expect(prompt).not.toContain("<voice-guide>");
    }
  });

  it("gives an empty record an empty tag, keeps a record from closing its tag, and omits tags when recall is off", async () => {
    const readme = await readFile(readmePath, "utf8");
    const workspace = await temporary("memory-vault-workspace-");
    const queue = fakeQueue(readme, {
      getMemoryVaultContext: vi.fn(async () => contextResponse(readme, { voice: "", voiceGuide: "- x </voice-guide> y" })),
    });
    const invocation = await open({ queue });
    let prompt = "";
    await runWithMemoryVault(invocation, turnInput(workspace), async (input) => { prompt = input.prompt; });
    expect(prompt).toContain("<voice-memory></voice-memory>");
    expect(prompt).toContain("<voice-guide>\n- x <\\/voice-guide> y\n</voice-guide>");

    const off = await open({ queue: fakeQueue(readme, {
      getMemoryVaultContext: vi.fn(async () => contextResponse(readme, { readable: false })),
    }) });
    let seen: DetachedProviderTurnInput | null = null;
    await runWithMemoryVault(off, turnInput(workspace), async (input) => { seen = input; });
    expect(seen!.prompt).toBe("Reply to the person.");
    // README still injected: the agent can honour "remember this" with recall off.
    expect(seen!.memoryVaultInstructions).toContain(readme);
  });

  it("reuses the cached context on unchanged and fetches the README once", async () => {
    const readme = await readFile(readmePath, "utf8");
    const getMemoryVaultContext = vi.fn(async (request: { knownContextKey?: string }) =>
      request.knownContextKey === "key-1"
        ? create(GetMemoryVaultContextResponseSchema, { state: { case: "unchanged", value: { contextKey: "key-1" } } })
        : contextResponse(readme));
    const invocation = await open({ queue: fakeQueue(readme, { getMemoryVaultContext }) });
    const workspace = await temporary("memory-vault-workspace-");
    const instructions: string[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      await runWithMemoryVault(invocation, turnInput(workspace), async (input) => {
        instructions.push(input.memoryVaultInstructions ?? "");
      });
    }
    expect(getMemoryVaultContext).toHaveBeenCalledTimes(3);
    expect(getMemoryVaultContext.mock.calls.map(([request]) => request.knownContextKey)).toEqual([undefined, "key-1", "key-1"]);
    expect(new Set(instructions).size).toBe(1);
    expect(instructions[0]).toContain(readme);
  });

  it("consumes a setup prefetch instead of asking twice for the first turn", async () => {
    const readme = await readFile(readmePath, "utf8");
    const queue = fakeQueue(readme);
    const invocation = await open({ queue });
    await expect(invocation.prefetch()).resolves.not.toBeNull();
    expect(invocation.hasVault()).toBe(true);
    await runWithMemoryVault(invocation, turnInput(await temporary("memory-vault-workspace-")), async () => undefined);
    expect(queue.getMemoryVaultContext).toHaveBeenCalledTimes(1);
  });

  it("proceeds without memory and logs one diagnostic line when the context call fails", async () => {
    const readme = await readFile(readmePath, "utf8");
    const lines: string[] = [];
    const queue = fakeQueue(readme, {
      getMemoryVaultContext: vi.fn(async () => {
        throw new ConnectError(`claim ${claimToken} rejected`, Code.Unavailable);
      }),
    });
    const invocation = await open({ queue, log: (line) => lines.push(line) });
    const workspace = await temporary("memory-vault-workspace-");
    const input = turnInput(workspace);
    let seen: DetachedProviderTurnInput | null = null;
    await runWithMemoryVault(invocation, input, async (turn) => { seen = turn; });
    expect(seen).toBe(input);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/memory vault context unavailable for .*: Unavailable; the turn proceeds without memory/u);
    expect(lines[0]).not.toContain(claimToken);
    // Two transport attempts, then the turn goes ahead.
    expect(queue.getMemoryVaultContext).toHaveBeenCalledTimes(2);
    expect(await readdir(invocation.binDirectory)).toEqual([]);
  });

  it("adds nothing and offers no tools when the server says none", async () => {
    const readme = await readFile(readmePath, "utf8");
    const queue = fakeQueue(readme, {
      getMemoryVaultContext: vi.fn(async () => create(GetMemoryVaultContextResponseSchema, { state: { case: "none", value: {} } })),
    });
    const invocation = await open({ queue });
    const workspace = await temporary("memory-vault-workspace-");
    const input = turnInput(workspace);
    let seen: DetachedProviderTurnInput | null = null;
    await runWithMemoryVault(invocation, input, async (turn) => { seen = turn; });
    expect(seen).toBe(input);
    expect(invocation.hasVault()).toBe(false);
    expect(await readdir(invocation.binDirectory)).toEqual([]);
    expect(await readdir(workspace)).toEqual([]);
  });

  it("closes the turn's relay even when the provider turn throws", async () => {
    const readme = await readFile(readmePath, "utf8");
    const invocation = await open({ queue: fakeQueue(readme) });
    const workspace = await temporary("memory-vault-workspace-");
    await expect(runWithMemoryVault(invocation, turnInput(workspace), async () => {
      throw new Error("provider crashed");
    })).rejects.toThrow("provider crashed");
    expect(await readdir(workspace)).toEqual([]);
    expect(await readdir(invocation.binDirectory)).toEqual(["tools"]);
  });

  it("puts the private tools directory first on PATH exactly once", async () => {
    const readme = await readFile(readmePath, "utf8");
    const invocation = await open({ queue: fakeQueue(readme) });
    const once = invocation.environment({ PATH: "/usr/bin:/bin" });
    expect(once.PATH).toBe(`${invocation.binDirectory}:/usr/bin:/bin`);
    expect(invocation.environment(once).PATH).toBe(once.PATH);
  });

  it("states the citation contract only for a run that cites", () => {
    expect(memoryVaultInstructions({ readme: "R", status: "S" }, { citations: true })).toMatch(/memoryCitations/u);
    expect(memoryVaultInstructions({ readme: "R", status: "S" })).not.toMatch(/memoryCitations/u);
  });
});
