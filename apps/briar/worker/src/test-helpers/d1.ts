import { execFile } from "node:child_process";
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
  builder: typeof TEMPLATE_BUILDER;
  migrations: string[];
  runtimes: {
    miniflare: string;
    wrangler: string;
    platform: NodeJS.Platform;
    architecture: string;
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

interface WranglerLocalEnvironment {
  [name: string]: string | undefined;
}

const TEMPLATE_FORMAT_VERSION = 3;
const TEMPLATE_BUILDER = "wrangler-local";
const TEMPLATE_DATABASE_ID = "00000000-0000-4000-8000-000000000001";
const TEMPLATE_DATABASE_NAME = "briar-d1-test-template";
const TEMPLATE_COMPATIBILITY_DATE = "2026-07-21";
const TEMPLATE_BINDING_CONFIG = {
  binding: "DB",
  databaseId: TEMPLATE_DATABASE_ID,
  modules: true,
  script: "export default { fetch() { return new Response('ok') } }",
} as const;
const MANIFEST_FILE = "manifest.json";
const PERSISTENCE_PARENT_DIRECTORY = "persistence";
const PERSISTENCE_DIRECTORY = join(PERSISTENCE_PARENT_DIRECTORY, "v3");
const WRANGLER_CONFIG_FILE = "wrangler.d1-test.json";
const WRANGLER_TIMEOUT_MS = 5 * 60_000;
const WRANGLER_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const WRANGLER_FAILURE_LOG_LINES = 40;
const WRANGLER_LOCAL_ENVIRONMENT_VARIABLES = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TZ",
  "USER",
] as const;
const LOCK_OWNER_FILE = "owner.json";
const LOCK_STALE_MS = 10 * 60_000;
const LOCK_WAIT_MS = 5 * 60_000;
const LOCK_POLL_MS = 100;
const D1_SQL_BATCH_SIZE = 100;

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
  hash.update(`builder:${TEMPLATE_BUILDER}\0`);
  hash.update(JSON.stringify(TEMPLATE_BINDING_CONFIG));
  hash.update("\0");
  hash.update(`miniflare:${miniflareVersion}\0wrangler:${wranglerVersion}\0`);
  hash.update(`platform:${process.platform}\0architecture:${process.arch}\0`);
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
      manifest.builder !== TEMPLATE_BUILDER ||
      JSON.stringify(manifest.migrations) !== JSON.stringify(expected.files) ||
      manifest.runtimes?.miniflare !== expected.miniflareVersion ||
      manifest.runtimes?.wrangler !== expected.wranglerVersion ||
      manifest.runtimes?.platform !== process.platform ||
      manifest.runtimes?.architecture !== process.arch ||
      JSON.stringify(manifest.bindingConfig) !== JSON.stringify(TEMPLATE_BINDING_CONFIG) ||
      !Number.isInteger(manifest.schemaObjects) ||
      manifest.schemaObjects < 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.length === 0
    ) return null;
    const observedFiles = await listTemplateFiles(
      join(directory, PERSISTENCE_PARENT_DIRECTORY),
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

async function verifyPreparedDatabase(
  db: D1Database,
  expectedMigrations?: readonly string[],
) {
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
  if (expectedMigrations) {
    const migrationHistory = await db.prepare(
      "select name from d1_migrations order by id",
    ).all<{ name: string }>();
    const observedMigrations = migrationHistory.results.map(({ name }) => name);
    if (JSON.stringify(observedMigrations) !== JSON.stringify(expectedMigrations)) {
      throw new Error(
        `D1 template migration history mismatch: expected ${expectedMigrations.length}, ` +
          `observed ${observedMigrations.length}`,
      );
    }
  }
  return schemaObjects;
}

function localWranglerEnvironment() {
  const environment: WranglerLocalEnvironment = {
    CI: "true",
    NO_COLOR: "1",
    NO_D1_WARNING: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  for (const variable of WRANGLER_LOCAL_ENVIRONMENT_VARIABLES) {
    const value = process.env[variable];
    if (value !== undefined) environment[variable] = value;
  }
  return environment as NodeJS.ProcessEnv;
}

function wranglerFailureOutput(stdout: string, stderr: string) {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-WRANGLER_FAILURE_LOG_LINES).join("\n");
}

async function applyWranglerLocalMigrations(
  temporaryDirectory: string,
  migrationCount: number,
) {
  const persistenceParent = join(
    temporaryDirectory,
    PERSISTENCE_PARENT_DIRECTORY,
  );
  const configPath = join(temporaryDirectory, WRANGLER_CONFIG_FILE);
  await mkdir(persistenceParent, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({
      name: TEMPLATE_DATABASE_NAME,
      compatibility_date: TEMPLATE_COMPATIBILITY_DATE,
      d1_databases: [
        {
          binding: "DB",
          database_name: TEMPLATE_DATABASE_NAME,
          database_id: TEMPLATE_DATABASE_ID,
          migrations_dir: resolve("migrations"),
        },
      ],
    }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );

  const startedAt = performance.now();
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      execFile(
        resolve("node_modules/.bin/wrangler"),
        [
          "d1",
          "migrations",
          "apply",
          "DB",
          "--local",
          "--persist-to",
          persistenceParent,
          "--config",
          configPath,
          "--experimental-auto-create=false",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: localWranglerEnvironment(),
          maxBuffer: WRANGLER_MAX_OUTPUT_BYTES,
          timeout: WRANGLER_TIMEOUT_MS,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolvePromise();
            return;
          }
          const diagnostic = wranglerFailureOutput(stdout, stderr);
          const timedOut = error.killed && error.signal !== null;
          rejectPromise(new Error(
            timedOut
              ? `Wrangler local D1 migrations timed out after ${WRANGLER_TIMEOUT_MS / 1_000}s ` +
                `on ${process.platform}-${process.arch}`
              : `Wrangler local D1 migrations failed with exit code ${error.code ?? "unknown"} ` +
                `on ${process.platform}-${process.arch}` +
                (diagnostic ? `:\n${diagnostic}` : ""),
            { cause: error },
          ));
        },
      );
    });
  } finally {
    await rm(configPath, { force: true });
  }
  const elapsedMs = performance.now() - startedAt;
  console.info(
    `[d1-test] Wrangler local migrations: ${migrationCount}; ` +
      `platform: ${process.platform}-${process.arch}; ` +
      `elapsed: ${(elapsedMs / 1_000).toFixed(3)}s`,
  );
}

