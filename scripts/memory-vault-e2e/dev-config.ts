/**
 * Builds the `wrangler dev` config for the memory vault end-to-end check from
 * the production `apps/briar/wrangler.jsonc`, without editing it:
 *
 * * `MEMORY_ARTIFACTS` → namespace `briar-memory-e2e` (remote: real Artifacts),
 *   never the production `briar-memory`.
 * * Everything else that could reach a production resource is removed or
 *   local: routes and Workers AI (`remote: true` in production) are
 *   dropped, R2 / D1 / Durable Objects / Workflows / email run in Miniflare.
 * * Static assets are dropped (the check only speaks Connect RPC).
 * * Dummy secrets as vars; nothing real is needed or read.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const e2eNamespace = "briar-memory-e2e";

type WranglerConfig = Record<string, unknown> & {
  vars?: Record<string, string>;
  artifacts?: Array<{ binding: string; namespace: string; remote?: boolean }>;
  d1_databases?: Array<Record<string, unknown>>;
};

export async function writeDevConfig(input: { repoRoot: string; workDirectory: string }) {
  const appRoot = join(input.repoRoot, "apps/briar");
  const source = Bun.JSONC.parse(await Bun.file(join(appRoot, "wrangler.jsonc")).text()) as WranglerConfig;
  const productionArtifacts = source.artifacts ?? [];
  if (productionArtifacts.length !== 1 || productionArtifacts[0]!.binding !== "MEMORY_ARTIFACTS") {
    throw new Error("apps/briar/wrangler.jsonc no longer has exactly one MEMORY_ARTIFACTS binding; update dev-config.ts");
  }
  const {
    routes: _routes,
    assets: _assets,
    ai: _ai,
    vectorize: _vectorize,
    secrets: _secrets,
    observability: _observability,
    placement: _placement,
    workers_dev: _workersDev,
    $schema: _schema,
    ...rest
  } = source;
  const config: WranglerConfig = {
    ...rest,
    name: "briar-api-memory-vault-e2e",
    main: resolve(appRoot, String(source.main)),
    // Module rules (the README `.md` text import) match relative to this.
    base_dir: resolve(appRoot, String(source.main), ".."),
    d1_databases: (source.d1_databases ?? []).map((database) => ({
      ...database,
      // Local only; the id is never used remotely (no --remote anywhere).
      migrations_dir: resolve(appRoot, String(database.migrations_dir ?? "migrations")),
    })),
    artifacts: [{ binding: "MEMORY_ARTIFACTS", namespace: e2eNamespace, remote: true }],
    vars: {
      ...source.vars,
      MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED: "false",
      WHATSAPP_APP_ORIGIN: "http://127.0.0.1",
      // Dummy secrets: the e2e never signs in with Google/Slack/AWS.
      RELEASE_PROMOTION_SECRET: "e2e-dummy",
      BETTER_AUTH_SECRET: "e2e-dummy-better-auth-secret-0123456789abcdef",
      GOOGLE_CLIENT_ID: "e2e-dummy",
      GOOGLE_CLIENT_SECRET: "e2e-dummy",
      SLACK_CLIENT_ID: "e2e-dummy",
      SLACK_CLIENT_SECRET: "e2e-dummy",
      SLACK_SIGNING_SECRET: "e2e-dummy",
      // 32 bytes, base64; derived here so no key-shaped literal is committed.
      SLACK_TOKEN_ENCRYPTION_KEY: btoa("e2e-dummy-key-32-bytes-long!!!!!"),
      MANAGED_COMPUTER_PROMOTION_CODE: "e2e-dummy",
      MANAGED_COMPUTER_ENROLLMENT_SECRET: "e2e-dummy",
      MANAGED_COMPUTER_AWS_ACCESS_KEY_ID: "e2e-dummy",
      MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY: "e2e-dummy",
    },
  };
  await mkdir(input.workDirectory, { recursive: true });
  const path = join(input.workDirectory, "wrangler.e2e.json");
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return { path, config };
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, "../..");
  const { path } = await writeDevConfig({ repoRoot, workDirectory: join(import.meta.dir, ".work") });
  console.log(path);
}
