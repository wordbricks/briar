import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  type ComputerUseLoginStoreCommandRunner,
  exportComputerUseLoginStore,
  importComputerUseLoginStore,
  isComputerUseLoginStoreArchivePath,
} from "./computer-use-login-store-commands";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const temporary = async (prefix: string) => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

/** macOS has no /usr/bin/tar guarantee for GNU flags; PATH tar is enough. */
const tarBinary = "tar";

const runCommand: ComputerUseLoginStoreCommandRunner = (binary, commandArgs) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(binary, [...commandArgs], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
    });
  });

const cookieColumns = [
  "creation_utc",
  "host_key",
  "top_frame_site_key",
  "name",
  "value",
  "path",
  "source_scheme",
  "source_port",
  "last_update_utc",
  "has_cross_site_ancestor",
] as const;

const writeCookieDatabase = async (
  path: string,
  rows: readonly { host: string; value: string; lastUpdate: number }[],
) => {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE meta(key TEXT NOT NULL UNIQUE PRIMARY KEY, value TEXT)");
  database.prepare("INSERT INTO meta (key, value) VALUES ('version', '24')").run();
  database.exec(
    `CREATE TABLE cookies(${
      cookieColumns
        .map((name) => `${name} ${name === "last_update_utc" ? "INTEGER" : "TEXT"}`)
        .join(", ")
    })`,
  );
  database.exec(
    "CREATE UNIQUE INDEX cookies_unique_index ON cookies("
      + "host_key, top_frame_site_key, has_cross_site_ancestor, name, path,"
      + " source_scheme, source_port)",
  );
  const insert = database.prepare(
    `INSERT INTO cookies (${cookieColumns.join(", ")}) VALUES (${
      cookieColumns.map(() => "?").join(", ")
    })`,
  );
  for (const row of rows) {
    insert.run(...cookieColumns.map((column) => {
      if (column === "host_key") return row.host;
      if (column === "value") return row.value;
      if (column === "last_update_utc") return row.lastUpdate;
      if (column === "name") return "sid";
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

const readCookies = (path: string) => {
  const database = new DatabaseSync(path);
  const rows = database
    .prepare("SELECT host_key, value, last_update_utc FROM cookies ORDER BY host_key")
    .all() as { host_key: unknown; value: unknown; last_update_utc: unknown }[];
  database.close();
  return rows.map((row) => ({
    host: String(row.host_key),
    value: String(row.value),
    update: Number(row.last_update_utc),
  }));
};

const cookiePath = (profile: string) => join(profile, "Default/Network/Cookies");

const writeLoginData = async (path: string, origin: string) => {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE logins(origin_url TEXT, username_value TEXT)");
  database.prepare("INSERT INTO logins VALUES (?, 'owner')").run(origin);
  database.close();
};

const readLoginOrigins = (path: string) => {
  const database = new DatabaseSync(path);
  const rows = database.prepare("SELECT origin_url FROM logins").all() as {
    origin_url: unknown;
  }[];
  database.close();
  return rows.map((row) => String(row.origin_url));
};

/** A computer with a shared store and an owner display :1 profile. */
const makeComputer = async (prefix: string) => {
  const profiles = await temporary(prefix);
  return {
    profiles,
    shared: join(profiles, "shared"),
    primary: join(profiles, "display-1"),
  };
};

it("moves the shared store and the owner display logins to another computer", async () => {
  const source = await makeComputer("briar-login-export-");
  await writeCookieDatabase(cookiePath(source.shared), [
    { host: "shared.com", value: "from-shared", lastUpdate: 10 },
    { host: "both.com", value: "shared-older", lastUpdate: 20 },
  ]);
  await mkdir(join(source.shared, "Default/Local Storage/leveldb"), { recursive: true });
  await writeFile(join(source.shared, "Default/Local Storage/leveldb/000001.log"), "shared");
  await writeCookieDatabase(cookiePath(source.primary), [
    { host: "owner.com", value: "from-display-1", lastUpdate: 30 },
    { host: "both.com", value: "owner-newer", lastUpdate: 40 },
  ]);
  await writeLoginData(join(source.primary, "Default/Login Data"), "https://owner.com/");
  // Nothing outside the whitelist travels.
  await writeFile(join(source.primary, "Default/Preferences"), "{}");

  const archive = join(await temporary("briar-login-archive-"), "logins.tar.gz");
  const summary = await exportComputerUseLoginStore({
    outputPath: archive,
    profilesDirectory: source.profiles,
    tarBinary,
    runCommand,
  });

  expect(summary.shared).toEqual(["Default/Network/Cookies", "Default/Local Storage"]);
  expect(summary.primary).toEqual([
    "Default/Network/Cookies",
    "Default/Login Data",
  ]);
  expect((await stat(archive)).mode & 0o777).toBe(0o600);
  const listing = await runCommand(tarBinary, ["-tzf", archive]);
  expect(listing).not.toContain("Preferences");

  const target = await makeComputer("briar-login-import-");
  await writeCookieDatabase(cookiePath(target.shared), [
    { host: "target.com", value: "already-here", lastUpdate: 5 },
    { host: "both.com", value: "target-newest", lastUpdate: 90 },
  ]);

  const imported = await importComputerUseLoginStore({
    archivePath: archive,
    profilesDirectory: target.profiles,
    tarBinary,
    runCommand,
  });

  expect(imported.merged).toEqual([
    "Default/Network/Cookies",
    "Default/Network/Cookies",
  ]);
  expect(imported.skipped).toEqual([]);
  expect(readCookies(cookiePath(target.shared))).toEqual([
    { host: "both.com", value: "target-newest", update: 90 },
    { host: "owner.com", value: "from-display-1", update: 30 },
    { host: "shared.com", value: "from-shared", update: 10 },
    { host: "target.com", value: "already-here", update: 5 },
  ]);
  expect(
    await readFile(join(target.shared, "Default/Local Storage/leveldb/000001.log"), "utf8"),
  ).toBe("shared");
  expect(readLoginOrigins(join(target.shared, "Default/Login Data")))
    .toEqual(["https://owner.com/"]);
  // The live display-1 profile is a source only; import never writes into it.
  await expect(stat(target.primary)).rejects.toThrow();
});

it("refuses to overwrite an existing archive without --force", async () => {
  const source = await makeComputer("briar-login-force-");
  await writeCookieDatabase(cookiePath(source.shared), [
    { host: "shared.com", value: "one", lastUpdate: 1 },
  ]);
  const directory = await temporary("briar-login-archive-");
  const archive = join(directory, "logins.tar.gz");
  await writeFile(archive, "existing");

  await expect(exportComputerUseLoginStore({
    outputPath: archive,
    profilesDirectory: source.profiles,
    tarBinary,
    runCommand,
  })).rejects.toThrow("--force");
  expect(await readFile(archive, "utf8")).toBe("existing");

  const summary = await exportComputerUseLoginStore({
    outputPath: archive,
    profilesDirectory: source.profiles,
    force: true,
    tarBinary,
    runCommand,
  });
  expect(summary.archive).toBe(archive);
  expect(await readFile(archive, "utf8")).not.toBe("existing");
});

it("rejects an archive that escapes the login state layout", async () => {
  const staging = await temporary("briar-login-evil-");
  await mkdir(join(staging, "stage/shared/Default/Network"), { recursive: true });
  await writeFile(join(staging, "stage/shared/Default/Network/Cookies"), "not really");
  await writeFile(join(staging, "outside.txt"), "secret");
  const archive = join(staging, "evil.tar.gz");
  await runCommand(tarBinary, [
    "-czf",
    archive,
    "-C",
    join(staging, "stage"),
    "../outside.txt",
    "shared",
  ]);

  const target = await makeComputer("briar-login-evil-target-");
  await writeCookieDatabase(cookiePath(target.shared), [
    { host: "target.com", value: "untouched", lastUpdate: 5 },
  ]);

  await expect(importComputerUseLoginStore({
    archivePath: archive,
    profilesDirectory: target.profiles,
    tarBinary,
    runCommand,
  })).rejects.toThrow("outside.txt");
  expect(readCookies(cookiePath(target.shared))).toEqual([
    { host: "target.com", value: "untouched", update: 5 },
  ]);
  expect(await readdir(target.profiles)).toEqual(["shared"]);
});

it("rejects an archive holding a path outside the whitelist or a symlink", async () => {
  const staging = await temporary("briar-login-symlink-");
  const stage = join(staging, "stage");
  await mkdir(join(stage, "shared/Default/Network"), { recursive: true });
  await writeFile(join(stage, "shared/Default/Network/Cookies"), "not really");
  await symlink("/etc/passwd", join(stage, "shared/Default/Login Data"));
  const symlinked = join(staging, "symlinked.tar.gz");
  await runCommand(tarBinary, ["-czf", symlinked, "-C", stage, "."]);

  await mkdir(join(stage, "shared/Default/Extensions"), { recursive: true });
  await writeFile(join(stage, "shared/Default/Extensions/manifest.json"), "{}");
  const extra = join(staging, "extra.tar.gz");
  await runCommand(tarBinary, ["-czf", extra, "-C", stage, "."]);

  const target = await makeComputer("briar-login-symlink-target-");

  await expect(importComputerUseLoginStore({
    archivePath: symlinked,
    profilesDirectory: target.profiles,
    tarBinary,
    runCommand,
  })).rejects.toThrow("regular file");

  await expect(importComputerUseLoginStore({
    archivePath: extra,
    profilesDirectory: target.profiles,
    tarBinary,
    runCommand,
  })).rejects.toThrow("Extensions");

  await expect(stat(target.shared)).rejects.toThrow();
});

it("accepts only the login state layout in archive member names", () => {
  expect(isComputerUseLoginStoreArchivePath("./shared/Default/Network/Cookies")).toBe(true);
  expect(isComputerUseLoginStoreArchivePath("shared/Default/Network/Cookies-wal")).toBe(true);
  expect(isComputerUseLoginStoreArchivePath("display-1/Default/Login Data")).toBe(true);
  expect(isComputerUseLoginStoreArchivePath("display-1/Default/IndexedDB/site/1.ldb")).toBe(true);
  expect(isComputerUseLoginStoreArchivePath("./shared/Default/")).toBe(true);
  expect(isComputerUseLoginStoreArchivePath("../outside.txt")).toBe(false);
  expect(isComputerUseLoginStoreArchivePath("/etc/passwd")).toBe(false);
  expect(isComputerUseLoginStoreArchivePath("shared/../../etc/passwd")).toBe(false);
  expect(isComputerUseLoginStoreArchivePath("display-2/Default/Network/Cookies")).toBe(false);
  expect(isComputerUseLoginStoreArchivePath("shared/Default/Preferences")).toBe(false);
  expect(isComputerUseLoginStoreArchivePath("home/briar/.ssh/id_ed25519")).toBe(false);
});
