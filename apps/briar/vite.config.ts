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
    alias: {
      "cloudflare:workers": path.resolve(
        __dirname,
        "./src/test/cloudflare-workers-runtime.ts",
      ),
    },
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "src-agent/**/*.{test,spec}.ts",
      "src-cli/**/*.{test,spec}.ts",
      // These tests require Node-only filesystem or VM APIs.
      "worker/src/html-artifact-preview-shell.test.ts",
      "worker/src/wrangler-config.test.ts",
    ],
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
    env: {
      // api.ts reads this at module load; tests expect a configured Worker URL.
      VITE_BRIAR_API_URL: "http://127.0.0.1:8787",
    },
  },
});
