import { defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./vitest.max-workers";
import { createWorkerTestPlugin } from "./vitest.worker.shared";
import { workerD1TestFiles } from "./vitest.worker.test-files";

export default defineConfig(async () => ({
  plugins: [await createWorkerTestPlugin({
    // This migration restores historical customer messages but makes no
    // persistent schema changes. The migration suite still runs it in full.
    excludeMigrations: ["0142_restore_cvs_slack_history.sql"],
  })],
  test: {
    name: "worker-d1",
    include: [...workerD1TestFiles],
    setupFiles: ["./worker/src/test-setup.ts"],
    hookTimeout: 60_000,
    sequence: { groupOrder: 1 },
    // Each worker boots workerd and owns an isolated D1 database.
    maxWorkers: resolveMaxWorkers(8),
    testTimeout: 15_000,
  },
}));
