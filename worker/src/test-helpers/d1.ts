import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

type ApplyD1MigrationsOptions = {
  files?: readonly string[];
  exclude?: readonly string[];
  through?: string;
};

type TemplateFile = {
  path: string;
  bytes: number;
  sha256: string;
};

type TemplateManifest = {
  formatVersion: number;
  fingerprint: string;
  migrations: string[];
  runtimes: {
    miniflare: string;
    wrangler: string;
  };
  bindingConfig: typeof TEMPLATE_BINDING_CONFIG;
  files: TemplateFile[];
  schemaObjects: number;
};

export type D1TestTemplate = {
  fingerprint: string;
  directory: string;
  cacheHit: boolean;
  migrationPreparationMs: number;
  manifest: TemplateManifest;
};

export type IsolatedTestDatabase = {
  miniflare: Miniflare;
  db: D1Database;
  persistencePath: string | null;
  fingerprint: string | null;
  templateUsed: boolean;
  cloneMs: number;
  dispose: () => Promise<void>;
};

type CreateIsolatedTestDatabaseOptions = {
  suite: string;
  miniflareOptions?: MiniflareOptions;
};

const TEMPLATE_FORMAT_VERSION = 1;
const TEMPLATE_DATABASE_ID = "briar-d1-test-template";
const TEMPLATE_BINDING_CONFIG = {
  binding: "DB",
  databaseId: TEMPLATE_DATABASE_ID,
  modules: true,
  script: "export default { fetch() { return new Response('ok') } }",
} as const;
const MANIFEST_FILE = "manifest.json";
const PERSISTENCE_DIRECTORY = "persistence";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_STALE_MS = 10 * 60_000;
const LOCK_WAIT_MS = 5 * 60_000;
const LOCK_POLL_MS = 100;

const metrics = {
  databaseClones: 0,
  cloneTimeMs: 0,
  migrationPreparationMs: 0,
};

let metricsReporterInstalled = false;

function installMetricsReporter() {
  if (metricsReporterInstalled) return;
  metricsReporterInstalled = true;
  process.once("exit", () => {
    if (metrics.databaseClones === 0 && metrics.migrationPreparationMs === 0) return;
    console.info(
      `[d1-test] database clones: ${metrics.databaseClones}; ` +
        `clone time total: ${(metrics.cloneTimeMs / 1_000).toFixed(3)}s; ` +
        `migration preparation: ${(metrics.migrationPreparationMs / 1_000).toFixed(3)}s`,
    );
  });
}

const sleep = (milliseconds: number) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function cacheRoot() {
  const configuredRoot = process.env.BRIAR_D1_TEST_CACHE_DIR?.trim();
  const parent = configuredRoot ? resolve(configuredRoot) : tmpdir();
  return join(parent, `briar-d1-test-templates-v${TEMPLATE_FORMAT_VERSION}`);
}

function assertManagedCachePath(path: string) {
  const resolvedPath = resolve(path);
  const expectedName = `briar-d1-test-templates-v${TEMPLATE_FORMAT_VERSION}`;
  if (basename(resolvedPath) !== expectedName || dirname(resolvedPath) === resolvedPath) {
    throw new Error(`Refusing to manage unexpected D1 test cache path: ${resolvedPath}`);
  }
  return resolvedPath;
}

async function packageVersion(packageName: "miniflare" | "wrangler") {
  const entryUrl = import.meta.resolve(packageName);
  let current = dirname(fileURLToPath(entryUrl));
  while (dirname(current) !== current) {
    try {
      const packageJson = JSON.parse(
        await readFile(join(current, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (packageJson.name === packageName && packageJson.version) {
        return packageJson.version;
      }
    } catch {
      // Keep walking to the package root.
    }
    current = dirname(current);
  }
  throw new Error(`Unable to resolve ${packageName} version for the D1 template`);
}

async function migrationFiles() {
  return (await readdir(resolve("migrations")))
    .filter((name) => /^\d+_.*\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right));
}

async function templateFingerprint() {
  const [files, miniflareVersion, wranglerVersion] = await Promise.all([
    migrationFiles(),
    packageVersion("miniflare"),
    packageVersion("wrangler"),
  ]);
  const hash = createHash("sha256");
  hash.update(`d1-test-template-format:${TEMPLATE_FORMAT_VERSION}\0`);
  hash.update(JSON.stringify(TEMPLATE_BINDING_CONFIG));
  hash.update("\0");
  hash.update(`miniflare:${miniflareVersion}\0wrangler:${wranglerVersion}\0`);
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(resolve("migrations", file)));
    hash.update("\0");
  }
  return {
    fingerprint: hash.digest("hex"),
    files,
    miniflareVersion,
    wranglerVersion,
  };
}

