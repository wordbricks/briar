import { env as cloudflareEnv } from "cloudflare:workers";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import {
  ApplicationErrorDetailSchema,
  RevisionConflictDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import { WorkerQueueService } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { beforeAll, describe, expect, it } from "vitest";
import { connectErrorInterceptor } from "../app-connect-errors";
import { memoryVaultDeps, memoryVaultFixture, type MemoryVaultFixture } from "../test-helpers/memory-vault-fixture";
import { createWorkerQueueService } from "../worker-connect-queue";
import { MemoryVaultError, type MemoryVaultErrorCode } from "./errors";
import { VaultStoreUnavailableError } from "./git-store";
import {
  getMemoryVaultContext,
  memoryVaultJournal,
  memoryVaultList,
  memoryVaultRead,
  memoryVaultSave,
  memoryVaultSearch,
  validateMemoryVaultCitations,
  type MemoryVaultCaller,
  type MemoryVaultDeps,
  type MemoryVaultSaveInput,
} from "./operations";
import { MEMORY_VAULT_README } from "./readme";
import { RECORD_TYPES } from "./records";
import { parseVaultCommitMessage } from "./trailers";

const db = cloudflareEnv.DB;

type Deps = MemoryVaultDeps & { store: import("./in-memory-git-store").InMemoryVaultGitStore };

const save = (deps: MemoryVaultDeps, caller: MemoryVaultCaller,
  input: Partial<MemoryVaultSaveInput> & Pick<MemoryVaultSaveInput, "id" | "type" | "content">) =>
  memoryVaultSave(deps, caller, {
    requestId: crypto.randomUUID(), status: null, aliases: [], expectedRevision: null, userRequested: false, ...input,
  });

const journal = (deps: MemoryVaultDeps, caller: MemoryVaultCaller, text: string,
  options: { occurredAt?: string; references?: string[]; userRequested?: boolean; requestId?: string } = {}) =>
  memoryVaultJournal(deps, caller, {
    requestId: options.requestId ?? crypto.randomUUID(), text, occurredAt: options.occurredAt ?? null,
    references: options.references ?? [], userRequested: options.userRequested ?? false,
  });

const list = (deps: MemoryVaultDeps, caller: MemoryVaultCaller, input: { type?: string; prefix?: string; cursor?: string; limit?: number } = {}) =>
  memoryVaultList(deps, caller, { type: input.type ?? null, prefix: input.prefix ?? null, status: null,
    cursor: input.cursor ?? null, limit: input.limit ?? null });

const search = (deps: MemoryVaultDeps, caller: MemoryVaultCaller, text: string, input: { type?: string; cursor?: string; limit?: number } = {}) =>
  memoryVaultSearch(deps, caller, { text, type: input.type ?? null, prefix: null, cursor: input.cursor ?? null, limit: input.limit ?? null });

const read = (deps: MemoryVaultDeps, caller: MemoryVaultCaller, target: string, revision: number | null = null) =>
  memoryVaultRead(deps, caller, { target, revision });

async function failure(promise: Promise<unknown>): Promise<MemoryVaultError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MemoryVaultError) return error;
    throw error;
  }
  throw new Error("Expected a memory vault error");
}

const failsWith = async (promise: Promise<unknown>, code: MemoryVaultErrorCode) =>
  expect((await failure(promise)).vaultCode).toBe(code);

const headOf = async (deps: Deps, repo: string) => deps.store.head(repo);

