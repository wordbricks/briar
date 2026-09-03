import { defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./vitest.max-workers";
import { createWorkerTestPlugin } from "./vitest.worker.shared";
import { workerD1TestFiles } from "./vitest.worker.test-files";

export default defineConfig(async () => ({
  // Loads apps/briar/migrations-snapshot/schema.sql rather than replaying the
  // migration history in every isolated D1. The snapshot skips
  // 0142_restore_cvs_slack_history.sql, which restores historical customer
  // messages without changing the schema; the migration suite still runs it.
  plugins: [await createWorkerTestPlugin({ schemaSnapshot: true })],
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
