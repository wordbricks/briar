import { describe, expect, it } from "vitest";

import { createTestRegistry } from "../registry";
import type { ClientSnapshot } from "./snapshot";
import { SNAPSHOT_SCHEMA_VERSION, serializeSnapshot } from "./snapshot";
import {
  clearSnapshotsSafely,
  createIndexedDbSnapshotStore,
  createMemorySnapshotStore,
  defaultSnapshotStore,
  deleteSnapshotSafely,
  readSnapshotSafely,
  setSnapshotStore,
  snapshotKey,
  writeSnapshotSafely,
  type SnapshotStore,
} from "./store";

/*
  The record store, against both implementations.

  jsdom has no IndexedDB, so the wrapper is driven by a stand-in `IDBFactory`:
  the point is the request plumbing — handlers assigned after the request is
  created, an upgrade that runs before the open succeeds, an error that reaches
  the caller — not the browser's storage engine, which is not ours to test.
*/

const snapshotOf = (userId: string, organizationId: string): ClientSnapshot => ({
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  userId,
  organizationId,
  savedAt: "2026-09-04T00:00:00.000Z",
  session: {
    user: { id: userId, name: "Tester", email: "tester@briar.local" },
    organizations: [],
    teams: [],
    activeOrganizationId: organizationId,
    activeTeamId: null,
  },
  entities: { runs: [], teams: [], workers: [], members: [], channels: [] },
  teamState: [],
  channelIndex: [],
});

const snapshot = snapshotOf("user-1", "org-a");
const key = snapshotKey("user-1", "org-a");

/*
  A stand-in for the browser's IndexedDB. Requests settle on a microtask, which
  is what makes assigning `onsuccess` after `open()` — the way the real API is
  used — meaningful here.
*/

type Handler = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;

  settle(run: () => T) {
    queueMicrotask(() => {
      try {
        this.result = run();
        this.onsuccess?.();
      } catch (caught) {
        this.error = caught instanceof Error ? caught : new Error(String(caught));
        this.onerror?.();
      }
    });
  }
}

class FakeObjectStore {
  constructor(private readonly records: Map<string, unknown>) {}

  private request<T>(run: () => T) {
    const request = new FakeRequest<T>();
    request.settle(run);
    return request as unknown as IDBRequest<T>;
  }

  get(recordKey: string) {
    return this.request(() => this.records.get(recordKey));
  }

  put(value: unknown, recordKey: string) {
    return this.request(() => {
      this.records.set(recordKey, value);
    });
  }

  delete(recordKey: string) {
    return this.request(() => {
      this.records.delete(recordKey);
    });
  }

  clear() {
    return this.request(() => {
      this.records.clear();
    });
  }
}

/** One open connection, so a test can close it the way the browser would. */
type FakeDatabase = {
  onversionchange: Handler;
  closed: boolean;
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string) => void;
  transaction: () => { objectStore: () => FakeObjectStore };
  close: () => void;
};

class FakeIndexedDb {
  readonly records = new Map<string, unknown>();
  readonly opens: string[] = [];
  /** Every connection handed out, so a test can reach the live one. */
  readonly connections: FakeDatabase[] = [];
  private stores = new Set<string>();
  failOpen = false;

  open(name: string) {
    this.opens.push(name);
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      if (this.failOpen) {
        request.error = new Error("open denied");
        request.onerror?.();
        return;
      }
      if (!this.stores.has("snapshots")) {
        request.result = this.database();
        request.onupgradeneeded?.();
      }
      request.result = this.database();
      request.onsuccess?.();
    });
    return request as unknown as IDBOpenDBRequest;
  }

  private database(): FakeDatabase {
    const database: FakeDatabase = {
      onversionchange: null,
      closed: false,
      objectStoreNames: { contains: (name: string) => this.stores.has(name) },
      createObjectStore: (name: string) => {
        this.stores.add(name);
      },
      transaction: () => ({
        objectStore: () => new FakeObjectStore(this.records),
      }),
      close: () => {
        database.closed = true;
      },
    };
    this.connections.push(database);
    return database;
  }

  asFactory() {
    return this as unknown as IDBFactory;
  }
}

const contracts: readonly [string, () => SnapshotStore][] = [
  ["memory", () => createMemorySnapshotStore()],
  [
    "indexeddb",
    () => createIndexedDbSnapshotStore(new FakeIndexedDb().asFactory()),
  ],
];

