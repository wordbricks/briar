import { writeFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  type FileComputerUseBrowserLoginStoreOptions,
  FileComputerUseBrowserLoginStore,
} from "./computer-use-browser-login-store";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const makeRoots = async (
  options: Omit<FileComputerUseBrowserLoginStoreOptions, "sharedDirectory" | "profilesDirectory"> = {},
) => {
  const root = await mkdtemp(join(tmpdir(), "briar-login-store-"));
  temporaryRoots.push(root);
  const shared = join(root, "shared");
  const profiles = join(root, "profiles");
  await mkdir(profiles, { recursive: true });
  const store = new FileComputerUseBrowserLoginStore({
    sharedDirectory: shared,
    profilesDirectory: profiles,
    log: () => {},
    ...options,
  });
  return {
    root,
    shared,
    profiles,
    store,
    display: (index: number) => join(profiles, `display-${index}`),
  };
};

const cookieColumns = [
  "creation_utc",
  "host_key",
  "top_frame_site_key",
  "name",
  "value",
  "encrypted_value",
  "path",
  "expires_utc",
  "is_secure",
  "is_httponly",
  "last_access_utc",
  "has_expires",
  "is_persistent",
  "priority",
  "samesite",
  "source_scheme",
  "source_port",
  "last_update_utc",
  "source_type",
  "has_cross_site_ancestor",
] as const;

interface CookieRow {
  readonly host: string;
  readonly name: string;
  readonly value: string;
  readonly lastUpdate: number;
}

/** A fixture shaped like Chrome's cookie database, down to the unique index. */
const writeCookieDatabase = async (
  path: string,
  rows: readonly CookieRow[],
  options: { readonly version?: string; readonly columns?: readonly string[] } = {},
) => {
  await mkdir(dirname(path), { recursive: true });
  const columns = options.columns ?? cookieColumns;
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE meta(key TEXT NOT NULL UNIQUE PRIMARY KEY, value TEXT)");
  database.prepare("INSERT INTO meta (key, value) VALUES ('version', ?)")
    .run(options.version ?? "24");
  database.exec(
    `CREATE TABLE cookies(${
      columns
        .map((name) => `${name} ${name === "last_update_utc" ? "INTEGER" : "TEXT"}`)
        .join(", ")
    })`,
  );
  if (options.columns === undefined) {
    database.exec(
      "CREATE UNIQUE INDEX cookies_unique_index ON cookies("
        + "host_key, top_frame_site_key, has_cross_site_ancestor, name, path,"
        + " source_scheme, source_port)",
    );
  }
  const insert = database.prepare(
    `INSERT INTO cookies (${columns.join(", ")}) VALUES (${
      columns.map(() => "?").join(", ")
    })`,
  );
  for (const row of rows) {
    insert.run(...columns.map((column) => {
      if (column === "host_key") return row.host;
      if (column === "name") return row.name;
      if (column === "value") return row.value;
      if (column === "last_update_utc") return row.lastUpdate;
      if (column === "path") return "/";
      if (column === "top_frame_site_key") return "";
      if (column === "has_cross_site_ancestor") return "0";
      if (column === "source_scheme") return "2";
      if (column === "source_port") return "443";
      return "0";
    }));
  }
  database.close();
};

const readCookies = (path: string): { host: string; value: string; update: string }[] => {
  const database = new DatabaseSync(path);
  const rows = database
    .prepare("SELECT host_key, value, last_update_utc FROM cookies ORDER BY host_key")
    .all() as { host_key: unknown; value: unknown; last_update_utc: unknown }[];
  database.close();
  return rows.map((row) => ({
    host: String(row.host_key),
    value: String(row.value),
    update: String(row.last_update_utc),
  }));
};

const sharedCookiePath = (shared: string) => join(shared, "Default/Network/Cookies");
const displayCookiePath = (display: string) => join(display, "Default/Network/Cookies");

