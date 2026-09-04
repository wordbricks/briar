import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { resolveMaxWorkers } from "./vitest.max-workers";

const host = process.env.TAURI_DEV_HOST;
const buildsWeb = process.env.VITE_BRIAR_WEB === "true";

/**
 * Desktop builds emit a second page for the native launch intro window.
 *
 * The intro has to be on screen while the app bundle is still downloading, so
 * it gets its own entry instead of loading `index.html` a second time. The web
 * build has no such window and keeps its single-page output.
 */
const buildInput = {
  index: path.resolve(__dirname, "index.html"),
  ...(buildsWeb
    ? {}
    : { intro: path.resolve(__dirname, "intro.html") }),
} satisfies Record<string, string>;

export default defineConfig({
  base: buildsWeb ? "/app/" : undefined,
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    // The entry chunk is the app shell (~520 kB); anything past this means a
    // view that should have been split has leaked back into the initial load.
    chunkSizeWarningLimit: 560,
    // Rolldown's default splitting emits one small chunk per shared module once
    // the app uses dynamic imports. Grouping the vendors that every screen needs
    // keeps the request count sane and lets them stay cached across releases.
    rolldownOptions: {
      input: buildInput,
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
              tags: ["$initial"],
            },
            {
              name: "vendor-effect",
              test: /node_modules[\\/](effect|@effect)[\\/]/,
              priority: 35,
              tags: ["$initial"],
            },
            {
              name: "vendor-rpc",
              test: /(node_modules[\\/](@bufbuild[\\/]protobuf|@connectrpc)[\\/]|packages[\\/]contracts[\\/]src[\\/]gen[\\/])/,
              priority: 30,
              tags: ["$initial"],
            },
            {
              name: "vendor-markdown",
              test:
                /node_modules[\\/](react-markdown|remark-.*|rehype-.*|micromark.*|mdast-.*|hast-.*|unified|unist-.*|vfile.*|bail|trough|devlop|property-information|space-separated-tokens|comma-separated-tokens|character-entities.*|decode-named-character-reference|html-url-attributes|zwitch|longest-streak|ccount|escape-string-regexp|markdown-table)[\\/]/,
              priority: 25,
              tags: ["$initial"],
            },
            {
              name: "vendor-radix",
              test: /node_modules[\\/](@radix-ui|@floating-ui|aria-hidden|react-remove-scroll.*|use-callback-ref|use-sidecar|get-nonce|detect-node-es|tslib)[\\/]/,
              priority: 20,
              tags: ["$initial"],
            },
            {
              name: "vendor-icons",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 15,
              tags: ["$initial"],
            },
          ],
        },
      },
    },
  },
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
    ],
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
    maxWorkers: resolveMaxWorkers(),
    setupFiles: ["./src/test/setup.ts"],
    // Headroom for a loaded host, not for slow tests: a healthy case finishes
    // in milliseconds, and `settle` fails with its own message at 10s. This
    // ceiling only decides whether contention reads as a timeout or as a wait.
    testTimeout: 30_000,
    env: {
      // api.ts reads this at module load; tests expect a configured Worker URL.
      VITE_BRIAR_API_URL: "http://127.0.0.1:8787",
    },
  },
});
