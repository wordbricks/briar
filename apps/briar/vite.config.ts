import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: process.env.VITE_BRIAR_WEB === "true" ? "/app/" : undefined,
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
    // D1 integration fixtures apply the complete migration history before
    // seeding data; leave enough time for generated table-rebuild migrations.
    hookTimeout: 60_000,
    maxWorkers: 4,
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
    env: {
      // api.ts reads this at module load; tests expect a configured Worker URL.
      VITE_BRIAR_API_URL: "http://127.0.0.1:8787",
    },
  },
});
