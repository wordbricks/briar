import vinext from "vinext";
import { defineConfig } from "vite";
import { localizedPath, routePaths, supportedLocales } from "./app/i18n";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// Cloudflare rejects a route when an earlier wildcard already covers it.
// Keep every concrete page in routePaths for routing and the sitemap, while
// reducing Worker-first rules to the shallowest public route roots.
const workerRouteRoots = routePaths.filter((path) =>
  path === "/" || !routePaths.some((candidate) =>
    candidate !== "/" &&
    candidate !== path &&
    path.startsWith(`${candidate}/`)
  )
);

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  assets: {
    binding: "ASSETS",
    run_worker_first: [
      // Every localized page must reach the Worker; anything not listed here
      // is served straight from static assets and 404s. Derived from the
      // route table so adding a page or a locale cannot silently break it.
      ...supportedLocales.flatMap((locale) => {
        // A prefixed locale is covered wholesale by its own subtree; listing
        // its pages individually is rejected as redundant.
        const root = localizedPath(locale, "/");
        if (root !== "/") {
          return [root, `${root}/*`];
        }
        return workerRouteRoots.flatMap((path) =>
          path === "/" ? [path] : [path, `${path}/*`],
        );
      }),
      "/robots.txt",
      "/sitemap.xml",
      "/app/*",
      "/_vinext/image",
    ],
  },
  images: {
    binding: "IMAGES",
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
