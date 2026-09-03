declare namespace Cloudflare {
  interface Env {
    /** Parsed from apps/briar/migrations by the Worker Vitest configs. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    /**
     * Contents of apps/briar/migrations-snapshot/schema.sql, bound by the
     * worker-d1 Vitest project in place of TEST_MIGRATIONS.
     */
    TEST_SCHEMA_SQL: string;
  }
}
