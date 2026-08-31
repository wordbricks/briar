import * as Schema from "effect/Schema";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dmMemoryCreateInput, type DmMemoryCreateInput } from "../../src/lib/dm-memory-contract";
import { addChannelMember, createChannel, removeChannelMember } from "./channels";
import { createOrganizationAgent } from "./organization-agents";
import apiWorker from "./index";
import {
  deleteDmMemory, exportDmMemoryEntries, getDmMemory, listDmMemories, saveDmMemory, updateDmMemorySettings,
  type DmMemoryOwner,
} from "./dm-memory-repository";
import { dmMemoryZipResponse } from "./dm-memory-export";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

describe("DM memory authoritative storage", () => {
  let db: D1Database;
  let dispose: () => Promise<void>;
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const now = "2026-09-01T00:00:00.000Z";

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({ suite: "dm-memory" });
    db = database.db;
    dispose = database.dispose;
    for (const id of [userId, otherUserId]) await db.prepare(`insert into "user"
      (id, name, email, emailVerified, createdAt, updatedAt) values (?, 'Test', ?, 1, ?, ?)`)
      .bind(id, `${id}@example.com`, now, now).run();
    for (const id of [userId, otherUserId]) await db.prepare(`insert into "session"
      (id, expiresAt, token, createdAt, updatedAt, userId) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), `memory-test-${id}`, now, now, id).run();
    await db.prepare(`insert into briar_organizations (id, name, handle, created_at, updated_at)
      values (?, 'Memory test', ?, ?, ?)`).bind(organizationId, organizationId, now, now).run();
    for (const id of [userId, otherUserId]) await db.prepare(`insert into briar_organization_members
      (organization_id, user_id, role, created_at, updated_at) values (?, ?, 'owner', ?, ?)`)
      .bind(organizationId, id, now, now).run();
    await createOrganizationAgent(db, {
      id: agentId, organizationId, name: "Memory test Agent", provider: "claude", model: null,
      responsibility: "Use synthetic test data only", effort: null, createdAt: now,
    });
  }, 120_000);
  afterAll(async () => { await dispose?.(); });

  async function dm(): Promise<DmMemoryOwner> {
    const channelId = crypto.randomUUID();
    await createChannel(db, {
      id: channelId, organizationId, kind: "dm", slug: channelId, name: "Test DM",
      visibility: "private", topic: null, defaultProjectId: null,
      createdByUserId: userId, agentIds: [agentId], createdAt: now,
    });
    return { organizationId, channelId, userId };
  }
  const memory = (overrides: Partial<DmMemoryCreateInput> = {}): DmMemoryCreateInput => ({
    requestId: crypto.randomUUID(), title: "Response preference",
    body: "기술 설명은 결론부터 듣고 싶다.", memoryClass: "profile", sourceLanguage: "ko",
    observedAt: now, validUntil: null, ...overrides,
  });
  const count = async (table: string, spaceId: string) => (await db.prepare(
    `select count(*) as total from ${table} where space_id = ?`,
  ).bind(spaceId).first<{ total: number }>())?.total;

  it("M01 saves the document, evidence and index job atomically and replays a request", async () => {
    const owner = await dm();
    const input = memory();
    const saved = await saveDmMemory(db, owner, input);
    expect(saved.version).toBe(1);
    expect(saved.documentId).toBeTruthy();
    const page = await listDmMemories(db, owner);
    expect(page.documents).toHaveLength(1);
    expect(page.documents[0]).not.toHaveProperty("body");
    expect(page.spaces[0]).toMatchObject({ useEnabled: true, autoEnabled: false, memoryRevision: 1 });
    const detail = await getDmMemory(db, owner, saved.documentId!);
    expect(detail).toMatchObject({ body: input.body, protectedByUser: true, indexState: "pending" });
    expect(detail.sources).toHaveLength(1);
    expect(detail.sources[0].type).toBe("user_edit_event");
    expect(await count("briar_dm_memory_jobs", detail.memorySpaceId)).toBe(1);
    expect(await saveDmMemory(db, owner, input)).toMatchObject({ documentId: detail.id, replayed: true });
    expect(await count("briar_dm_memory_revisions", detail.memorySpaceId)).toBe(1);
    await expect(saveDmMemory(db, owner, { ...input, body: "Different" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("M06 does not grant another organization owner access to a private memory", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory());
    const outsider = { ...owner, userId: otherUserId };
    expect((await listDmMemories(db, outsider)).documents).toEqual([]);
    await expect(getDmMemory(db, outsider, saved.documentId!)).rejects.toMatchObject({ status: 404 });
    await expect(deleteDmMemory(db, outsider, saved.documentId!)).rejects.toMatchObject({ status: 404 });
  });

  it("M07 closes a space when a member row is replaced in place", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory());
    await db.prepare("update briar_channel_members set user_id = ? where channel_id = ? and user_id = ?")
      .bind(otherUserId, owner.channelId, userId).run();
    const page = await listDmMemories(db, owner);
    expect(page.spaces[0]).toMatchObject({ status: "closed", useEnabled: false });
    await expect(getDmMemory(db, { ...owner, userId: otherUserId }, saved.documentId!))
      .rejects.toMatchObject({ status: 404 });
    const fresh = await saveDmMemory(db, { ...owner, userId: otherUserId }, memory());
    expect((await getDmMemory(db, { ...owner, userId: otherUserId }, fresh.documentId!)).memorySpaceId)
      .not.toBe(page.spaces[0].id);
  });

  it("M07 creates a fresh space after leaving and rejoining the organization", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory());
    const original = await getDmMemory(db, owner, saved.documentId!);
    await db.prepare("delete from briar_organization_members where organization_id = ? and user_id = ?")
      .bind(organizationId, userId).run();
    try {
      await expect(getDmMemory(db, owner, saved.documentId!)).rejects.toMatchObject({ status: 404 });
    } finally {
      await db.prepare(`insert into briar_organization_members
        (organization_id, user_id, role, created_at, updated_at) values (?, ?, 'owner', ?, ?)`)
        .bind(organizationId, userId, now, now).run();
    }
    expect((await listDmMemories(db, owner)).spaces[0].status).toBe("closed");
    const fresh = await saveDmMemory(db, owner, memory());
    expect((await getDmMemory(db, owner, fresh.documentId!)).memorySpaceId).not.toBe(original.memorySpaceId);
  });

  it("M12 only commits one concurrent edit and leaves no orphan revisions or jobs", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory());
    const edits = await Promise.allSettled([
      saveDmMemory(db, owner, { ...memory({ body: "First correction" }), expectedVersion: 1 }, saved.documentId!),
      saveDmMemory(db, owner, { ...memory({ body: "Second correction" }), expectedVersion: 1 }, saved.documentId!),
    ]);
    expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(edits.filter((r) => r.status === "rejected")).toHaveLength(1);
    const current = await getDmMemory(db, owner, saved.documentId!);
    expect(current.version).toBe(2);
    expect(await count("briar_dm_memory_revisions", current.memorySpaceId)).toBe(2);
    expect(await count("briar_dm_memory_jobs", current.memorySpaceId)).toBe(2);
    expect((await listDmMemories(db, owner)).spaces[0]).toMatchObject({ memoryRevision: 2, revocationEpoch: 1 });
  });

  it("M01 rolls back the whole write when its outbox insert fails", async () => {
    const owner = await dm();
    await db.prepare(`create trigger dm_memory_test_fail_outbox before insert on briar_dm_memory_jobs
      when new.kind = 'index' begin select raise(abort, 'test outbox failure'); end`).run();
    try {
      await expect(saveDmMemory(db, owner, memory())).rejects.toThrow();
      const page = await listDmMemories(db, owner);
      expect(page.documents).toEqual([]);
      expect(page.spaces[0]).toMatchObject({ memoryRevision: 0, useEnabled: false });
      expect(await count("briar_dm_memory_commits", page.spaces[0].id)).toBe(0);
    } finally {
      await db.prepare("drop trigger dm_memory_test_fail_outbox").run();
    }
  });

  it("M07 closes a changed roster permanently while keeping owner management", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory());
    const oldSpace = (await getDmMemory(db, owner, saved.documentId!)).memorySpaceId;
    await addChannelMember(db, { channelId: owner.channelId, userId: otherUserId, role: "member", createdAt: now });
    const closed = await listDmMemories(db, owner);
    expect(closed.eligible).toBe(false);
    expect(closed.spaces[0]).toMatchObject({ status: "closed", useEnabled: false, revocationEpoch: 1 });
    await expect(saveDmMemory(db, owner, memory({ memorySpaceId: oldSpace })))
      .rejects.toMatchObject({ code: "version_conflict" });
    expect((await getDmMemory(db, owner, saved.documentId!)).id).toBe(saved.documentId);
    await removeChannelMember(db, owner.channelId, otherUserId);
    const next = await saveDmMemory(db, owner, memory());
    expect((await getDmMemory(db, owner, next.documentId!)).memorySpaceId).not.toBe(oldSpace);
    await deleteDmMemory(db, owner, saved.documentId!);
  });

  it("M21 keeps automatic learning off, preserves manual saves and fences later OFF changes", async () => {
    const owner = await dm();
    await saveDmMemory(db, owner, memory());
    const space = (await listDmMemories(db, owner)).spaces[0];
    await updateDmMemorySettings(db, owner, {
      requestId: crypto.randomUUID(), memorySpaceId: space.id, expectedMemoryRevision: space.memoryRevision,
      useEnabled: false, autoEnabled: false,
    });
    await saveDmMemory(db, owner, memory({ memorySpaceId: space.id }));
    expect((await listDmMemories(db, owner)).spaces[0]).toMatchObject({ useEnabled: false, autoEnabled: false, revocationEpoch: 1 });
  });

  it("M19 accepts a long explicit document without truncation and rejects forged protection", () => {
    const decode = Schema.decodeUnknownSync(dmMemoryCreateInput);
    const input = memory({ body: "한글 조건 보존. ".repeat(200) });
    expect(decode(input).body).toBe(input.body);
    expect(() => decode({ ...input, protectedByUser: false })).toThrow();
    expect(() => decode(memory({ body: "한".repeat(22_000) }))).toThrow();
  });

  it("M11 invalidates dependent memories and increments the source version on edit", async () => {
    const owner = await dm();
    const messageId = crypto.randomUUID();
    await db.prepare(`insert into briar_channel_messages
      (id, channel_id, author_user_id, body, created_at, updated_at) values (?, ?, ?, 'Original source', ?, ?)`)
      .bind(messageId, owner.channelId, userId, now, now).run();
    const saved = await saveDmMemory(db, owner, memory({ sourceMessage: { id: messageId, version: 1 } }));
    const messageChanges = async () => (await db.prepare(`select count(*) as total
      from briar_channel_changes where entity_type = 'message' and entity_id = ?`)
      .bind(messageId).first<{ total: number }>())?.total ?? 0;
    const beforeEdit = await messageChanges();
    await db.prepare("update briar_channel_messages set body = 'Corrected source' where id = ?").bind(messageId).run();
    expect(await messageChanges()).toBe(beforeEdit + 1);
    expect((await getDmMemory(db, owner, saved.documentId!)).status).toBe("invalidated");
    expect((await listDmMemories(db, owner)).spaces[0].revocationEpoch).toBe(1);
    await expect(saveDmMemory(db, owner, memory({ sourceMessage: { id: messageId, version: 1 } })))
      .rejects.toMatchObject({ code: "source_changed" });
  });

  it("M28 deletes every revision and body hash but preserves source exclusion IDs", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory());
    await saveDmMemory(db, owner, { ...memory({ body: "Corrected" }), expectedVersion: 1 }, saved.documentId!);
    const spaceId = (await getDmMemory(db, owner, saved.documentId!)).memorySpaceId;
    await deleteDmMemory(db, owner, saved.documentId!);
    await deleteDmMemory(db, owner, saved.documentId!);
    await expect(getDmMemory(db, owner, saved.documentId!)).rejects.toMatchObject({ status: 404 });
    expect(await count("briar_dm_memory_revisions", spaceId)).toBe(0);
    expect(await count("briar_dm_memory_sources", spaceId)).toBe(0);
    expect(await count("briar_dm_memory_exclusions", spaceId)).toBe(2);
    const commits = await db.prepare("select payload_hash from briar_dm_memory_commits where space_id = ?")
      .bind(spaceId).all<{ payload_hash: string | null }>();
    expect(commits.results.every((row) => row.payload_hash === null)).toBe(true);
  });

  it("M28 exports only current owned Markdown and metadata with safe filenames", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory({ title: "../../unsafe-filename", body: "Exported synthetic preference" }));
    const otherOwner = await dm();
    await saveDmMemory(db, otherOwner, memory({ body: "Excluded other DM" }));
    const document = await getDmMemory(db, owner, saved.documentId!);
    const response = dmMemoryZipResponse(exportDmMemoryEntries(db, owner, document.memorySpaceId), document.memorySpaceId);
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      "manifest.json", `profile/${document.id}.json`, `profile/${document.id}.md`,
    ].sort());
    expect(strFromU8(entries[`profile/${document.id}.md`])).toBe(document.body);
    const manifest = JSON.parse(strFromU8(entries[`profile/${document.id}.json`]));
    expect(manifest).toMatchObject({ version: 1, protectedByUser: true, sourceLanguage: "ko", memoryClass: "profile" });
    expect(manifest.sources).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toContain("source_hash");
    expect(Object.values(entries).map((value) => strFromU8(value)).join("\n")).not.toContain("Excluded other DM");
  });

  it("M28 cancels an export whose snapshot changes", async () => {
    const owner = await dm();
    const saved = await saveDmMemory(db, owner, memory());
    const spaceId = (await getDmMemory(db, owner, saved.documentId!)).memorySpaceId;
    const entries = exportDmMemoryEntries(db, owner, spaceId);
    await entries.next();
    await deleteDmMemory(db, owner, saved.documentId!);
    await expect(entries.next()).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("routes authenticated CRUD through the Worker and rejects forged fields and other owners", async () => {
    const owner = await dm();
    const env = { DB: db, BETTER_AUTH_SECRET: "memory-integration-test-only-not-production",
      GOOGLE_CLIENT_ID: "memory-test", GOOGLE_CLIENT_SECRET: "memory-test" } as Env;
    const path = `https://briar-api.example/organizations/${organizationId}/channels/${owner.channelId}/memory`;
    const call = (suffix: string, method = "GET", body?: unknown, actor = userId) => apiWorker.fetch(
      new Request(path + suffix, { method, headers: { authorization: `Bearer memory-test-${actor}`,
        "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), env,
    );
    const forged = await call("/documents", "POST", { ...memory(), protectedByUser: false });
    expect(forged.status).toBe(400);
    const created = await call("/documents", "POST", memory());
    expect(created.status).toBe(200);
    const payload = await created.json() as { documentId: string };
    const read = await call(`/documents/${payload.documentId}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await call(`/documents/${payload.documentId}`, "GET", undefined, otherUserId)).status).toBe(404);
    expect((await call(`/documents/${payload.documentId}`, "DELETE")).status).toBe(200);
    expect((await call(`/documents/${payload.documentId}`)).status).toBe(404);
  });
});
