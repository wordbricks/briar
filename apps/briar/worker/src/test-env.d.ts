declare namespace Cloudflare {
  interface Env {
    /** Parsed from apps/briar/migrations by the Worker Vitest configs. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
