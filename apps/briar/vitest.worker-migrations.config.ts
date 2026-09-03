import { defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./vitest.max-workers";
import { createWorkerTestPlugin } from "./vitest.worker.shared";

export default defineConfig(async () => ({
  plugins: [await createWorkerTestPlugin()],
  test: {
    name: "worker-migrations",
    include: ["worker/src/**/*.migration.test.ts"],
    hookTimeout: 60_000,
    // Capped: each worker boots its own workerd + isolated D1, so past ~8
    // the process overhead outweighs the added parallelism.
    maxWorkers: resolveMaxWorkers(8),
    testTimeout: 60_000,
  },
}));
