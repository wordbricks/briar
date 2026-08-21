// The merge-group executor passes this dependency-free file with --config.
// Candidate-owned config/workspace files are rejected before the container
// starts, while the fixed paths and options below preserve the repository's
// test semantics without importing or auto-discovering candidate code.
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
    maxWorkers: 4,
    passWithNoTests: false,
    setupFiles: ["/scratch/workspace/src/test/setup.ts"],
    testTimeout: 15_000,
    env: {
      VITE_BRIAR_API_URL: "http://127.0.0.1:8787",
    },
    watch: false,
  },
};
