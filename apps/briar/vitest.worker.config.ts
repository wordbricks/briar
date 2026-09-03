import { configDefaults, defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./vitest.max-workers";
import { createWorkerTestPlugin } from "./vitest.worker.shared";
import { workerD1TestFiles } from "./vitest.worker.test-files";

const migrationTestGlobs = [
  "worker/src/**/*.migration.test.ts",
  "worker/src/db.test.ts",
  "worker/src/workflow-v2.test.ts",
];

export default defineConfig(async () => ({
  plugins: [await createWorkerTestPlugin({ migrations: false })],
  test: {
    name: "worker-unit",
    include: ["worker/src/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      ...migrationTestGlobs,
      ...workerD1TestFiles,
      "worker/src/html-artifact-preview-shell.test.ts",
    ],
    hookTimeout: 60_000,
    // These tests never touch D1, so the module registry and the workerd
    // runtime can be shared across files. Vitest otherwise builds a fresh
    // Miniflare instance - a new workerd process - for every test file, which
    // cost about 0.9s of boot plus a full re-import of each file's module graph
    // (60 workerd boots and 342s of cumulative import time, versus 8 boots and
    // 118s here). The D1 projects keep the default isolation because they
    // depend on starting from an empty database.
    isolate: false,
    // Avoid contending with the SQLite-heavy D1 project for workerd processes.
    sequence: { groupOrder: 0 },
    // Capped: each worker boots its own workerd, so past ~8 the process
    // overhead outweighs the added parallelism.
    maxWorkers: resolveMaxWorkers(8),
    testTimeout: 15_000,
  },
}));