it("seeds a fresh display profile from the shared store", async () => {
  const { shared, store, display } = await makeRoots();
  await writeCookieDatabase(sharedCookiePath(shared), [
    { host: "example.com", name: "sid", value: "shared", lastUpdate: 10 },
  ]);
  await mkdir(join(shared, "Default/Local Storage/leveldb"), { recursive: true });
  await writeFile(join(shared, "Default/Local Storage/leveldb/000001.log"), "shared");
  await writeFile(join(shared, "Default/Preferences"), "{}");

  const report = await store.seed(2);

  expect(report.copied).toEqual(["Default/Network/Cookies", "Default/Local Storage"]);
  expect(readCookies(displayCookiePath(display(2)))).toEqual([
    { host: "example.com", value: "shared", update: "10" },
  ]);
  expect(
    await readFile(join(display(2), "Default/Local Storage/leveldb/000001.log"), "utf8"),
  ).toBe("shared");
  await expect(stat(join(display(2), "Default/Preferences"))).rejects.toThrow();
  expect((await stat(display(2))).mode & 0o777).toBe(0o700);
});

it("leaves an existing display profile alone", async () => {
  const { shared, store, display } = await makeRoots();
  await writeCookieDatabase(sharedCookiePath(shared), [
    { host: "example.com", name: "sid", value: "shared", lastUpdate: 10 },
  ]);
  await mkdir(display(2), { recursive: true });

  const report = await store.seed(2);

  expect(report.copied).toEqual([]);
  expect(report.skipped[0]?.reason).toBe("display profile already exists");
  expect(await readdir(display(2))).toEqual([]);
});

it("creates nothing when the shared store is missing", async () => {
  const { profiles, store, display } = await makeRoots();
  const report = await store.seed(2);

  expect(report.skipped[0]?.reason).toBe("shared login store does not exist");
  await expect(stat(display(2))).rejects.toThrow();
  expect(await readdir(profiles)).toEqual([]);
});

it("leaves no staging directory when seeding fails", async () => {
  const { shared, profiles, store, display } = await makeRoots();
  await writeCookieDatabase(sharedCookiePath(shared), [
    { host: "example.com", name: "sid", value: "shared", lastUpdate: 10 },
  ]);
  // A directory where the whitelist expects a file makes the copy fail.
  await mkdir(join(shared, "Default/Login Data"), { recursive: true });

  const report = await store.seed(2);

  expect(report.skipped).toHaveLength(1);
  expect(report.copied).toEqual([]);
  await expect(stat(display(2))).rejects.toThrow();
  expect(await readdir(profiles)).toEqual([]);
});

it("copies cookies into an empty shared store", async () => {
  const { shared, store, display } = await makeRoots();
  await writeCookieDatabase(displayCookiePath(display(2)), [
    { host: "example.com", name: "sid", value: "fresh", lastUpdate: 5 },
  ]);

  const report = await store.capture(2);

  expect(report.copied).toEqual(["Default/Network/Cookies"]);
  expect(report.merged).toEqual([]);
  expect(readCookies(sharedCookiePath(shared))).toEqual([
    { host: "example.com", value: "fresh", update: "5" },
  ]);
  expect((await stat(shared)).mode & 0o777).toBe(0o700);
});

it("merges cookie rows and keeps the newer last_update_utc", async () => {
  const { shared, store, display } = await makeRoots();
  await writeCookieDatabase(sharedCookiePath(shared), [
    { host: "kept.com", name: "sid", value: "shared-newer", lastUpdate: 90 },
    { host: "replaced.com", name: "sid", value: "shared-older", lastUpdate: 10 },
  ]);
  await writeCookieDatabase(displayCookiePath(display(2)), [
    { host: "kept.com", name: "sid", value: "display-older", lastUpdate: 20 },
    { host: "replaced.com", name: "sid", value: "display-newer", lastUpdate: 30 },
    { host: "new.com", name: "sid", value: "display-new", lastUpdate: 40 },
  ]);

  const report = await store.capture(2);

  expect(report.merged).toEqual(["Default/Network/Cookies"]);
  expect(readCookies(sharedCookiePath(shared))).toEqual([
    { host: "kept.com", value: "shared-newer", update: "90" },
    { host: "new.com", value: "display-new", update: "40" },
    { host: "replaced.com", value: "display-newer", update: "30" },
  ]);
});

