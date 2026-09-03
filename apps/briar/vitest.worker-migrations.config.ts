import { defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./vitest.max-workers";
import { createWorkerTestPlugin } from "./vitest.worker.shared";

export default defineConfig(async () => ({
  plugins: [await createWorkerTestPlugin()],
  test: {
    name: "worker-migrations",
    include: ["worker/src/migration-suites/*.migration.test.ts"],
    hookTimeout: 60_000,
    // Four domain entries amortize workerd startup across the cutover cases
    // while retaining bounded parallelism for standalone migration runs.
    maxWorkers: resolveMaxWorkers(4),
    testTimeout: 60_000,
  },
}));
