import { env } from "cloudflare:workers";
import { applyD1SchemaSnapshot } from "./test-helpers/d1";

// Every file in this project gets its own isolated D1, so replaying the ~190
// migrations here cost about 2s per file (plus shipping the parsed migration
// list into every worker). Loading the generated snapshot of the fully migrated
// schema costs ~0.3s instead. The snapshot lives at
// apps/briar/migrations-snapshot/schema.sql, is produced by `bun run d1:snapshot`
// and is guarded by `bun run d1:snapshot:check`; the migration regression suite
// (`test:d1:migrations`) still replays the real migrations.
await applyD1SchemaSnapshot(env.DB, env.TEST_SCHEMA_SQL);