async function listTemplateFiles(root: string, current = root): Promise<TemplateFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: TemplateFile[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`D1 template contains an unexpected symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listTemplateFiles(root, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`D1 template contains an unexpected filesystem entry: ${path}`);
    }
    const contents = await readFile(path);
    files.push({
      path: relative(root, path).split(sep).join("/"),
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }
  return files;
}

async function chmodTree(root: string, writable: boolean) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await chmodTree(path, writable);
      await chmod(path, writable ? 0o700 : 0o500);
    } else if (entry.isFile()) {
      await chmod(path, writable ? 0o600 : 0o400);
    }
  }
  await chmod(root, writable ? 0o700 : 0o500);
}

async function removeTemplateDirectory(directory: string) {
  try {
    await chmodTree(directory, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rm(directory, { recursive: true, force: true });
}

async function readValidTemplate(
  directory: string,
  expected: Awaited<ReturnType<typeof templateFingerprint>>,
): Promise<TemplateManifest | null> {
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, MANIFEST_FILE), "utf8"),
    ) as TemplateManifest;
    if (
      manifest.formatVersion !== TEMPLATE_FORMAT_VERSION ||
      manifest.fingerprint !== expected.fingerprint ||
      JSON.stringify(manifest.migrations) !== JSON.stringify(expected.files) ||
      manifest.runtimes?.miniflare !== expected.miniflareVersion ||
      manifest.runtimes?.wrangler !== expected.wranglerVersion ||
      JSON.stringify(manifest.bindingConfig) !== JSON.stringify(TEMPLATE_BINDING_CONFIG) ||
      !Number.isInteger(manifest.schemaObjects) ||
      manifest.schemaObjects < 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.length === 0
    ) return null;
    const observedFiles = await listTemplateFiles(
      join(directory, PERSISTENCE_DIRECTORY),
    );
    if (JSON.stringify(observedFiles) !== JSON.stringify(manifest.files)) return null;
    return manifest;
  } catch {
    return null;
  }
}

type TemplateLockOwner = {
  pid: number;
  token: string;
  createdAt: string;
};

async function readTemplateLockOwner(lockPath: string) {
  try {
    const owner = JSON.parse(
      await readFile(join(lockPath, LOCK_OWNER_FILE), "utf8"),
    ) as Partial<TemplateLockOwner>;
    if (
      !Number.isInteger(owner.pid) ||
      (owner.pid ?? 0) <= 0 ||
      typeof owner.token !== "string" ||
      typeof owner.createdAt !== "string"
    ) return null;
    return owner as TemplateLockOwner;
  } catch {
    return null;
  }
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function acquireTemplateLock(lockPath: string) {
  const startedAt = Date.now();
  while (true) {
    const owner: TemplateLockOwner = {
      pid: process.pid,
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    try {
      await mkdir(lockPath);
      try {
        await writeFile(
          join(lockPath, LOCK_OWNER_FILE),
          `${JSON.stringify(owner)}\n`,
          { flag: "wx" },
        );
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return owner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    try {
      const lockStat = await stat(lockPath);
      const existingOwner = await readTemplateLockOwner(lockPath);
      const abandoned = existingOwner
        ? !processIsRunning(existingOwner.pid)
        : Date.now() - lockStat.mtimeMs > 1_000;
      if (abandoned || Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
        await rm(lockPath, { recursive: true });
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    if (Date.now() - startedAt > LOCK_WAIT_MS) {
      throw new Error("Timed out waiting for another process to prepare the D1 template");
    }
    await sleep(LOCK_POLL_MS);
  }
}

async function releaseTemplateLock(
  lockPath: string,
  owner: TemplateLockOwner,
) {
  const observedOwner = await readTemplateLockOwner(lockPath);
  if (observedOwner?.token !== owner.token) return;
  await rm(lockPath, { recursive: true, force: true });
}

async function verifyPreparedDatabase(db: D1Database) {
  const integrity = await db.prepare("PRAGMA quick_check").first<Record<string, unknown>>();
  if (!integrity || !Object.values(integrity).includes("ok")) {
    throw new Error("D1 template failed SQLite quick_check");
  }
  const schemaObjects = await db.prepare(
    `select count(*) as count from sqlite_master
     where type in ('table', 'index', 'trigger') and name not like 'sqlite_%'`,
  ).first<number>("count");
  if (!schemaObjects || schemaObjects < 1) {
    throw new Error("D1 template contains no application schema objects");
  }
  return schemaObjects;
}

async function buildTemplate(
  temporaryDirectory: string,
  fingerprint: Awaited<ReturnType<typeof templateFingerprint>>,
) {
  const persistencePath = join(temporaryDirectory, PERSISTENCE_DIRECTORY);
  await mkdir(persistencePath, { recursive: true });
  const miniflare = new Miniflare({
    modules: TEMPLATE_BINDING_CONFIG.modules,
    script: TEMPLATE_BINDING_CONFIG.script,
    d1Databases: { DB: TEMPLATE_DATABASE_ID },
    resourcePersistencePath: persistencePath,
  });
  let schemaObjects: number;
  try {
    const db = await miniflare.getD1Database("DB") as unknown as D1Database;
    await applyD1Migrations(db);
    schemaObjects = await verifyPreparedDatabase(db);
  } finally {
    await miniflare.dispose();
  }
  const files = await listTemplateFiles(persistencePath);
  if (files.length === 0) throw new Error("Miniflare did not persist the D1 template");
  const manifest: TemplateManifest = {
    formatVersion: TEMPLATE_FORMAT_VERSION,
    fingerprint: fingerprint.fingerprint,
    migrations: fingerprint.files,
    runtimes: {
      miniflare: fingerprint.miniflareVersion,
      wrangler: fingerprint.wranglerVersion,
    },
    bindingConfig: TEMPLATE_BINDING_CONFIG,
    files,
    schemaObjects,
  };
  await writeFile(
    join(temporaryDirectory, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  await chmodTree(temporaryDirectory, false);
  return manifest;
}

export async function prepareD1TestTemplate(): Promise<D1TestTemplate> {
  installMetricsReporter();
  const startedAt = performance.now();
  const fingerprint = await templateFingerprint();
  const root = assertManagedCachePath(cacheRoot());
  const directory = join(root, fingerprint.fingerprint);
  await mkdir(root, { recursive: true });

  const cachedManifest = await readValidTemplate(directory, fingerprint);
  if (cachedManifest) {
    console.info(`[d1-test] fingerprint: ${fingerprint.fingerprint}`);
    console.info("[d1-test] template: cache hit");
    return {
      fingerprint: fingerprint.fingerprint,
      directory,
      cacheHit: true,
      migrationPreparationMs: performance.now() - startedAt,
      manifest: cachedManifest,
    };
  }

  const lockPath = `${directory}.lock`;
  const lockOwner = await acquireTemplateLock(lockPath);
  try {
    const manifestAfterLock = await readValidTemplate(
      directory,
      fingerprint,
    );
    if (manifestAfterLock) {
      console.info(`[d1-test] fingerprint: ${fingerprint.fingerprint}`);
      console.info("[d1-test] template: cache hit after waiting for creator");
      return {
        fingerprint: fingerprint.fingerprint,
        directory,
        cacheHit: true,
        migrationPreparationMs: performance.now() - startedAt,
        manifest: manifestAfterLock,
      };
    }

    await removeTemplateDirectory(directory);
    const temporaryDirectory = await mkdtemp(join(root, ".building-"));
    let manifest: TemplateManifest;
    try {
      manifest = await buildTemplate(temporaryDirectory, fingerprint);
      await rename(temporaryDirectory, directory);
    } catch (error) {
      await removeTemplateDirectory(temporaryDirectory);
      throw error;
    }
    const migrationPreparationMs = performance.now() - startedAt;
    metrics.migrationPreparationMs += migrationPreparationMs;
    console.info(`[d1-test] fingerprint: ${fingerprint.fingerprint}`);
    console.info(
      `[d1-test] template: cache miss; generated in ${(migrationPreparationMs / 1_000).toFixed(3)}s`,
    );
    return {
      fingerprint: fingerprint.fingerprint,
      directory,
      cacheHit: false,
      migrationPreparationMs,
      manifest,
    };
  } finally {
    await releaseTemplateLock(lockPath, lockOwner);
  }
}

async function cloneTemplate(template: D1TestTemplate, suite: string) {
  const cloneStartedAt = performance.now();
  const safeSuite = suite.replace(/[^a-zA-Z0-9_-]+/gu, "-").slice(0, 60) || "suite";
  const cloneDirectory = await mkdtemp(join(tmpdir(), `briar-d1-${safeSuite}-`));
  const persistencePath = join(cloneDirectory, PERSISTENCE_DIRECTORY);
  try {
    await cp(
      join(template.directory, PERSISTENCE_DIRECTORY),
      persistencePath,
      { recursive: true, preserveTimestamps: true },
    );
    await chmodTree(persistencePath, true);
  } catch (error) {
    await rm(cloneDirectory, { recursive: true, force: true });
    throw error;
  }
  const cloneMs = performance.now() - cloneStartedAt;
  metrics.databaseClones += 1;
  metrics.cloneTimeMs += cloneMs;
  console.info(`[d1-test] clone ${safeSuite}: ${(cloneMs / 1_000).toFixed(3)}s`);
  return { cloneDirectory, persistencePath, cloneMs };
}

function localMiniflareOptions(options: MiniflareOptions | undefined) {
  const {
    d1Databases: _ignoredD1Databases,
    resourcePersistencePath: _ignoredPersistencePath,
    ...rest
  } = (options ?? {}) as Record<string, unknown>;
  return {
    modules: TEMPLATE_BINDING_CONFIG.modules,
    script: TEMPLATE_BINDING_CONFIG.script,
    ...rest,
  } as MiniflareOptions;
}

async function createFallbackDatabase(
  suite: string,
  miniflareOptions: MiniflareOptions | undefined,
  reason: unknown,
): Promise<IsolatedTestDatabase> {
  console.warn(
    `[d1-test] template unavailable for ${suite}; falling back to full migrations: ${
      reason instanceof Error ? reason.message : String(reason)
    }`,
  );
  const miniflare = new Miniflare({
    ...localMiniflareOptions(miniflareOptions),
    d1Databases: { DB: `briar-d1-fallback-${suite}-${randomUUID()}` },
  });
  let db: D1Database;
  try {
    db = await miniflare.getD1Database("DB") as unknown as D1Database;
    await applyD1Migrations(db);
  } catch (error) {
    try {
      await miniflare.dispose();
    } catch (disposeError) {
      throw new AggregateError(
        [error, disposeError],
        "Fallback D1 setup and cleanup both failed",
      );
    }
    throw error;
  }
  return {
    miniflare,
    db,
    persistencePath: null,
    fingerprint: null,
    templateUsed: false,
    cloneMs: 0,
    dispose: async () => miniflare.dispose(),
  };
}

export async function createIsolatedTestDatabase(
  options: CreateIsolatedTestDatabaseOptions,
): Promise<IsolatedTestDatabase> {
  if (process.env.BRIAR_D1_TEST_DISABLE_TEMPLATE === "1") {
    return createFallbackDatabase(
      options.suite,
      options.miniflareOptions,
      "disabled by BRIAR_D1_TEST_DISABLE_TEMPLATE",
    );
  }

  let cloneDirectory: string | undefined;
  let clonedMiniflare: Miniflare | undefined;
  try {
    const template = await prepareD1TestTemplate();
    const clone = await cloneTemplate(template, options.suite);
    cloneDirectory = clone.cloneDirectory;
    const miniflare = new Miniflare({
      ...localMiniflareOptions(options.miniflareOptions),
      d1Databases: { DB: TEMPLATE_DATABASE_ID },
      resourcePersistencePath: clone.persistencePath,
    });
    clonedMiniflare = miniflare;
    const db = await miniflare.getD1Database("DB") as unknown as D1Database;
    await verifyPreparedDatabase(db);
    const disposeMiniflare = miniflare.dispose.bind(miniflare);
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      try {
        await disposeMiniflare();
      } finally {
        await rm(clone.cloneDirectory, { recursive: true, force: true });
      }
    };
    miniflare.dispose = dispose;
    return {
      miniflare,
      db,
      persistencePath: clone.persistencePath,
      fingerprint: template.fingerprint,
      templateUsed: true,
      cloneMs: clone.cloneMs,
      dispose,
    };
  } catch (error) {
    let fallbackReason = error;
    if (clonedMiniflare) {
      try {
        await clonedMiniflare.dispose();
      } catch (disposeError) {
        fallbackReason = new AggregateError(
          [error, disposeError],
          "Template clone setup and cleanup both failed",
        );
      }
    }
    if (cloneDirectory) {
      try {
        await rm(cloneDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        fallbackReason = new AggregateError(
          [fallbackReason, cleanupError],
          "Template clone setup and directory cleanup both failed",
        );
      }
    }
    return createFallbackDatabase(
      options.suite,
      options.miniflareOptions,
      fallbackReason,
    );
  }
}

export async function cleanD1TestTemplates() {
  const root = assertManagedCachePath(cacheRoot());
  try {
    const entries = await readdir(root);
    for (const entry of entries) {
      const path = join(root, entry);
      if (entry.endsWith(".lock")) await rm(path, { recursive: true, force: true });
      else await removeTemplateDirectory(path);
    }
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  console.info(`[d1-test] removed template cache: ${root}`);
}

export async function executeD1Sql(db: D1Database, sql: string) {
  for (const statement of unstable_splitSqlQuery(sql)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
}

export async function applyD1Migrations(
  db: D1Database,
  options: ApplyD1MigrationsOptions = {},
) {
  const excluded = new Set(options.exclude ?? []);
  const files = (options.files
    ? [...options.files]
    : await migrationFiles())
    .filter((name) => !options.through || name.localeCompare(options.through) <= 0);

  for (const file of files) {
    if (excluded.has(file)) continue;
    const sql = await readFile(resolve("migrations", file), "utf8");
    await executeD1Sql(db, sql);
  }
}
