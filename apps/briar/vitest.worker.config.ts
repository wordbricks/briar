import { configDefaults, defineConfig } from "vitest/config";
import { createWorkerTestPlugin } from "./vitest.worker.shared";

const migrationTestGlobs = [
  "worker/src/**/*.migration.test.ts",
  "worker/src/db.test.ts",
  "worker/src/workflow-v2.test.ts",
];

export default defineConfig(async () => ({
  plugins: [await createWorkerTestPlugin()],
  test: {
    name: "worker",
    include: ["worker/src/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      ...migrationTestGlobs,
      "worker/src/html-artifact-preview-shell.test.ts",
    ],
    // Setup runs outside per-file storage isolation, so every isolated test
    // database starts from the same fully migrated schema.
    setupFiles: ["./worker/src/test-setup.ts"],
    hookTimeout: 60_000,
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
    testTimeout: 15_000,
  },
}));