it("falls back to file replacement when the cookie schemas differ", async () => {
  const { shared, store, display } = await makeRoots();
  await writeCookieDatabase(sharedCookiePath(shared), [
    { host: "kept.com", name: "sid", value: "shared", lastUpdate: 90 },
  ], { columns: ["host_key", "name", "value", "last_update_utc"] });
  await writeCookieDatabase(displayCookiePath(display(2)), [
    { host: "new.com", name: "sid", value: "display", lastUpdate: 1 },
  ]);

  const report = await store.capture(2);

  expect(report.merged).toEqual([]);
  expect(report.replaced).toEqual(["Default/Network/Cookies"]);
  expect(readCookies(sharedCookiePath(shared))).toEqual([
    { host: "new.com", value: "display", update: "1" },
  ]);
});

it("falls back to file replacement when no unique index exists", async () => {
  const { shared, store, display } = await makeRoots();
  const columns = [...cookieColumns];
  await writeCookieDatabase(sharedCookiePath(shared), [
    { host: "kept.com", name: "sid", value: "shared", lastUpdate: 90 },
  ], { columns });
  await writeCookieDatabase(displayCookiePath(display(2)), [
    { host: "new.com", name: "sid", value: "display", lastUpdate: 1 },
  ], { columns });

  const report = await store.capture(2);

  expect(report.merged).toEqual([]);
  expect(report.replaced).toEqual(["Default/Network/Cookies"]);
  expect(readCookies(sharedCookiePath(shared))).toEqual([
    { host: "new.com", value: "display", update: "1" },
  ]);
});

it("replaces Local Storage and IndexedDB wholesale without leftovers", async () => {
  const { shared, store, display } = await makeRoots();
  await mkdir(join(shared, "Default/Local Storage/leveldb"), { recursive: true });
  await writeFile(join(shared, "Default/Local Storage/leveldb/old.log"), "old");
  await mkdir(join(display(2), "Default/Local Storage/leveldb"), { recursive: true });
  await writeFile(join(display(2), "Default/Local Storage/leveldb/new.log"), "new");
  await mkdir(join(display(2), "Default/IndexedDB/site"), { recursive: true });
  await writeFile(join(display(2), "Default/IndexedDB/site/data"), "indexed");

  const report = await store.capture(2);

  expect(report.replaced).toEqual(["Default/Local Storage"]);
  expect(report.copied).toEqual(["Default/IndexedDB"]);
  expect(await readdir(join(shared, "Default/Local Storage/leveldb"))).toEqual(["new.log"]);
  expect(await readFile(join(shared, "Default/IndexedDB/site/data"), "utf8")).toBe("indexed");
  const remaining = await readdir(join(shared, "Default"));
  expect(remaining.some((name) => /\.(?:tmp|old)-/u.test(name))).toBe(false);
});

it("does nothing when the display profile is missing", async () => {
  const { shared, store } = await makeRoots();

  const report = await store.capture(2);

  expect(report).toEqual({ merged: [], replaced: [], copied: [], skipped: [] });
  await expect(stat(shared)).rejects.toThrow();
});

const liveRows = [
  { host: "kept.com", name: "sid", value: "live-older", lastUpdate: 20 },
  { host: "replaced.com", name: "sid", value: "live-newer", lastUpdate: 30 },
  { host: "new.com", name: "sid", value: "live-new", lastUpdate: 40 },
];

const sharedRows = [
  { host: "kept.com", name: "sid", value: "shared-newer", lastUpdate: 90 },
  { host: "replaced.com", name: "sid", value: "shared-older", lastUpdate: 10 },
];

const mergedRows = [
  { host: "kept.com", value: "shared-newer", update: "90" },
  { host: "new.com", value: "live-new", update: "40" },
  { host: "replaced.com", value: "live-newer", update: "30" },
];

it("merges a live profile through a snapshot of its cookie database", async () => {
  const { shared, store, display } = await makeRoots();
  await writeCookieDatabase(sharedCookiePath(shared), sharedRows);
  await writeCookieDatabase(displayCookiePath(display(1)), liveRows);

  const report = await store.captureLive(display(1), { sqliteOnly: false });

  expect(report.merged).toEqual(["Default/Network/Cookies"]);
  expect(report.skipped).toEqual([]);
  expect(readCookies(sharedCookiePath(shared))).toEqual(mergedRows);
  expect(await readdir(join(shared, "Default/Network"))).toEqual(["Cookies"]);
});