async function buildTemplate(
  temporaryDirectory: string,
  fingerprint: Awaited<ReturnType<typeof templateFingerprint>>,
) {
  const persistencePath = join(temporaryDirectory, PERSISTENCE_DIRECTORY);
  await applyWranglerLocalMigrations(
    temporaryDirectory,
    fingerprint.files.length,
  );
  const miniflare = new Miniflare({
    modules: TEMPLATE_BINDING_CONFIG.modules,
    script: TEMPLATE_BINDING_CONFIG.script,
    d1Databases: { DB: TEMPLATE_DATABASE_ID },
    resourcePersistencePath: persistencePath,
  });
  let schemaObjects: number;
  try {
    const db = await miniflare.getD1Database("DB") as unknown as D1Database;
    schemaObjects = await verifyPreparedDatabase(db, fingerprint.files);
  } finally {
    await miniflare.dispose();
  }
  const files = await listTemplateFiles(
    join(temporaryDirectory, PERSISTENCE_PARENT_DIRECTORY),
  );
  if (files.length === 0) throw new Error("Miniflare did not persist the D1 template");
  const manifest: TemplateManifest = {
    formatVersion: TEMPLATE_FORMAT_VERSION,
    fingerprint: fingerprint.fingerprint,
    builder: TEMPLATE_BUILDER,
    migrations: fingerprint.files,
    runtimes: {
      miniflare: fingerprint.miniflareVersion,
      wrangler: fingerprint.wranglerVersion,
      platform: process.platform,
      architecture: process.arch,
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
      // macOS requires write permission on a directory to rename it.
      await chmod(temporaryDirectory, 0o700);
      await rename(temporaryDirectory, directory);
      await chmodTree(directory, false);
    } catch (error) {
      await removeTemplateDirectory(temporaryDirectory);
      await removeTemplateDirectory(directory);
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
    await verifyPreparedDatabase(db, template.manifest.migrations);
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
    const reason = fallbackReason instanceof Error
      ? fallbackReason.message
      : String(fallbackReason);
    throw new Error(
      `[d1-test] template setup failed for ${options.suite}; ` +
        `automatic full-migration fallback is disabled: ${reason}`,
      { cause: fallbackReason },
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

function splitD1Sql(sql: string) {
  return unstable_splitSqlQuery(sql).filter((statement) => statement.trim());
}

function sqlWithoutLeadingComments(statement: string) {
  return statement.replace(
    /^(?:\s+|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/u,
    "",
  );
}

function deferForeignKeysSetting(statement: string) {
  const match = sqlWithoutLeadingComments(statement).match(
    /^pragma\s+(?:\w+\.)?defer_foreign_keys\s*=\s*(on|off|true|false|yes|no|1|0)\b/iu,
  );
  if (!match) return null;
  return /^(?:on|true|yes|1)$/iu.test(match[1]!) ? "on" : "off";
}

function isD1BatchBarrier(statement: string) {
  return /^(?:pragma|begin|commit|end|rollback|savepoint|release|vacuum|attach|detach)\b/iu.test(
    sqlWithoutLeadingComments(statement),
  );
}

function hasUnsafeDeferredForeignKeysRegion(statements: readonly string[]) {
  let deferred = false;
  for (const statement of statements) {
    const setting = deferForeignKeysSetting(statement);
    if (setting === "on") {
      if (deferred) return true;
      deferred = true;
      continue;
    }
    if (setting === "off") {
      if (!deferred) return true;
      deferred = false;
      continue;
    }
    if (deferred && isD1BatchBarrier(statement)) return true;
  }
  return deferred;
}

async function executeD1StatementsSequentially(
  db: D1Database,
  statements: readonly string[],
) {
  for (const statement of statements) await db.prepare(statement).run();
}

async function executeD1Batch(
  db: D1Database,
  statements: readonly string[],
) {
  if (statements.length === 0) return;
  try {
    await db.batch(statements.map((statement) => db.prepare(statement)));
  } catch {
    // D1 batches are transactions. Replaying a rolled-back failed batch keeps
    // executeD1Sql's historical partial-success boundary: statements before
    // the failing statement remain committed, and later statements do not run.
    await executeD1StatementsSequentially(db, statements);
  }
}

type D1StatementQueue = {
  pending: string[];
};

async function flushD1StatementQueue(db: D1Database, queue: D1StatementQueue) {
  if (queue.pending.length === 0) return;
  const statements = queue.pending.splice(0);
  await executeD1Batch(db, statements);
}

async function queueD1Statements(
  db: D1Database,
  queue: D1StatementQueue,
  statements: readonly string[],
) {
  if (hasUnsafeDeferredForeignKeysRegion(statements)) {
    await flushD1StatementQueue(db, queue);
    await executeD1StatementsSequentially(db, statements);
    return;
  }

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    const deferSetting = deferForeignKeysSetting(statement);
    if (deferSetting === "on") {
      await flushD1StatementQueue(db, queue);
      const deferredStatements = [statement];
      let deferOffStatement: string;
      while (true) {
        index += 1;
        const nextStatement = statements[index]!;
        if (deferForeignKeysSetting(nextStatement) === "off") {
          deferOffStatement = nextStatement;
          break;
        }
        deferredStatements.push(nextStatement);
      }
      // defer_foreign_keys resets at COMMIT, so this region must not be split
      // across the normal chunk boundary. Keep the OFF statement outside the
      // transaction so COMMIT still checks for unresolved foreign keys.
      await executeD1Batch(db, deferredStatements);
      await db.prepare(deferOffStatement).run();
      continue;
    }

    if (isD1BatchBarrier(statement)) {
      await flushD1StatementQueue(db, queue);
      await db.prepare(statement).run();
      continue;
    }

    queue.pending.push(statement);
    if (queue.pending.length === D1_SQL_BATCH_SIZE) {
      await flushD1StatementQueue(db, queue);
    }
  }
}

export async function executeD1Sql(db: D1Database, sql: string) {
  const queue: D1StatementQueue = { pending: [] };
  await queueD1Statements(db, queue, splitD1Sql(sql));
  await flushD1StatementQueue(db, queue);
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

  const queue: D1StatementQueue = { pending: [] };
  for (const file of files) {
    if (excluded.has(file)) continue;
    let statements: string[];
    try {
      const sql = await readFile(resolve("migrations", file), "utf8");
      statements = splitD1Sql(sql);
    } catch (error) {
      await flushD1StatementQueue(db, queue);
      throw error;
    }
    await queueD1Statements(db, queue, statements);
  }
  await flushD1StatementQueue(db, queue);
}
