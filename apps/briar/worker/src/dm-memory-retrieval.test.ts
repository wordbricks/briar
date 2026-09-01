import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DmMemoryCreateInput } from "../../src/lib/dm-memory-contract";
import { createChannel } from "./channels";
import { createOrganizationAgent } from "./organization-agents";
import { expireDmMemories, type DmMemoryAccess } from "./dm-memory-access";
import { getDmMemoryBrief } from "./dm-memory-brief";
import { processDmMemoryIndexJobs, processDmMemoryVectorCleanup } from "./dm-memory-indexing";
import { deleteDmMemory, getDmMemory, listDmMemories, saveDmMemory, type DmMemoryOwner } from "./dm-memory-repository";
import { getDmMemoryReferences, searchDmMemory } from "./dm-memory-retrieval";
import type { DmMemoryVectorStore } from "./dm-memory-vector-store";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

function vectorStore() {
  const published = new Map<string, VectorizeVector>();
  const pending: Array<{ id: string; apply: () => void }> = [];
  let lastMutation: string | null = null;
  let lastTime: string | null = null;
  let forcedMatches: VectorizeMatch[] | null = null;
  const match = (options?: VectorizeQueryOptions) => [...published.values()]
    .filter((vector) => vector.namespace === options?.namespace
      && vector.metadata?.memorySpaceId === options?.filter?.memorySpaceId)
    .slice(0, options?.topK ?? 20).map((vector) => ({ ...vector, score: 0.9 }));
  const store: DmMemoryVectorStore = {
    embed: vi.fn<DmMemoryVectorStore["embed"]>(async (texts) => texts.map(() => [1, ...Array<number>(1023).fill(0)])),
    verify: vi.fn<DmMemoryVectorStore["verify"]>(async (_queries, candidates) => candidates.map((candidate) => candidate.id)),
    info: vi.fn<DmMemoryVectorStore["info"]>(async () => ({ dimensions: 1024, processedUpToDatetime: lastTime, processedUpToMutation: lastMutation })),
    upsert: vi.fn<DmMemoryVectorStore["upsert"]>(async (vectors) => {
      const id = crypto.randomUUID();
      pending.push({ id, apply: () => { for (const vector of vectors) published.set(vector.id, vector); } });
      return { mutationId: id };
    }),
    deleteByIds: vi.fn<DmMemoryVectorStore["deleteByIds"]>(async (ids) => {
      const id = crypto.randomUUID();
      pending.push({ id, apply: () => { for (const vectorId of ids) published.delete(vectorId); } });
      return { mutationId: id };
    }),
    getByIds: vi.fn<DmMemoryVectorStore["getByIds"]>(async (ids) => ids.flatMap((id) => published.has(id) ? [published.get(id)!] : [])),
    query: vi.fn<DmMemoryVectorStore["query"]>(async (_vector, options) => {
      const matches = forcedMatches ?? match(options);
      return { count: matches.length, matches };
    }),
    queryById: vi.fn<DmMemoryVectorStore["queryById"]>(async (_id, options) => {
      const matches = match(options);
      return { count: matches.length, matches };
    }),
  };
  return { store, published, forceMatches: (matches: VectorizeMatch[]) => { forcedMatches = matches; },
    flush() { for (const mutation of pending.splice(0)) { mutation.apply(); lastMutation = mutation.id; lastTime = new Date().toISOString(); } } };
}

