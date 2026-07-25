/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
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
    setupFiles: ["./src/test/setup.ts"],
    env: {
      // api.ts reads this at module load; tests expect a configured Worker URL.
      VITE_BRIAR_API_URL: "http://127.0.0.1:8787",
    },
  },
});