describe.each(contracts)("%s snapshot store", (_name, create) => {
  it("reads back what it wrote, and nothing for a key it never saw", async () => {
    const store = create();
    expect(await store.read(key)).toBeNull();

    await store.write(key, snapshot);
    expect(await store.read(key)).toEqual(snapshot);
  });

  it("keeps one record per account and organization", async () => {
    const store = create();
    const other = snapshotOf("user-1", "org-b");
    await store.write(key, snapshot);
    await store.write(snapshotKey("user-1", "org-b"), other);

    expect(await store.read(key)).toEqual(snapshot);
    expect(await store.read(snapshotKey("user-1", "org-b"))).toEqual(other);

    await store.delete(key);
    expect(await store.read(key)).toBeNull();
    expect(await store.read(snapshotKey("user-1", "org-b"))).toEqual(other);

    await store.clear();
    expect(await store.read(snapshotKey("user-1", "org-b"))).toBeNull();
  });
});

describe("indexeddb snapshot store", () => {
  it("opens the database once and creates its object store", async () => {
    const indexedDb = new FakeIndexedDb();
    const store = createIndexedDbSnapshotStore(indexedDb.asFactory());

    await store.write(key, snapshot);
    await store.read(key);
    await store.read(key);

    expect(indexedDb.opens).toEqual(["briar-client-snapshots"]);
    expect(indexedDb.records.get(key)).toBe(serializeSnapshot(snapshot));
  });

  it("reads a corrupted record as no record at all", async () => {
    const indexedDb = new FakeIndexedDb();
    const store = createIndexedDbSnapshotStore(indexedDb.asFactory());
    await store.write(key, snapshot);
    indexedDb.records.set(key, "{ truncated");

    expect(await store.read(key)).toBeNull();
  });

  it("lets go of the connection when another client upgrades the database", async () => {
    const indexedDb = new FakeIndexedDb();
    const store = createIndexedDbSnapshotStore(indexedDb.asFactory());
    await store.write(key, snapshot);
    expect(indexedDb.opens).toHaveLength(1);
    const held = indexedDb.connections.at(-1)!;

    // A newer build asks for a version this one does not have. Holding the
    // connection open is what would leave that upgrade blocked forever.
    held.onversionchange?.();
    expect(held.closed).toBe(true);

    // The closed connection is not reused: the next access opens a fresh one.
    expect(await store.read(key)).toEqual(snapshot);
    expect(indexedDb.opens).toHaveLength(2);
    expect(indexedDb.connections.at(-1)!.closed).toBe(false);
  });

  it("retries an open that failed instead of caching the failure", async () => {
    const indexedDb = new FakeIndexedDb();
    indexedDb.failOpen = true;
    const store = createIndexedDbSnapshotStore(indexedDb.asFactory());

    await expect(store.read(key)).rejects.toThrow("open denied");

    indexedDb.failOpen = false;
    await store.write(key, snapshot);
    expect(await store.read(key)).toEqual(snapshot);
  });
});

describe("snapshot store access", () => {
  it("degrades every operation to no snapshot when storage throws", async () => {
    const registry = createTestRegistry();
    const failing: SnapshotStore = {
      read: () => Promise.reject(new Error("blocked")),
      write: () => Promise.reject(new Error("quota exceeded")),
      delete: () => Promise.reject(new Error("blocked")),
      clear: () => Promise.reject(new Error("blocked")),
    };
    setSnapshotStore(registry, failing);

    expect(await readSnapshotSafely(registry, key)).toBeNull();
    await expect(
      writeSnapshotSafely(registry, key, snapshot),
    ).resolves.toBeUndefined();
    await expect(deleteSnapshotSafely(registry, key)).resolves.toBeUndefined();
    await expect(clearSnapshotsSafely(registry)).resolves.toBeUndefined();
  });

  it("routes the safe helpers through the injected store", async () => {
    const registry = createTestRegistry();
    const store = createMemorySnapshotStore();
    setSnapshotStore(registry, store);

    await writeSnapshotSafely(registry, key, snapshot);
    expect(store.entries().get(key)).toBe(serializeSnapshot(snapshot));
    expect(await readSnapshotSafely(registry, key)).toEqual(snapshot);

    await deleteSnapshotSafely(registry, key);
    expect(await readSnapshotSafely(registry, key)).toBeNull();
  });

  it("forgets everything on a platform without IndexedDB", async () => {
    // The test environment is one: jsdom ships no IndexedDB, and the same
    // branch covers a browser with storage switched off.
    expect(globalThis.indexedDB).toBeUndefined();
    const store = defaultSnapshotStore();
    await store.write(key, snapshot);
    expect(await store.read(key)).toBeNull();
  });
});
