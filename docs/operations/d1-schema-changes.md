# D1 Schema Changes

Changing a column constraint in D1 is not a local edit. SQLite cannot alter a
`CHECK` in place, and D1 blocks every shortcut SQLite otherwise offers, so the
only way to change one is to rebuild the table — and rebuilding a table drags
in every row the foreign-key cascade can reach from it.

This is cheap or ruinous depending on choices made when the column was first
declared. The rules below exist so the expensive shape stops recurring.

## Do not put a growing enum in a CHECK

A `check (col in ('a', 'b', 'c'))` list is a rebuild waiting to happen. The
first time a fourth value is needed, the table and its whole foreign-key
closure have to be parked, dropped, recreated and restored.

Use a lookup table and a foreign key instead:

```sql
create table briar_issue_difficulties (
  difficulty text primary key not null,
  proto_name text not null unique
    check (proto_name = 'ISSUE_DIFFICULTY_' || upper(difficulty))
) strict;
```

```sql
difficulty text references briar_issue_difficulties (difficulty)
```

Adding a value is then one `insert`, with no rebuild, forever. Integrity is not
weakened — it moves from a CHECK to a foreign key, and the derived `proto_name`
column keeps the table honest against the proto enum it mirrors.

`migrations/0204_agent_provider_lookup.sql` did exactly this for the agent
provider enum, and its header states the reason: *"a new provider is one row
instead of a rebuild of every constrained table and its foreign-key
descendants."*

Reserve `CHECK` for conditions that are genuinely fixed: lengths, ranges,
formats, `trim()` equality, cross-column invariants. The schema has around 650
of those and they are worth keeping. It is the ~150 enum lists that need this
judgement, and only the ones expected to grow.

## D1 blocks every in-place shortcut

Measured against the real D1 binding, not inferred from SQLite documentation:

- `pragma foreign_keys = off` is **ignored**. Set it, read it back, still `1` —
  statements run inside a transaction, where SQLite ignores it.
- `drop table <parent>` with `defer_foreign_keys = on` **still cascades**.
  Deferral changes when violations are reported, not whether `ON DELETE`
  actions run.
- `alter table <t> rename to <x>` **rewrites every REFERENCES clause** naming
  it, so descendants follow the rename and the old table cannot be orphaned.
  `legacy_alter_table = on` only stops trigger and view bodies being rewritten.
- `pragma writable_schema` — editing `sqlite_master.sql` directly, which would
  make this free — returns `SQLITE_AUTH`.

So a constraint change means a rebuild. Plan for it rather than looking for a
way around it.

## When you must rebuild, keep the closure small

The naive rebuild parks every table in the foreign-key closure. That is often
far more than the change requires, because most of the volume usually hangs off
a single nullable link.

**A descendant that reaches the rebuilt table through a nullable foreign-key
column does not need to be parked.** Save its `(primary key, fk column)` pairs,
null the column, rebuild, then restore the values. The cascade stops at that
column, and everything below it is never touched.

Measured on the `briar_hunt_runs` rebuild (2026-09-08):

| | rows |
| --- | --- |
| `briar_hunt_runs` itself | 1,011 |
| naive closure (36 tables) | 1,215,850 |
| after null-and-restore on nullable links | ~155,000 |

A single nullable column, `briar_agent_transcript_sessions.run_id` with 1,153
rows, gated 1,051,187 descendant rows — 86% of the closure — through
`transcript_segments`, `agent_transcripts` and `agent_worklog_entries`, none of
which reference the rebuilt table at all.

Sort the direct children before writing anything:

- **nullable FK** → null and restore the column
- **already `on delete set null`** → survives the drop, nothing to do
- **`not null` FK** → must be parked, along with its own descendants

## Rebuild checklist

1. **Drop the closure's triggers first, recreate them last.** The restore
   replays rows that already exist; letting sync, notification and DM-memory
   triggers fire on it re-announces the entire history and re-queues learning
   work.
2. **Empty descendants explicitly before restoring.** The drop only removes
   what it can cascade over. Rows reached through `on delete set null` or a
   nullable cascading column survive and will collide with the restore.
3. **Generate the migration, do not hand-write it.** These files run to
   thousands of lines. Follow `scripts/generate-agent-provider-lookup-migration.ts`
   and generate from `migrations-snapshot/schema.sql`, which holds the exact
   DDL, indexes and triggers.
4. **Verify in memory before writing the file.** Replay the migration history
   into `bun:sqlite`, apply the generated SQL with foreign keys on, and assert:
   `pragma foreign_key_check` is empty, every closure table's row count is
   unchanged, nulled columns came back with their original values, the intended
   constraint landed, and every index and trigger returned. Regeneration should
   be byte-stable.
5. **Recreate indexes and triggers last**, after the data is back.
6. Run `bun run d1:snapshot` and `bun run test:d1:migrations`. Migration tests
   live in `worker/src/migration-suites/` — that directory is what
   `vitest.worker-migrations.config.ts` globs. They must seed rows with raw
   SQL, never through production functions, which may join tables that do not
   exist yet at the migration point under test.

## Measuring the cost before you run it

D1's Workers Paid plan includes 50 million rows written per month; overage is
$1.00 per million. A rebuild writes roughly three times the parked row count
(park, empty, restore) plus index maintenance, so the parked count is the
number to know before deciding.

`wrangler d1 execute --remote --json` with a multi-statement file returns only
a summary, but its `rows_read` is exactly what `count(*)` scanned, which makes
it a usable row counter:

```bash
echo "select count(*) from <table>;" > /tmp/q.sql
bunx wrangler d1 execute briar-db --remote --json --file /tmp/q.sql
```

Compound `SELECT`s are capped low in D1 — a nine-term `union all` already fails
with `too many terms in compound SELECT` — so count with one statement per
table rather than one big union.

Storage is the tighter constraint, not writes: parking doubles the closure's
bytes for the duration of the migration, against 5 GB included and a 10 GB
per-database ceiling.

## Applying it

`bun run worker:deploy` runs `apply-remote-d1-migrations` first, then
`wrangler deploy`, which is the order a widening needs. The import is atomic —
either the whole migration lands or none of it does, so a failure leaves the
database intact rather than half-rebuilt. Take a restore point first;
`wrangler d1 time-travel info briar-db` prints a bookmark and D1 keeps 30 days.

Worked example: `migrations/0209_channel_message_body_length.sql` with
`worker/src/channel-message-body-length.migration.test.ts`.
