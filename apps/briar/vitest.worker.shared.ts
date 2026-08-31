import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-plugin";

export const workerTestBindings = {
  BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
  GOOGLE_CLIENT_ID: "google-client-test",
  GOOGLE_CLIENT_SECRET: "google-client-secret-test",
  SLACK_CLIENT_ID: "000000000000.000000000000",
  SLACK_CLIENT_SECRET: "slack-client-secret-test",
  SLACK_SIGNING_SECRET: "slack-signing-secret-test",
  // Base64 for 32 zero bytes. Production secrets are never loaded into tests.
  SLACK_TOKEN_ENCRYPTION_KEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  MANAGED_COMPUTER_PROMOTION_CODE: "BRIAR-TEST-PROMOTION",
  MANAGED_COMPUTER_ENROLLMENT_SECRET:
    "briar-test-managed-enrollment-secret-0001",
  MANAGED_COMPUTER_AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY:
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
} as const satisfies Record<string, string>;

export async function createWorkerTestPlugin() {
  // Wrangler resolves `secrets.required` before applying Miniflare overrides.
  // Populate only missing process values to avoid warnings, then explicitly
  // override the runtime bindings below so tests never receive real secrets.
  for (const [name, value] of Object.entries(workerTestBindings)) {
    process.env[name] ??= value;
  }

  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );

  return cloudflareTest({
    wrangler: {
      configPath: "./wrangler.jsonc",
    },
    miniflare: {
      bindings: {
        ...workerTestBindings,
        TEST_MIGRATIONS: migrations,
      },
    },
  });
}
