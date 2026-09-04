import * as Atom from "effect/unstable/reactivity/Atom";

import type { AtomRegistry } from "../registry";
import {
  deserializeSnapshot,
  serializeSnapshot,
  type ClientSnapshot,
} from "./snapshot";

/*
  Where a snapshot lives between runs.

  One record per account and organization, in IndexedDB in all three modes:
  localStorage is synchronous (a multi-megabyte write would block the frame that
  schedules it) and capped far below what a few thousand runs need. The
  interface is small on purpose — the writer and the hydration are the only
  callers, and a test hands them the in-memory implementation instead.

  Every read and write is wrapped by the `…Safely` helpers below. Persistence is
  an optimisation, so a quota error, a private-mode restriction or a browser
  that blocks storage altogether has exactly one consequence: the app boots the
  way it did before this existed.
*/

/** The record for one account in one organization. */
export const snapshotKey = (userId: string, organizationId: string) =>
  `${userId}:${organizationId}`;

export interface SnapshotStore {
  readonly read: (key: string) => Promise<ClientSnapshot | null>;
  readonly write: (key: string, snapshot: ClientSnapshot) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
  /** Drops every account's record. Sign-out and account deletion use it. */
  readonly clear: () => Promise<void>;
}

/** A store that keeps its records in memory. Tests inject this one. */
export interface MemorySnapshotStore extends SnapshotStore {
  /** The serialized records, for asserting on what was actually written. */
  readonly entries: () => ReadonlyMap<string, string>;
}

export function createMemorySnapshotStore(): MemorySnapshotStore {
  const records = new Map<string, string>();
  return {
    entries: () => new Map(records),
    async read(key) {
      const stored = records.get(key);
      return stored === undefined ? null : deserializeSnapshot(stored);
    },
    async write(key, snapshot) {
      records.set(key, serializeSnapshot(snapshot));
    },
    async delete(key) {
      records.delete(key);
    },
    async clear() {
      records.clear();
    },
  };
}

/** The store a platform without usable storage gets. It forgets everything. */
export const noopSnapshotStore: SnapshotStore = {
  read: async () => null,
  write: async () => undefined,
  delete: async () => undefined,
  clear: async () => undefined,
};

const DATABASE_NAME = "briar-client-snapshots";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "snapshots";

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

/**
 * The IndexedDB implementation, thin by design: one object store of serialized
 * snapshots keyed by `${userId}:${organizationId}`, and four operations over it.
 * The factory is a parameter so a test can drive it with a stand-in.
 */
export function createIndexedDbSnapshotStore(
  factory: IDBFactory,
): SnapshotStore {
  let connection: Promise<IDBDatabase> | null = null;

  const open = () => {
    if (!connection) {
      const pending = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(OBJECT_STORE)) {
            database.createObjectStore(OBJECT_STORE);
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          /*
            The other half of the `onblocked` rule below: a connection nobody
            lets go of is what blocks the upgrade in the first place. Briar's
            desktop window stays open for days and opens a window per project,
            so an older build holding this open would keep a newer one from
            ever upgrading — and `onblocked` would hand that newer build "no
            snapshot" for as long as the old window lives.

            So this side lets go. Persistence is an optimisation: closing costs
            the next access one reopen, and if that reopen cannot happen
            (because the upgrade moved the database past this build), it fails
            like any other open and degrades to booting without a record.
          */
          database.onversionchange = () => {
            database.close();
            if (connection === pending) connection = null;
          };
          resolve(database);
        };
        request.onerror = () =>
          reject(request.error ?? new Error("IndexedDB open failed"));
        // A second tab holding an older version open blocks the upgrade. Failing
        // fast degrades to "no snapshot" instead of hanging the boot behind it.
        request.onblocked = () =>
          reject(new Error("IndexedDB upgrade is blocked by another tab"));
      });
      connection = pending;
    }
    // A failed open must not be cached: the next call gets a fresh attempt.
    return connection.catch((error: unknown) => {
      connection = null;
      throw error;
    });
  };

  const transact = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await open();
    const transaction = database.transaction(OBJECT_STORE, mode);
    const result = await requestResult(run(transaction.objectStore(OBJECT_STORE)));
    return result;
  };

  return {
    async read(key) {
      const stored = await transact<unknown>("readonly", (store) =>
        store.get(key),
      );
      return stored === undefined ? null : deserializeSnapshot(stored);
    },
    async write(key, snapshot) {
      await transact("readwrite", (store) =>
        store.put(serializeSnapshot(snapshot), key),
      );
    },
    async delete(key) {
      await transact("readwrite", (store) => store.delete(key));
    },
    async clear() {
      await transact("readwrite", (store) => store.clear());
    },
  };
}

/**
 * The store this platform can actually use. jsdom and any browser with storage
 * disabled have no `indexedDB`, and get the store that forgets everything.
 */
export function defaultSnapshotStore(): SnapshotStore {
  try {
    const factory = globalThis.indexedDB;
    return factory ? createIndexedDbSnapshotStore(factory) : noopSnapshotStore;
  } catch {
    return noopSnapshotStore;
  }
}

/**
 * The store this registry persists through — the seam the data sources use, so
 * a test writes it once and every persistence path follows.
 */
export const snapshotStoreAtom = Atom.make<SnapshotStore>(
  defaultSnapshotStore(),
).pipe(Atom.keepAlive, Atom.withLabel("persistence/store"));

export const resolveSnapshotStore = (registry: AtomRegistry): SnapshotStore =>
  registry.get(snapshotStoreAtom);

export function setSnapshotStore(
  registry: AtomRegistry,
  store: SnapshotStore,
): void {
  registry.set(snapshotStoreAtom, store);
}

/*
  The four operations, degraded to "nothing happened" on any failure. Callers
  are boot and background paths where an exception would be worse than a missing
  cache, so none of them has an error branch to write.
*/

export async function readSnapshotSafely(
  registry: AtomRegistry,
  key: string,
): Promise<ClientSnapshot | null> {
  try {
    return await resolveSnapshotStore(registry).read(key);
  } catch {
    return null;
  }
}

export async function writeSnapshotSafely(
  registry: AtomRegistry,
  key: string,
  snapshot: ClientSnapshot,
): Promise<void> {
  try {
    await resolveSnapshotStore(registry).write(key, snapshot);
  } catch {
    // A snapshot that could not be stored costs the next boot its head start.
  }
}

export async function deleteSnapshotSafely(
  registry: AtomRegistry,
  key: string,
): Promise<void> {
  try {
    await resolveSnapshotStore(registry).delete(key);
  } catch {
    // Same: the record stays until something else clears it.
  }
}

export async function clearSnapshotsSafely(
  registry: AtomRegistry,
): Promise<void> {
  try {
    await resolveSnapshotStore(registry).clear();
  } catch {
    // Same.
  }
}
