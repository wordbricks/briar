// Passed explicitly with --config by the isolated executor. Candidate-owned
// Vitest and Vite configuration files are rejected before Docker starts.
export default {
  esbuild: {
    jsx: "automatic" as const,
  },
  resolve: {
    alias: {
      "@": "/scratch/workspace/src",
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.claude/worktrees/**",
    ],
    hookTimeout: 60_000,
    maxWorkers: 1,
    passWithNoTests: false,
    setupFiles: ["/opt/briar/vitest.setup.ts"],
    testTimeout: 15_000,
    env: {
      VITE_BRIAR_API_URL: "http://127.0.0.1:8787",
    },
    watch: false,
  },
};
