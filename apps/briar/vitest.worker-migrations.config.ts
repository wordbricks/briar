import { defineConfig } from "vitest/config";
import { createWorkerTestPlugin } from "./vitest.worker.shared";

export default defineConfig(async () => ({
  plugins: [await createWorkerTestPlugin()],
  test: {
    name: "worker-migrations",
    include: [
      "worker/src/**/*.migration.test.ts",
      "worker/src/db.test.ts",
      "worker/src/workflow-v2.test.ts",
    ],
    hookTimeout: 60_000,
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
    testTimeout: 60_000,
  },
}));
