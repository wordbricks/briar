import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: process.env.VITE_BRIAR_WEB === "true" ? "/app/" : undefined,
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
    hookTimeout: 30_000,
    maxWorkers: 4,
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
    env: {
      // api.ts reads this at module load; tests expect a configured Worker URL.
      VITE_BRIAR_API_URL: "http://127.0.0.1:8787",
    },
  },
});