it("falls back to a raw copy when the snapshot cannot be vacuumed", async () => {
  const attempts: string[] = [];
  const { shared, store, display } = await makeRoots({
    vacuumInto: (source) => {
      attempts.push(source);
      throw new Error("database is locked");
    },
  });
  await writeCookieDatabase(sharedCookiePath(shared), sharedRows);
  await writeCookieDatabase(displayCookiePath(display(1)), liveRows);

  const report = await store.captureLive(display(1), { sqliteOnly: true });

  expect(attempts).toContain(displayCookiePath(display(1)));
  expect(report.merged).toEqual(["Default/Network/Cookies"]);
  expect(readCookies(sharedCookiePath(shared))).toEqual(mergedRows);
  expect(await readdir(join(shared, "Default/Network"))).toEqual(["Cookies"]);
});

it("skips an entry whose snapshot does not pass quick_check", async () => {
  const { shared, store, display } = await makeRoots({
    vacuumInto: (_source, target) => writeFileSync(target, "not a database"),
  });
  await writeCookieDatabase(sharedCookiePath(shared), sharedRows);
  await writeCookieDatabase(displayCookiePath(display(1)), liveRows);

  const report = await store.captureLive(display(1), { sqliteOnly: true });

  expect(report.merged).toEqual([]);
  expect(report.replaced).toEqual([]);
  expect(report.skipped.map(({ entry }) => entry)).toEqual(["Default/Network/Cookies"]);
  expect(report.skipped[0]?.reason).toContain("snapshot");
  // The corrupt snapshot never becomes the shared cookie database.
  expect(readCookies(sharedCookiePath(shared))).toEqual([
    { host: "kept.com", value: "shared-newer", update: "90" },
    { host: "replaced.com", value: "shared-older", update: "10" },
  ]);
  expect(await readdir(join(shared, "Default/Network"))).toEqual(["Cookies"]);
});

it("leaves the directory entries alone when capturing sqlite only", async () => {
  const { shared, store, display } = await makeRoots();
  await mkdir(join(shared, "Default/Local Storage/leveldb"), { recursive: true });
  await writeFile(join(shared, "Default/Local Storage/leveldb/old.log"), "old");
  await writeCookieDatabase(displayCookiePath(display(1)), liveRows);
  await mkdir(join(display(1), "Default/Local Storage/leveldb"), { recursive: true });
  await writeFile(join(display(1), "Default/Local Storage/leveldb/new.log"), "new");

  const sqliteOnly = await store.captureLive(display(1), { sqliteOnly: true });

  expect(sqliteOnly.copied).toEqual(["Default/Network/Cookies"]);
  expect(await readdir(join(shared, "Default/Local Storage/leveldb"))).toEqual(["old.log"]);

  const full = await store.captureLive(display(1), { sqliteOnly: false });

  expect(full.replaced).toContain("Default/Local Storage");
  expect(await readdir(join(shared, "Default/Local Storage/leveldb"))).toEqual(["new.log"]);
  const remaining = await readdir(join(shared, "Default"));
  expect(remaining.some((name) => /\.(?:tmp|old|snap)-/u.test(name))).toBe(false);
});

it("does nothing when the live profile is missing", async () => {
  const { shared, store, display } = await makeRoots();

  const report = await store.captureLive(display(1), { sqliteOnly: false });

  expect(report).toEqual({ merged: [], replaced: [], copied: [], skipped: [] });
  await expect(stat(shared)).rejects.toThrow();
});

it("skips an unwritable entry instead of rejecting", async () => {
  const { shared, store, display } = await makeRoots();
  await writeCookieDatabase(displayCookiePath(display(2)), [
    { host: "example.com", name: "sid", value: "fresh", lastUpdate: 5 },
  ]);
  await writeFile(join(display(2), "Default/Login Data"), "login");
  await mkdir(join(shared, "Default/Network"), { recursive: true });
  // Only the cookie entry is unwritable; the rest of the capture still lands.
  await chmod(join(shared, "Default/Network"), 0o500);

  const report = await store.capture(2);

  expect(report.skipped.map(({ entry }) => entry)).toEqual([
    "Default/Network/Cookies",
  ]);
  expect(report.copied).toEqual(["Default/Login Data"]);
  expect(await readFile(join(shared, "Default/Login Data"), "utf8")).toBe("login");
});