describe("DM memory retrieval with durable D1 state", () => {
  let db: D1Database;
  let dispose: () => Promise<void>;
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const now = "2026-09-01T00:00:00.000Z";
  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({ suite: "dm-memory-retrieval" });
    db = database.db; dispose = database.dispose;
    await db.prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values (?, 'Synthetic memory owner', ?, 1, ?, ?)`).bind(userId, `${userId}@example.com`, now, now).run();
    await db.prepare(`insert into briar_organizations (id, name, handle, created_at, updated_at)
      values (?, 'Memory retrieval test', ?, ?, ?)`).bind(organizationId, organizationId, now, now).run();
    await db.prepare(`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
      values (?, ?, 'owner', ?, ?)`).bind(organizationId, userId, now, now).run();
    await createOrganizationAgent(db, { id: agentId, organizationId, name: "Synthetic Agent", provider: "claude",
      model: null, responsibility: "Synthetic tests", effort: null, createdAt: now });
  }, 120_000);
  afterAll(async () => { await dispose?.(); });
  beforeEach(async () => {
    await db.prepare("update briar_dm_memory_jobs set status = 'cancelled' where kind = 'index' and status <> 'succeeded'").run();
  });

  async function dm(): Promise<DmMemoryOwner> {
    const channelId = crypto.randomUUID();
    await createChannel(db, { id: channelId, organizationId, kind: "dm", slug: channelId, name: "Synthetic DM",
      visibility: "private", topic: null, defaultProjectId: null, createdByUserId: userId,
      agentIds: [agentId], createdAt: now });
    return { organizationId, channelId, userId };
  }
  const input = (changes: Partial<DmMemoryCreateInput> = {}): DmMemoryCreateInput => ({
    requestId: crypto.randomUUID(), title: "설명 선호", body: "조건을 생략하지 않고 한국어로 간결하게 설명한다.",
    memoryClass: "profile", sourceLanguage: "ko", observedAt: now, validUntil: null, ...changes,
  });
  async function access(owner: DmMemoryOwner): Promise<DmMemoryAccess> {
    const space = (await listDmMemories(db, owner)).spaces[0]!;
    return { organizationId, channelId: owner.channelId, ownerUserId: userId, agentId,
      spaceId: space.id, revocationEpoch: space.revocationEpoch };
  }
  const due = async () => {
    await db.prepare("update briar_dm_memory_jobs set available_at = '2000-01-01T00:00:00Z' where kind = 'index'").run();
    await db.prepare("update briar_dm_memory_vectors set available_at = '2000-01-01T00:00:00Z'").run();
  };
  async function index(backend: ReturnType<typeof vectorStore>) {
    for (let round = 0; round < 12; round++) {
      await due(); await processDmMemoryIndexJobs(db, backend.store); backend.flush();
      const pending = await db.prepare(`select count(*) as total from briar_dm_memory_jobs
        where kind = 'index' and status not in ('succeeded', 'cancelled', 'failed')`).first<{ total: number }>();
      if (!pending?.total) return;
    }
    throw new Error("Synthetic indexing did not finish within its bounded rounds");
  }
  const search = (scope: DmMemoryAccess, backend: ReturnType<typeof vectorStore>, queries = ["설명 방식"]) =>
    searchDmMemory(db, scope, { queries }, { store: backend.store, minimumScore: 0.5 });

  it("M01/M02 acknowledges submission separately from queryable indexing and returns original evidence", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, input());
    const backend = vectorStore();
    await due(); await processDmMemoryIndexJobs(db, backend.store);
    expect((await getDmMemory(db, owner, saved.documentId!)).indexState).toBe("pending");
    const scope = await access(owner);
    expect((await search(scope, backend)).results).toEqual([]);
    backend.flush(); await due(); await processDmMemoryIndexJobs(db, backend.store);
    expect((await getDmMemory(db, owner, saved.documentId!)).indexState).toBe("ready");
    const result = await search(scope, backend, [" 설명 방식 ", "설명 방식"]);
    expect(result).toMatchObject({ status: "ok", indexState: "ready", results: [{ documentId: saved.documentId,
      version: 1, protectedByUser: true, sourceLanguage: "ko", excerpt: input().body }] });
    expect(result.results[0]!.sourceEventIds).toHaveLength(1);
    expect(backend.store.query).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({
      topK: 20, namespace: organizationId, filter: { memorySpaceId: scope.spaceId }, returnValues: false,
    }));
    expect(backend.store.embed).toHaveBeenLastCalledWith(["설명 방식"]);
    expect(backend.store.queryById).toHaveBeenCalled();
  });

  it("M06 rejects foreign-space candidates even if the vector backend returns them", async () => {
    const first = await dm(); const second = await dm();
    const own = await saveDmMemory(db, first, input());
    const other = await saveDmMemory(db, second, input({ body: "다른 DM의 비공개 선호" }));
    const backend = vectorStore(); await index(backend);
    backend.forceMatches([...backend.published.values()].map((vector) => ({ ...vector, score: 0.99 })));
    const scope = await access(first);
    const result = await search(scope, backend);
    expect(result.results.map((row) => row.documentId)).toEqual([own.documentId]);
    expect((await getDmMemoryReferences(db, scope, { documents: [{ documentId: other.documentId, version: 1 }] },
      [{ documentId: other.documentId!, version: 1 }])).documents[0]).toMatchObject({ status: "stale_reference" });
  });

  it("M05 verifies semantic scope after vector recall and fails closed when verification is unavailable", async () => {
    const owner = await dm();
    const android = await saveDmMemory(db, owner, input({ title: "Android minimum version", body: "Minimum Android version is 12." }));
    const upload = await saveDmMemory(db, owner, input({ title: "Upload limit", body: "One attachment may be at most 20 MiB." }));
    const backend = vectorStore(); await index(backend);
    backend.store.verify = vi.fn<DmMemoryVectorStore["verify"]>(async (queries, candidates) => {
      expect(queries).toEqual(["What is the minimum supported Android version?"]);
      expect(candidates).toHaveLength(2);
      return candidates.filter((candidate) => candidate.text.includes("Android version is 12")).map((candidate) => candidate.id);
    });
    const scope = await access(owner);
    const verified = await search(scope, backend, ["What is the minimum supported Android version?"]);
    expect(verified.results.map((row) => row.documentId)).toEqual([android.documentId]);
    expect(verified.results.map((row) => row.documentId)).not.toContain(upload.documentId);
    backend.store.verify = vi.fn(async () => { throw new Error("synthetic verifier outage with private text"); });
    expect(await search(scope, backend, ["What is the minimum supported Android version?"]))
      .toMatchObject({ status: "unavailable", results: [] });
  });

  it("M03/M04 invalidates old vectors and old references immediately when a document changes", async () => {
    const owner = await dm(); const saved = await saveDmMemory(db, owner, input());
    const backend = vectorStore(); await index(backend);
    const oldScope = await access(owner);
    await saveDmMemory(db, owner, { ...input({ body: "새로운 정정 내용" }), expectedVersion: 1 }, saved.documentId!);
    await expect(search(oldScope, backend)).rejects.toMatchObject({ code: "memory_scope_revoked" });
    const scope = await access(owner);
    expect((await search(scope, backend)).results).toEqual([]);
    expect((await getDmMemoryReferences(db, scope, { documents: [{ documentId: saved.documentId, version: 1 }] },
      [{ documentId: saved.documentId!, version: 1 }])).documents[0]).toMatchObject({ status: "stale_reference" });
    expect((await getDmMemory(db, owner, saved.documentId!)).indexState).toBe("pending");
  });

  it("M10 handles deletion racing an upsert and cleans a later reappearing vector", async () => {
    const owner = await dm(); const saved = await saveDmMemory(db, owner, input());
    const backend = vectorStore();
    const upsert = backend.store.upsert;
    backend.store.upsert = vi.fn(async (vectors) => {
      await deleteDmMemory(db, owner, saved.documentId!);
      return upsert(vectors);
    });
    await due(); await processDmMemoryIndexJobs(db, backend.store);
    backend.flush();
    const vector = [...backend.published.values()].find((row) => row.metadata?.documentId === saved.documentId)!;
    expect(vector).toBeDefined();
    expect((await search(await access(owner), backend)).results).toEqual([]);
    await due(); await processDmMemoryVectorCleanup(db, backend.store); backend.flush();
    await due(); await processDmMemoryVectorCleanup(db, backend.store);
    expect(backend.published.has(vector.id)).toBe(false);
    expect(await db.prepare("select state from briar_dm_memory_vectors where id = ?").bind(vector.id).first())
      .toMatchObject({ state: "purged" });
    expect(await deleteDmMemory(db, owner, saved.documentId!)).toMatchObject({ purgeState: "complete" });
    // The body-free tombstone remains available for a writer that died without a receipt.
    backend.published.set(vector.id, vector);
    await due(); await processDmMemoryVectorCleanup(db, backend.store); backend.flush();
    await due(); await processDmMemoryVectorCleanup(db, backend.store);
    expect(backend.published.has(vector.id)).toBe(false);
    expect(await db.prepare("select count(*) as total from briar_dm_memory_revisions where document_id = ?")
      .bind(saved.documentId).first()).toMatchObject({ total: 0 });
  });

  it("M25 builds whole-item briefs without notes, conflicts or rewritten recency", async () => {
    const owner = await dm();
    const older = await saveDmMemory(db, owner, input({ observedAt: "2020-01-01T00:00:00Z", body: "오래된 원본 관찰" }));
    const newer = await saveDmMemory(db, owner, input({ observedAt: "2025-01-01T00:00:00Z", body: "최신 원본 관찰" }));
    await saveDmMemory(db, owner, input({ memoryClass: "note", body: "주변 참고 정보" }));
    const conflict = await saveDmMemory(db, owner, input({ body: "아직 해결되지 않은 충돌" }));
    await db.prepare("update briar_dm_memory_documents set conflicted = 1 where id = ?").bind(conflict.documentId).run();
    await saveDmMemory(db, owner, input({ body: "긴 문장 전체를 보존한다. ".repeat(500) }));
    await db.prepare("update briar_dm_memory_documents set updated_at = '2099-01-01T00:00:00Z' where id = ?").bind(older.documentId).run();
    const brief = await getDmMemoryBrief(db, await access(owner));
    expect(brief.profile.map((item) => item.documentId)).toEqual([newer.documentId, older.documentId]);
    expect(brief.omitted).toBe(true);
    expect(JSON.stringify(brief)).not.toContain("긴 문장");
    expect(JSON.stringify(brief)).not.toContain("주변 참고");
    expect(JSON.stringify(brief)).not.toContain("충돌");
    expect(new TextEncoder().encode(JSON.stringify(brief)).length).toBeLessThanOrEqual(8192);
    expect(await getDmMemoryBrief(db, await access(owner))).toEqual(brief);
  });

  it("M24 expires a brief and fences its provider epoch without waiting for model consolidation", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, input({ validUntil: "2099-01-01T00:00:00Z" }));
    const scope = await access(owner);
    expect((await getDmMemoryBrief(db, scope)).validThrough).toBe("2099-01-01T00:00:00Z");
    expect(await expireDmMemories(db, "2100-01-01T00:00:00Z", scope.spaceId)).toBe(1);
    expect(await expireDmMemories(db, "2100-01-01T00:00:00Z", scope.spaceId)).toBe(0);
    await expect(getDmMemoryBrief(db, scope)).rejects.toMatchObject({ code: "memory_scope_revoked" });
    expect((await getDmMemoryBrief(db, await access(owner))).profile).toEqual([]);
    expect(await db.prepare("select expired_version from briar_dm_memory_documents where id = ?")
      .bind(saved.documentId).first()).toMatchObject({ expired_version: 1 });
  });

  it("M17 bounds UTF-8 detail responses and does not reveal undiscovered or historical content", async () => {
    const owner = await dm();
    const documents = [];
    for (let index = 0; index < 5; index++) {
      const saved = await saveDmMemory(db, owner, input({ body: "한글🧠 ".repeat(2000) }));
      documents.push({ documentId: saved.documentId!, version: 1, maxBytes: 16384 });
    }
    const scope = await access(owner);
    expect((await getDmMemoryReferences(db, scope, { documents }, [])).documents.every((item) => item.status === "stale_reference")).toBe(true);
    const detail = await getDmMemoryReferences(db, scope, { documents }, documents);
    expect(new TextEncoder().encode(JSON.stringify(detail)).length).toBeLessThanOrEqual(32768);
    expect(detail.truncated).toBe(true);
    expect(detail.documents.some((item) => item.status === "deferred")).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("�");
    const topic = await saveDmMemory(db, owner, input({ body: "# Topic\n\n## Current\n보존할 조건\n\n## History\n노출 금지 과거 조건\n" }));
    await db.prepare("update briar_dm_memory_documents set kind = 'topic' where id = ?").bind(topic.documentId).run();
    const reference = { documentId: topic.documentId!, version: 1 };
    const current = await getDmMemoryReferences(db, await access(owner), { documents: [reference] }, [reference]);
    expect(JSON.stringify(current)).toContain("보존할 조건");
    expect(JSON.stringify(current)).not.toContain("노출 금지");
  });

  it("M12 claims an indexing job once under concurrent scheduled workers", async () => {
    const owner = await dm(); const saved = await saveDmMemory(db, owner, input());
    const backend = vectorStore();
    // Isolate the candidate so prior pending jobs do not occupy the four-job budget.
    await db.prepare("update briar_dm_memory_jobs set available_at = '2099-01-01T00:00:00Z' where kind = 'index'").run();
    await db.prepare("update briar_dm_memory_jobs set available_at = '2000-01-01T00:00:00Z' where document_id = ?")
      .bind(saved.documentId).run();
    await Promise.all([processDmMemoryIndexJobs(db, backend.store), processDmMemoryIndexJobs(db, backend.store)]);
    expect(backend.store.upsert).toHaveBeenCalledTimes(1);
  });

  it("M10 rechecks revocation after the external query, before returning any excerpt", async () => {
    const owner = await dm(); const saved = await saveDmMemory(db, owner, input());
    const backend = vectorStore(); await index(backend);
    const scope = await access(owner);
    const query = backend.store.query;
    backend.store.query = vi.fn(async (vector, options) => {
      const result = await query(vector, options);
      await deleteDmMemory(db, owner, saved.documentId!);
      return result;
    });
    await expect(search(scope, backend)).rejects.toMatchObject({ code: "memory_scope_revoked" });
  });

  it("M17 enforces a deadline without falling back to all stored memories", async () => {
    const owner = await dm(); await saveDmMemory(db, owner, input());
    const backend = vectorStore(); const scope = await access(owner);
    backend.store.embed = vi.fn(async (texts) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return texts.map(() => Array<number>(1024).fill(1));
    });
    const response = await searchDmMemory(db, scope, { queries: ["설명"] }, {
      store: backend.store, minimumScore: 0.5, timeoutMs: 10,
    });
    expect(response).toMatchObject({ status: "timeout", memoryRevision: null, results: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(response.results).toEqual([]);
    expect((await searchDmMemory(db, scope, { queries: ["설명"] }, {
      store: backend.store, minimumScore: null,
    })).status).toBe("unavailable");
  });

  it("M12 rolls back all chunk preparation if the durable vector registry cannot be written", async () => {
    const owner = await dm(); const saved = await saveDmMemory(db, owner, input());
    await db.prepare(`create trigger memory_test_reject_vector before insert on briar_dm_memory_vectors
      begin select raise(abort, 'synthetic registry failure'); end;`).run();
    const backend = vectorStore();
    try {
      await due(); expect((await processDmMemoryIndexJobs(db, backend.store)).failed).toBe(1);
      expect(await db.prepare("select count(*) as total from briar_dm_memory_chunks where document_id = ?")
        .bind(saved.documentId).first()).toMatchObject({ total: 0 });
      expect(backend.store.upsert).not.toHaveBeenCalled();
    } finally { await db.exec("drop trigger memory_test_reject_vector"); }
  });

  it("M11 rejects a source edit that occurs while the embedding call is in flight", async () => {
    const owner = await dm(); const messageId = crypto.randomUUID();
    await db.prepare(`insert into briar_channel_messages
      (id, channel_id, author_user_id, body, created_at, updated_at) values (?, ?, ?, 'Original source', ?, ?)`)
      .bind(messageId, owner.channelId, userId, now, now).run();
    const saved = await saveDmMemory(db, owner, input({ sourceMessage: { id: messageId, version: 1 } }));
    const backend = vectorStore(); const embed = backend.store.embed;
    backend.store.embed = vi.fn(async (texts) => {
      const vectors = await embed(texts);
      await db.prepare("update briar_channel_messages set body = 'Corrected source' where id = ?").bind(messageId).run();
      return vectors;
    });
    await due(); await processDmMemoryIndexJobs(db, backend.store);
    expect(backend.store.upsert).not.toHaveBeenCalled();
    expect((await getDmMemory(db, owner, saved.documentId!)).status).toBe("invalidated");
    expect(await db.prepare("select count(*) as total from briar_dm_memory_chunks where document_id = ?")
      .bind(saved.documentId).first()).toMatchObject({ total: 0 });
  });

  it("M28 preserves vector purge work when a memory space is physically removed", async () => {
    const owner = await dm(); const saved = await saveDmMemory(db, owner, input());
    const backend = vectorStore(); await index(backend);
    const scope = await access(owner);
    await db.prepare("delete from briar_dm_memory_spaces where id = ?").bind(scope.spaceId).run();
    expect(await db.prepare("select count(*) as total from briar_dm_memory_revisions where document_id = ?")
      .bind(saved.documentId).first()).toMatchObject({ total: 0 });
    expect(await db.prepare("select state from briar_dm_memory_vectors where document_id = ?")
      .bind(saved.documentId).first()).toMatchObject({ state: "purging" });
    await due(); await processDmMemoryVectorCleanup(db, backend.store); backend.flush();
    await due(); await processDmMemoryVectorCleanup(db, backend.store);
    expect(backend.published.size).toBe(0);
  });

  it("M17 bounds merged search responses and prevents one document from taking every result", async () => {
    const owner = await dm();
    const sections = Array.from({ length: 3 }, (_, index) => `## 조건 ${index}\n\n${"조건은 확인된 근거가 있을 때만 적용한다. ".repeat(80)}\n\n`).join("");
    const long = await saveDmMemory(db, owner, input({ body: sections }));
    const short = await saveDmMemory(db, owner, input({ body: "다른 독립적인 관찰을 보존한다." }));
    const backend = vectorStore(); await index(backend);
    // Multiple query result lists deliberately contain the same chunk IDs.
    const result = await searchDmMemory(db, await access(owner), { queries: ["조건", "관찰"], max_results: 10 }, {
      store: backend.store, minimumScore: 0.5,
    });
    expect(result.results.filter((item) => item.documentId === long.documentId)).toHaveLength(2);
    expect(result.results.some((item) => item.documentId === short.documentId)).toBe(true);
    expect(new Set(result.results.map((item) => item.chunkId)).size).toBe(result.results.length);
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(16384);
  });

  it("M13 retains a failed purge intent after bounded retries instead of claiming erasure", async () => {
    const owner = await dm(); const saved = await saveDmMemory(db, owner, input());
    const backend = vectorStore(); await index(backend);
    await deleteDmMemory(db, owner, saved.documentId!);
    backend.store.getByIds = vi.fn(async () => { throw new Error("Synthetic transport failure"); });
    for (let attempt = 0; attempt < 3; attempt++) { await due(); await processDmMemoryVectorCleanup(db, backend.store); }
    expect(await db.prepare("select state, attempt from briar_dm_memory_vectors where document_id = ?")
      .bind(saved.documentId).first()).toMatchObject({ state: "purge_failed", attempt: 3 });
    expect(await deleteDmMemory(db, owner, saved.documentId!)).toMatchObject({ purgeState: "pending" });
    vi.mocked(backend.store.getByIds).mockClear();
    await due(); await processDmMemoryVectorCleanup(db, backend.store);
    expect(backend.store.getByIds).not.toHaveBeenCalled();
  });
});
