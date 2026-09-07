import { defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./vitest.max-workers";
import { createWorkerTestPlugin } from "./vitest.worker.shared";
import { workerD1TestFiles } from "./vitest.worker.test-files";

export default defineConfig(async () => ({
  // Loads apps/briar/migrations-snapshot/schema.sql rather than replaying the
  // migration history in every isolated D1. The migration suite still replays
  // the real files.
  plugins: [await createWorkerTestPlugin({ schemaSnapshot: true })],
  test: {
    name: "worker-d1",
    include: [...workerD1TestFiles],
    setupFiles: ["./worker/src/test-setup.ts"],
    hookTimeout: 60_000,
    // See the note in `vitest.worker.config.ts`: this only orders the two
    // projects inside `vitest.worker-projects.config.ts`.
    sequence: { groupOrder: 1 },
    // Each worker boots workerd and owns an isolated D1 database.
    maxWorkers: resolveMaxWorkers(8),
    testTimeout: 15_000,
  },
}));
