import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "./vitest.worker.config.ts",
      "./vitest.worker-d1.config.ts",
    ],
  },
});