describe("memory vault", () => {
  let fixture: MemoryVaultFixture;

  beforeAll(async () => {
    fixture = await memoryVaultFixture(db);
  }, 120_000);

  const vaultRow = (scopeKey: string) => db.prepare(`select * from briar_memory_vaults where scope_key = ?`)
    .bind(scopeKey).first<{ id: string; repo_name: string; head_commit: string | null; generation: number }>();

  it("keeps the record-type and scope-kind lookup tables equal to the code", async () => {
    const types = await db.prepare(`select record_type, path_template from briar_memory_record_types order by record_type`)
      .all<{ record_type: string; path_template: string }>();
    expect(Object.fromEntries(types.results.map((row) => [row.record_type, row.path_template]))).toEqual(RECORD_TYPES);
    const kinds = await db.prepare(`select scope_kind from briar_memory_vault_scope_kinds order by scope_kind`).all<{ scope_kind: string }>();
    expect(kinds.results.map((row) => row.scope_kind)).toEqual(["dm", "group", "project"]);
  });

  it("creates the vault on first write with frontmatter, trailers, README and derived rows", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    expect((await list(deps, group.caller)).records.map((record) => record.path)).toEqual(["README.md"]);
    expect(deps.store.calls.create).toBe(0);
    expect(await vaultRow(group.channelId)).toBeNull();

    const readme = await read(deps, group.caller, "README.md");
    expect(readme.body).toBe(MEMORY_VAULT_README);

    const saved = await save(deps, group.caller, {
      id: "release-process", type: "procedure", aliases: ["release"], content: "Tag, build, publish.",
    });
    const vault = (await vaultRow(group.channelId))!;
    expect(vault.repo_name).toBe(`mv-${vault.id.replaceAll("-", "")}-g1`);
    expect(vault.head_commit).toBe(saved.commit);
    expect(await headOf(deps, vault.repo_name)).toBe(saved.commit);
    const file = await deps.store.readFile(vault.repo_name, saved.commit, "knowledge/procedures/release-process.md");
    expect(file).toMatch(/^---\nid: release-process\ntype: procedure\naliases: \[release\]\nrevision: 1\ncreated_at: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\nupdated_at: .*Z\n---\nTag, build, publish\.\n$/u);
    expect(await deps.store.readFile(vault.repo_name, saved.commit, "README.md")).toBe(MEMORY_VAULT_README);
    const [commit] = await deps.store.history(vault.repo_name, { stopAt: null, limit: 1 });
    expect(parseVaultCommitMessage(commit.message)).toMatchObject({
      vaultId: vault.id, operation: "save", actor: `agent:${fixture.agentId}`, claim: group.jobId,
      records: [{ recordId: "release-process", path: "knowledge/procedures/release-process.md", revision: 1 }],
    });
    const revision = await db.prepare(`select commit_sha, actor from briar_memory_vault_revisions where vault_id = ? and record_id = ?`)
      .bind(vault.id, "release-process").first<{ commit_sha: string; actor: string }>();
    expect(revision).toEqual({ commit_sha: saved.commit, actor: `agent:${fixture.agentId}` });
    const listed = await list(deps, group.caller);
    expect(listed.records.map((record) => record.id)).toEqual(["readme", "release-process"]);
    expect(listed.records[1]).toMatchObject({ type: "procedure", aliases: ["release"], revision: 1 });
  });

  it("requires the expected revision, reports the current one, and keeps old revisions readable", async () => {
    const deps = memoryVaultDeps(db);
    const { caller } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "deploy", type: "fact", content: "v1" });
    const required = await failure(save(deps, caller, { id: "deploy", type: "fact", content: "v2" }));
    expect(required.vaultCode).toBe("expected_revision_required");
    expect(required.details.currentRevision).toBe(1);
    const conflict = await failure(save(deps, caller, { id: "deploy", type: "fact", content: "v2", expectedRevision: 3 }));
    expect(conflict.vaultCode).toBe("revision_conflict");
    expect(conflict.details).toMatchObject({ recordId: "deploy", currentRevision: 1, expectedRevision: 3 });
    const second = await save(deps, caller, { id: "deploy", type: "fact", content: "v2", expectedRevision: 1 });
    expect(second.revision).toBe(2);
    expect((await read(deps, caller, "deploy")).body).toBe("v2\n");
    const old = await read(deps, caller, "deploy", 1);
    expect(old).toMatchObject({ body: "v1\n", revision: 1, latest: false });
    expect((await read(deps, caller, "knowledge/facts/deploy.md")).revision).toBe(2);
    await failsWith(read(deps, caller, "deploy", 9), "not_found");
    const missing = await failure(save(deps, caller, { id: "brand-new", type: "fact", content: "x", expectedRevision: 2 }));
    expect(missing.details.currentRevision).toBe(0);
  });

  it("rejects type changes, frontmatter, secrets, README writes and people in shared vaults without committing", async () => {
    const deps = memoryVaultDeps(db);
    const { caller, channelId } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "kiwi", type: "tool", content: "sandbox" });
    const head = (await vaultRow(channelId))!.head_commit;
    await failsWith(save(deps, caller, { id: "kiwi", type: "fact", content: "x", expectedRevision: 1 }), "type_mismatch");
    await failsWith(save(deps, caller, { id: "other", type: "fact", content: "---\nid: other\n---\nbody" }), "frontmatter_not_allowed");
    await failsWith(save(deps, caller, { id: "creds", type: "fact", content: "staging password: Hunter22!" }), "secret_detected");
    await failsWith(journal(deps, caller, "otp is 123456 for login, code 482913"), "secret_detected");
    await failsWith(save(deps, caller, { id: "readme", type: "fact", content: "x" }), "readme_read_only");
    await failsWith(save(deps, caller, { id: "alice", type: "person", content: "likes tea" }), "invalid_record");
    await failsWith(save(deps, caller, { id: "today", type: "timeline-daily", content: "x" }), "invalid_record");
    expect((await vaultRow(channelId))!.head_commit).toBe(head);
  });

  it("returns the stored result for a repeated request id and refuses a different payload under it", async () => {
    const deps = memoryVaultDeps(db);
    const { caller, channelId } = await fixture.claimChannel("channel", fixture.ownerId);
    const first = await save(deps, caller, { requestId: "same", id: "note", type: "fact", content: "one" });
    const again = await save(deps, caller, { requestId: "same", id: "note", type: "fact", content: "one" });
    expect(again).toEqual({ ...first, replayed: true });
    expect((await vaultRow(channelId))!.head_commit).toBe(first.commit);
    await failsWith(save(deps, caller, { requestId: "same", id: "note", type: "fact", content: "two" }), "idempotency_conflict");
    const line = await journal(deps, caller, "Deployed", { requestId: "j1" });
    expect(await journal(deps, caller, "Deployed", { requestId: "j1" })).toEqual({ ...line, replayed: true });
  });

  it("journals into the UTC day in time order, never rewrites a line, and dedupes identical lines", async () => {
    const deps = memoryVaultDeps(db);
    const { caller } = await fixture.claimChannel("channel", fixture.ownerId);
    const later = await journal(deps, caller, "second", { occurredAt: "2026-10-01T10:30:00+09:00" });
    expect(later).toMatchObject({ id: "2026-10-01", path: "timeline/daily/2026-10-01.md", line: "- 01:30 | second", revision: 1 });
    const earlier = await journal(deps, caller, "first", { occurredAt: "2026-10-01T09:15:00+09:00", references: ["release-process"] });
    expect(earlier.revision).toBe(2);
    await journal(deps, caller, "previous day", { occurredAt: "2026-09-30T23:50:00Z" });
    const day = await read(deps, caller, "2026-10-01");
    expect(day.body).toBe("- 00:15 | first [[release-process]]\n- 01:30 | second\n");
    expect((await read(deps, caller, "2026-09-30")).body).toBe("- 23:50 | previous day\n");
    // Immutability: every line of the earlier revision survives verbatim.
    const before = (await read(deps, caller, "2026-10-01", 1)).body.trim().split("\n");
    for (const lineText of before) expect(day.body.split("\n")).toContain(lineText);
    const head = await deps.store.head((await vaultRow(caller.claim.runId))!.repo_name);
    const duplicate = await journal(deps, caller, "first", { occurredAt: "2026-10-01T09:15:30+09:00", references: ["release-process"] });
    expect(duplicate).toMatchObject({ deduplicated: true, revision: 2, commit: head, line: earlier.line });
    expect(await deps.store.head((await vaultRow(caller.claim.runId))!.repo_name)).toBe(head);
    await failsWith(journal(deps, caller, "no offset", { occurredAt: "2026-10-01T09:15:00" }), "invalid_request");
    await failsWith(journal(deps, caller, "future", { occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() }), "invalid_request");
    await failsWith(journal(deps, caller, "two\nlines"), "invalid_record");
    const today = await journal(deps, caller, "now");
    expect(today.id).toBe(new Date().toISOString().slice(0, 10));
  });

  it("searches case-insensitively at one commit, pages to a null cursor, and excludes the README", async () => {
    const deps = memoryVaultDeps(db);
    const { caller } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "fruit-a", type: "fact", content: "KIWI one\nnothing\nkiwi two" });
    await save(deps, caller, { id: "fruit-b", type: "fact", content: "a Kiwi three" });
    await save(deps, caller, { id: "fruit-c", type: "tool", content: "kiwi four\nkiWi five" });
    const first = await search(deps, caller, "kiwi", { limit: 2 });
    // Line numbers count the generated frontmatter (7 lines here).
    expect(first.hits.map((hit) => `${hit.id}:${hit.line}`)).toEqual(["fruit-c:8", "fruit-c:9"]);
    expect(first.hits[0]).toMatchObject({ type: "tool", path: "entities/tools/fruit-c.md", revision: 1, snippet: "kiwi four" });
    // A write between pages does not shift the pinned pages.
    await save(deps, caller, { id: "fruit-d", type: "fact", content: "kiwi six" });
    const second = await search(deps, caller, "kiwi", { limit: 2, cursor: first.nextCursor! });
    const third = await search(deps, caller, "kiwi", { limit: 2, cursor: second.nextCursor! });
    expect([...first.hits, ...second.hits, ...third.hits].map((hit) => hit.snippet))
      .toEqual(["kiwi four", "kiWi five", "KIWI one", "kiwi two", "a Kiwi three"]);
    expect(third.nextCursor).toBeNull();
    expect(second.commit).toBe(first.commit);
    expect((await search(deps, caller, "KIWI", { limit: 50 })).hits).toHaveLength(6);
    expect((await search(deps, caller, "kiwi", { type: "tool" })).hits).toHaveLength(2);
    expect((await search(deps, caller, "Persistent memory for this conversation")).hits).toEqual([]);
    await failsWith(search(deps, caller, "other", { cursor: first.nextCursor! }), "invalid_request");
    await failsWith(search(deps, caller, "kiwi", { cursor: "not-a-cursor" }), "invalid_request");
    await failsWith(search(deps, caller, "kiwi", { limit: 51 }), "invalid_request");
  });

  it("finds a record by an alias in any language", async () => {
    const deps = memoryVaultDeps(db);
    const { caller } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "coffee-preference", type: "preference", aliases: ["커피", "Cold brew"],
      content: "Prefers decaf cold brew." });
    const hits = (await search(deps, caller, "커피")).hits;
    expect(hits).toEqual([expect.objectContaining({
      id: "coffee-preference", line: 4, snippet: "aliases: [커피, Cold brew]",
    })]);
    const read = await memoryVaultRead(deps, caller, { target: "coffee-preference", revision: null });
    expect(read.aliases).toEqual(["커피", "Cold brew"]);
  });

  it("pages the record list newest first", async () => {
    const deps = memoryVaultDeps(db);
    const { caller } = await fixture.claimChannel("channel", fixture.ownerId);
    let tick = Date.parse("2026-10-13T00:00:00Z");
    const timed = { ...deps, now: () => new Date((tick += 1_000)) };
    for (const id of ["a", "b", "c"]) await save(timed, caller, { id, type: "fact", content: id });
    const page = await list(deps, caller, { limit: 2 });
    expect(page.records.map((record) => record.id)).toEqual(["readme", "c", "b"]);
    const next = await list(deps, caller, { limit: 2, cursor: page.nextCursor! });
    expect(next.records.map((record) => record.id)).toEqual(["a"]);
    expect(next.nextCursor).toBeNull();
    expect((await list(deps, caller, { prefix: "knowledge/" })).records.map((record) => record.id)).toEqual(["c", "b", "a"]);
  });

  it("loses no concurrent journal append and lets exactly one same-record save win", async () => {
    const deps = memoryVaultDeps(db);
    const { caller } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "shared", type: "fact", content: "v1" });
    const texts = ["alpha", "bravo", "charlie", "delta"];
    const lines = await Promise.all(texts.map((text) => journal(deps, caller, text, { occurredAt: "2026-10-02T08:00:00Z" })));
    const day = await read(deps, caller, "2026-10-02");
    expect(day.body.trim().split("\n").sort()).toEqual(texts.map((text) => `- 08:00 | ${text}`));
    expect(day.revision).toBe(4);
    expect(new Set(lines.map((line) => line.commit)).size).toBe(4);

    const results = await Promise.allSettled(["x", "y", "z"].map((content) =>
      save(deps, caller, { id: "shared", type: "fact", content, expectedRevision: 1 })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected.map((result) => (result.reason as MemoryVaultError).vaultCode)).toEqual(["revision_conflict", "revision_conflict"]);
    expect(rejected.map((result) => (result.reason as MemoryVaultError).details.currentRevision)).toEqual([2, 2]);
  });

  it("re-checks on the new head when another execution pushes first, and gives up as busy", async () => {
    const deps = memoryVaultDeps(db);
    const { caller, channelId } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "first", type: "fact", content: "x" });
    const repo = (await vaultRow(channelId))!.repo_name;
    let competing = true;
    deps.store.hooks.beforePush = async () => {
      if (!competing) return;
      competing = false;
      await journal(deps, caller, "competitor", { occurredAt: "2026-10-03T08:00:00Z" });
    };
    const merged = await save(deps, caller, { id: "second", type: "fact", content: "y" });
    deps.store.hooks.beforePush = undefined;
    const files = (await deps.store.snapshot(repo, merged.commit)).files;
    expect(files.has("timeline/daily/2026-10-03.md")).toBe(true);
    expect(files.has("knowledge/facts/second.md")).toBe(true);

    let pushing = false;
    deps.store.hooks.beforePush = async () => {
      // Another execution always gets there first; guard against re-entering this hook.
      if (pushing) return;
      pushing = true;
      await deps.store.write(repo, async (head) => ({
        kind: "commit", files: new Map([...head.files, [`noise/${crypto.randomUUID()}.md`, "x"]]), message: "noise",
        timestamp: 1_760_000_000, value: null,
      }));
      pushing = false;
    };
    await failsWith(save(deps, caller, { id: "third", type: "fact", content: "z" }), "busy");
    deps.store.hooks.beforePush = undefined;
  });

  it("rebuilds D1 from the repository after a push whose D1 update was lost", async () => {
    const deps = memoryVaultDeps(db);
    const { caller, channelId } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "before", type: "fact", content: "x" });
    const vault = (await vaultRow(channelId))!;
    deps.store.hooks.afterPush = async () => {
      deps.store.hooks.afterPush = undefined;
      throw new VaultStoreUnavailableError("connection reset after push");
    };
    const input = { requestId: "crash-1", id: "after-crash", type: "decision", content: "Ship on Fridays." };
    await failsWith(save(deps, caller, input), "memory_unavailable");
    const remote = await deps.store.head(vault.repo_name);
    expect((await vaultRow(channelId))!.head_commit).not.toBe(remote);

    const retried = await save(deps, caller, input);
    expect(retried).toMatchObject({ id: "after-crash", revision: 1, commit: remote, replayed: true });
    expect((await vaultRow(channelId))!.head_commit).toBe(remote);
    const row = await db.prepare(`select revision, commit_sha, path from briar_memory_vault_records where vault_id = ? and record_id = ?`)
      .bind(vault.id, "after-crash").first();
    expect(row).toEqual({ revision: 1, commit_sha: remote, path: "knowledge/decisions/after-crash.md" });
    const revisions = await db.prepare(`select commit_sha from briar_memory_vault_revisions where vault_id = ? and record_id = ?`)
      .bind(vault.id, "after-crash").all();
    expect(revisions.results).toEqual([{ commit_sha: remote }]);
    await failsWith(save(deps, caller, { ...input, content: "Different." }), "idempotency_conflict");
  });

  describe("authority and isolation", () => {
    it("follows the DM space's recall and automatic-writing switches", async () => {
      const deps = memoryVaultDeps(db);
      const dm = await fixture.claimChannel("dm", fixture.ownerId, "Remember that I take my coffee black.");
      const spaceId = await fixture.spaceOf(dm.channelId);
      await failsWith(list(deps, dm.caller), "memory_disabled");
      await failsWith(search(deps, dm.caller, "x"), "memory_disabled");
      expect((await read(deps, dm.caller, "readme")).body).toBe(MEMORY_VAULT_README);
      await failsWith(save(deps, dm.caller, { id: "coffee", type: "preference", content: "Black coffee." }), "write_not_allowed");
      await failsWith(journal(deps, dm.caller, "asked about coffee"), "write_not_allowed");
      const saved = await save(deps, dm.caller, { id: "coffee", type: "preference", content: "Black coffee.", userRequested: true });
      expect(saved.revision).toBe(1);
      const space = await db.prepare(`select use_enabled, auto_enabled, ever_saved from briar_dm_memory_spaces where id = ?`)
        .bind(spaceId).first();
      expect(space).toEqual({ use_enabled: 1, auto_enabled: 0, ever_saved: 1 });
      expect((await list(deps, dm.caller)).records.map((record) => record.id)).toEqual(["readme", "coffee"]);
      await failsWith(journal(deps, dm.caller, "still automatic"), "write_not_allowed");
      const vault = await db.prepare(`select scope_kind, scope_key, owner_user_id, dm_space_id from briar_memory_vaults where scope_key = ?`)
        .bind(spaceId).first();
      expect(vault).toEqual({ scope_kind: "dm", scope_key: spaceId, owner_user_id: fixture.ownerId, dm_space_id: spaceId });
    });

    it("honours --user-requested only on a turn a person started", async () => {
      const deps = memoryVaultDeps(db);
      const issue = await fixture.claimIssueRun();
      await failsWith(save(deps, issue.caller, { id: "x", type: "fact", content: "x", userRequested: true }), "write_not_allowed");
      const task = await fixture.claimAgentTask();
      await failsWith(journal(deps, task.caller, "x", { userRequested: true }), "write_not_allowed");
      const group = await fixture.claimChannel("channel", fixture.otherUserId);
      expect((await save(deps, group.caller, { id: "x", type: "fact", content: "x", userRequested: true })).revision).toBe(1);
    });

    it("protects records the person wrote unless they ask", async () => {
      const deps = memoryVaultDeps(db);
      const dm = await fixture.claimChannel("dm", fixture.ownerId);
      await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
      await save(deps, dm.caller, { id: "home", type: "fact", content: "Lives in Seoul." });
      const spaceId = await fixture.spaceOf(dm.channelId);
      await db.prepare(`update briar_memory_vault_records set protected_by_user = 1
        where record_id = 'home' and vault_id = (select id from briar_memory_vaults where scope_key = ?)`).bind(spaceId).run();
      await failsWith(save(deps, dm.caller, { id: "home", type: "fact", content: "Moved.", expectedRevision: 1 }), "protected_record");
      const updated = await save(deps, dm.caller, { id: "home", type: "fact", content: "Moved to Busan.", expectedRevision: 1, userRequested: true });
      expect(updated.revision).toBe(2);
      expect((await list(deps, dm.caller)).records.find((record) => record.id === "home")?.protectedByUser).toBe(true);
      // The person's own voice-guide rules are protected line by line.
      await save(deps, dm.caller, { id: "voice-guide", type: "preference", content: "- Reply in Korean (user, 2026-10-01)\n- Keep it short\n" });
      await failsWith(save(deps, dm.caller, { id: "voice-guide", type: "preference", content: "- Keep it short\n", expectedRevision: 1 }), "protected_record");
    });

    it("keeps each vault private to its claim", async () => {
      const deps = memoryVaultDeps(db);
      const ownerDm = await fixture.claimChannel("dm", fixture.ownerId);
      await fixture.setDmMemory(ownerDm.channelId, { use: true, auto: true });
      await save(deps, ownerDm.caller, { id: "owner-secret-plan", type: "fact", content: "zebra-unique private plan" });
      const otherDm = await fixture.claimChannel("dm", fixture.otherUserId);
      await fixture.setDmMemory(otherDm.channelId, { use: true, auto: true });
      const group = await fixture.claimChannel("channel", fixture.ownerId);
      const issue = await fixture.claimIssueRun();
      const task = await fixture.claimAgentTask();
      for (const caller of [otherDm.caller, group.caller, issue.caller, task.caller]) {
        expect((await search(deps, caller, "zebra-unique")).hits).toEqual([]);
        await failsWith(read(deps, caller, "owner-secret-plan"), "not_found");
        expect((await list(deps, caller)).records.some((record) => record.id === "owner-secret-plan")).toBe(false);
      }
      expect((await search(deps, ownerDm.caller, "zebra-unique")).hits).toHaveLength(1);
      // The other person's DM gets its own vault on its first write.
      await save(deps, otherDm.caller, { id: "owner-secret-plan", type: "fact", content: "different" });
      expect((await read(deps, ownerDm.caller, "owner-secret-plan")).body).toBe("zebra-unique private plan\n");
    });

    it("refuses finished claims, other Workers, wrong tokens and runs without an Agent", async () => {
      const deps = memoryVaultDeps(db);
      const group = await fixture.claimChannel("channel", fixture.ownerId);
      await save(deps, group.caller, { id: "x", type: "fact", content: "x" });
      await failsWith(list(deps, { ...group.caller, worker: { ...group.caller.worker, workerId: crypto.randomUUID() } }), "claim_inactive");
      await failsWith(list(deps, { ...group.caller, claim: { ...group.caller.claim, claimToken: `briar_channel_claim_${"0".repeat(32)}` } }), "claim_inactive");
      await failsWith(list(deps, { ...group.caller, worker: { ...group.caller.worker, deviceId: crypto.randomUUID() } }), "claim_inactive");
      await db.prepare(`update briar_channel_agent_reply_jobs set status = 'completed' where id = ?`).bind(group.jobId).run();
      await failsWith(list(deps, group.caller), "claim_inactive");
      await failsWith(save(deps, group.caller, { id: "y", type: "fact", content: "y" }), "claim_inactive");

      const issue = await fixture.claimIssueRun();
      await db.prepare(`update briar_hunt_runs set lease_expires_at = ? where id = ?`)
        .bind(new Date(Date.now() - 1_000).toISOString(), issue.runId).run();
      await failsWith(list(deps, issue.caller), "claim_inactive");
      const unassigned = await fixture.claimIssueRun({ agent: false });
      await failsWith(list(deps, unassigned.caller), "memory_disabled");
      expect(await getMemoryVaultContext(deps, unassigned.caller, { knownContextKey: null })).toEqual({ kind: "none" });
    });

    it("turns every tool off with MEMORY_VAULT_ENABLED=false", async () => {
      const deps = memoryVaultDeps(db, { env: { MEMORY_VAULT_ENABLED: "false" } });
      const group = await fixture.claimChannel("channel", fixture.ownerId);
      await failsWith(save(deps, group.caller, { id: "x", type: "fact", content: "x" }), "memory_disabled");
      await failsWith(read(deps, group.caller, "README.md"), "memory_disabled");
      expect(await getMemoryVaultContext(deps, group.caller, { knownContextKey: null })).toEqual({ kind: "none" });
    });
  });

  it("supplies context from D1 alone while unchanged and refreshes it on writes and permission changes", async () => {
    const deps = memoryVaultDeps(db);
    const dm = await fixture.claimChannel("dm", fixture.ownerId);
    await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
    const empty = await getMemoryVaultContext(deps, dm.caller, { knownContextKey: null });
    if (empty.kind !== "context") throw new Error("expected context");
    expect(empty).toMatchObject({ readme: MEMORY_VAULT_README, voice: "", voiceGuide: "", playbook: "", head: null, scopeKind: "dm" });
    expect(empty.status).toContain("recall is on");

    await save(deps, dm.caller, { id: "voice", type: "preference", content: "- writes short replies (3회, 2026-10-12)" });
    await save(deps, dm.caller, { id: "playbook", type: "playbook", content: "- deploy fails → read the log (2 times, 2026-10-12) [[deploy-log]]" });
    const filled = await getMemoryVaultContext(deps, dm.caller, { knownContextKey: empty.contextKey });
    if (filled.kind !== "context") throw new Error("expected context");
    expect(filled.voice).toBe("- writes short replies (3회, 2026-10-12)\n");
    expect(filled.playbook).toContain("[[deploy-log]]");
    expect(filled.voiceGuide).toBe("");

    const before = { ...deps.store.calls };
    expect(await getMemoryVaultContext(deps, dm.caller, { knownContextKey: filled.contextKey }))
      .toEqual({ kind: "unchanged", contextKey: filled.contextKey });
    expect(deps.store.calls).toEqual(before);

    await fixture.setDmMemory(dm.channelId, { use: false, auto: false });
    const off = await getMemoryVaultContext(deps, dm.caller, { knownContextKey: filled.contextKey });
    if (off.kind !== "context") throw new Error("expected context");
    expect(off).toMatchObject({ readable: false, voice: "", playbook: "", readme: MEMORY_VAULT_README });
    expect(off.status).toContain("recall is off");
    expect(off.contextKey).not.toBe(filled.contextKey);
  });

  it("removes a retracted lesson's playbook lines and journals the reason in the same commit", async () => {
    const deps = memoryVaultDeps(db);
    const { caller, channelId } = await fixture.claimChannel("channel", fixture.ownerId);
    const lesson = [
      "## Situation", "Deploy failed.", "## What was done", "Retried.", "## Next time", "Read the log.",
      "## Evidence", "- AH-1849 2026-10-12", "## Confirmed", "2 times, 2026-10-13",
    ].join("\n");
    await save(deps, caller, { id: "deploy-log", type: "lesson", content: lesson });
    await failsWith(save(deps, caller, { id: "bad-lesson", type: "lesson", content: "## Situation\nx" }), "invalid_record");
    await save(deps, caller, { id: "playbook", type: "playbook", content: [
      "- deploy fails → read the log (2회, 2026-10-13) [[deploy-log]]",
      "- tests flake → rerun once (1 time, 2026-10-10) [[flaky-tests]]",
    ].join("\n") });
    const retracted = await save(deps, caller, {
      id: "deploy-log", type: "lesson", expectedRevision: 1,
      content: "Retracted 2026-10-13: the failure was the network, not the log.\n\n(previous text)",
    });
    const repo = (await vaultRow(channelId))!.repo_name;
    const [commit] = await deps.store.history(repo, { stopAt: null, limit: 1 });
    expect(commit.oid).toBe(retracted.commit);
    const trailers = parseVaultCommitMessage(commit.message)!;
    const today = new Date().toISOString().slice(0, 10);
    expect(trailers.records.map((record) => `${record.recordId}@${record.revision}`))
      .toEqual(["deploy-log@2", "playbook@2", `${today}@1`]);
    const playbook = await read(deps, caller, "playbook");
    expect(playbook.body).toBe("- tests flake → rerun once (1 time, 2026-10-10) [[flaky-tests]]\n");
    expect((await read(deps, caller, today)).body).toMatch(/^- \d\d:\d\d \| Retracted lesson: the failure was the network, not the log\. \[\[deploy-log\]\]\n$/u);
    const revisions = await db.prepare(`select record_id, commit_sha from briar_memory_vault_revisions
      where commit_sha = ? order by record_id`).bind(retracted.commit).all();
    expect(revisions.results).toHaveLength(3);
  });

  it("returns dropped lines when a playbook outgrows its limit", async () => {
    const deps = memoryVaultDeps(db);
    const { caller } = await fixture.claimChannel("channel", fixture.ownerId);
    const filler = "z".repeat(1_900);
    const saved = await save(deps, caller, { id: "playbook", type: "playbook", content: [
      `- keep ${filler} → act (5회, 2026-10-01) [[a]]`,
      `- drop ${filler} → act (1회, 2026-09-01) [[b]]`,
      `- stay ${filler} → act (1회, 2026-10-10) [[c]]`,
    ].join("\n") });
    expect(saved.droppedLines).toHaveLength(1);
    expect(saved.droppedLines[0]).toContain("- drop");
    expect((await read(deps, caller, "playbook")).body).not.toContain("- drop");
  });

  it("lists, reads and searches legacy workstream files and moves them on save", async () => {
    const deps = memoryVaultDeps(db);
    const { caller, channelId } = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, caller, { id: "seed", type: "fact", content: "x" });
    const repo = (await vaultRow(channelId))!.repo_name;
    await deps.store.write(repo, async (head) => ({
      kind: "commit",
      files: new Map([...head.files, ["workstreams/active/move-house.md", "# Move\nPack the boxes.\n"]]),
      message: "imported legacy layout",
      timestamp: 1_760_000_000,
      value: null,
    }));
    const legacy = (await list(deps, caller)).records.find((record) => record.id === "move-house");
    expect(legacy).toMatchObject({ type: "workstream", status: "active", path: "workstreams/active/move-house.md", revision: 1 });
    expect((await read(deps, caller, "move-house")).body).toBe("# Move\nPack the boxes.\n");
    expect((await search(deps, caller, "boxes")).hits[0]).toMatchObject({ id: "move-house", line: 2 });
    const moved = await save(deps, caller, {
      id: "move-house", type: "workstream", status: "completed", expectedRevision: 1, content: "# Move\nDone.",
    });
    expect(moved).toMatchObject({ path: "workstreams/move-house.md", revision: 2 });
    const files = (await deps.store.snapshot(repo)).files;
    expect(files.has("workstreams/active/move-house.md")).toBe(false);
    expect(files.get("workstreams/move-house.md")).toContain("status: completed");
    expect((await list(deps, caller)).records.find((record) => record.id === "move-house"))
      .toMatchObject({ path: "workstreams/move-house.md", status: "completed", revision: 2 });
  });

  it("accepts only citations of records this claim read at their current revision", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, group.caller, { id: "cited", type: "fact", content: "v1" });
    await save(deps, group.caller, { id: "unread", type: "fact", content: "x" });
    await read(deps, group.caller, "cited");
    const claimTokenHash = (await db.prepare(`select claim_token_hash from briar_channel_agent_reply_jobs where id = ?`)
      .bind(group.jobId).first<{ claim_token_hash: string }>())!.claim_token_hash;
    const first = await validateMemoryVaultCitations(db, { claimTokenHash, citations: [
      { documentId: "cited", version: 1 }, { documentId: "unread", version: 1 },
    ] });
    expect(first).toEqual({ accepted: [{ documentId: "cited", version: 1 }], rejected: [{ documentId: "unread", version: 1 }] });
    await save(deps, group.caller, { id: "cited", type: "fact", content: "v2", expectedRevision: 1 });
    expect((await validateMemoryVaultCitations(db, { claimTokenHash, citations: [{ documentId: "cited", version: 1 }] })).accepted).toEqual([]);
  });

  it("serves the tools over Connect with stable error codes and the current revision", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    const transport = (authorization: string) => createRouterTransport((router) => router.service(
      WorkerQueueService,
      createWorkerQueueService({
        request: new Request("https://briar.example", { headers: { authorization } }),
        db,
        env: { DB: db, MEMORY_VAULT_ENABLED: "true" } as unknown as Env,
      }, { memoryVaultStore: () => deps.store }),
    ), { router: { interceptors: [connectErrorInterceptor] } });
    const client = createClient(WorkerQueueService, transport(`Bearer ${fixture.workerToken}`));
    const claim = {
      projectId: fixture.projectId,
      workerId: fixture.workerId,
      work: {
        workId: group.jobId, runId: group.runId, claimToken: group.claimToken,
        work: { case: "channelReply" as const, value: { workspaceId: fixture.workspaceId } },
      },
    };
    const saved = await client.memoryVaultSave({ claim, requestId: "c1", id: "wire", type: "fact", content: "over the wire" });
    expect(saved).toMatchObject({ id: "wire", revision: 1, replayed: false });
    const conflict = await client.memoryVaultSave({ claim, requestId: "c2", id: "wire", type: "fact", content: "x", expectedRevision: 7 })
      .then(() => null, (error: unknown) => ConnectError.from(error));
    expect(conflict?.code).toBe(Code.FailedPrecondition);
    expect(conflict?.findDetails(ApplicationErrorDetailSchema)[0]?.code).toBe("revision_conflict");
    expect(conflict?.findDetails(RevisionConflictDetailSchema)[0]).toMatchObject({ resourceId: "wire", actualRevision: 1n, expectedRevision: 7n });
    const readBack = await client.memoryVaultRead({ claim, target: "wire" });
    expect(readBack).toMatchObject({ body: "over the wire\n", record: { id: "wire", revision: 1, type: "fact" } });
    const context = await client.getMemoryVaultContext({ claim });
    expect(context.state.case).toBe("context");
    const again = await client.getMemoryVaultContext({
      claim, knownContextKey: context.state.case === "context" ? context.state.value.contextKey : "",
    });
    expect(again.state.case).toBe("unchanged");
    const listed = await client.memoryVaultList({ claim });
    expect(listed.records.map((record) => record.id)).toEqual(["readme", "wire"]);
    const journaled = await client.memoryVaultJournal({ claim, requestId: "j", text: "wired", occurredAt: "2026-10-05T00:00:00Z" });
    expect(journaled.line).toBe("- 00:00 | wired");
    const found = await client.memoryVaultSearch({ claim, text: "WIRE" });
    expect(found.hits.map((hit) => hit.id)).toEqual(["wire", "2026-10-05"]);
    expect(found.nextCursor).toBeUndefined();

    const stranger = createClient(WorkerQueueService, transport("Bearer briar_worker_unenrolled"));
    await expect(stranger.memoryVaultList({ claim })).rejects.toThrow();
    const busy = await client.memoryVaultSave({ claim, requestId: "c3", id: "creds", type: "fact", content: "password: S3cret!" })
      .then(() => null, (error: unknown) => ConnectError.from(error));
    expect(busy?.findDetails(ApplicationErrorDetailSchema)[0]?.code).toBe("secret_detected");
  });
});
