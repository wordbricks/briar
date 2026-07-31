# Log retention and recovery

Briar keeps recent operational data in D1 (the hot store) and moves older,
append-only payloads to the `briar-archives` R2 bucket (the cold store). The
daily archive job writes versioned, gzip-compressed JSONL, downloads the object,
verifies its SHA-256 checksum, and only then commits the manifest and D1 deletes
in one D1 batch. A failed upload or checksum check never deletes a source row.

## Retention policy

| Data | Hot in D1 | Cold in R2 | Archive eligibility |
| --- | ---: | ---: | --- |
| Completed-run timeline events | 30 days | 7 years | Completed runs only |
| Run evidence and image metadata | 90 days | 7 years | Completed runs only |
| Execution audit payloads | 90 days | 7 years | Completed runs only |
| Agent transcript event payloads | 14 days | 7 years | Completed runs only; the small session summary stays hot |
| Issue conversation messages | 365 days | 7 years | Completed runs only; leaf replies are removed first so a newer thread is never cascaded away |
| Completed project-agent session payloads | 30 days | 7 years | Non-running sessions only |

Issue attachments and evidence image bytes already live in R2 and are not copied.
Their metadata is included in the log archive so archived evidence can still be
rendered. Active runs are never archived. The archive job handles at most 500
rows and 4 MiB of uncompressed JSONL per object, and D1 deletes are grouped in
batches of 50 rows to stay within Worker and D1 execution limits.

## Format and idempotency

Archive objects use `v1/projects/<project>/<scope>/<sha256>.jsonl.gz`. The first
JSONL line is a format header; each remaining line names the source table, its
stable key, timestamp, and complete row payload. The content checksum makes the
object key deterministic. Retrying the same work overwrites identical bytes,
the manifest insert ignores an existing object key, and deletion of already
removed keys is harmless. D1 stores the object key, format version, row and byte
counts, SHA-256, covered period, and creation/verification timestamps in
`briar_log_archives`.

Issue detail APIs merge hot rows with every verified archive for that issue and
deduplicate by the original row key. Timeline, evidence, conversations,
transcripts, agent sessions, and execution audit reads therefore keep their
existing API shape. Deleting an issue or project also deletes its archive
objects and archived evidence-image objects.

## Monitoring and alerts

The scheduled Worker emits a structured `briar_archive_cycle` log containing:

- hot row counts for every managed table;
- estimated D1 bytes when the runtime exposes page statistics;
- archive object, row, compressed-byte, purge, and failure counts.

Each failed object emits `briar_archive_failure` with its project or run ID and
the safe error message. Alert when `failedObjects > 0`, when no successful cycle
appears for 36 hours, or when D1 bytes or any managed row count grows for seven
days despite eligible completed runs. Inspect `briar_log_archives` to reconcile
object counts, covered periods, row counts, and checksums with R2 inventory.

## Backup and recovery

Keep Cloudflare D1 point-in-time recovery enabled and treat R2 object versioning
or an independently replicated bucket as the long-term backup. Archive objects
are retained for seven years by the scheduled purge; any bucket lifecycle rule
must be at least as long and must not remove current `v1/` objects earlier.

To recover an archived issue:

1. Stop the archive schedule and preserve the affected D1 database and R2
   object versions.
2. Find the issue's manifests in `briar_log_archives`, download each object, and
   compare the object SHA-256 and byte length with the manifest before decoding.
3. Decode gzip JSONL and validate the `briar-log-archive` header and version.
4. For read recovery, restore a missing object from the replicated R2 copy under
   the exact manifest key. Normal issue APIs will immediately include it.
5. For D1 reconstruction, load records into a separate recovery database using
   original stable keys and `insert ... on conflict do nothing`; never replay
   directly into production before row counts and issue timelines match.
6. Verify timeline order, evidence metadata and images, audit events, transcript
   sequence, manifest row totals, and checksums. Resume the schedule only after
   the repaired read path and a new backup are confirmed.

For an audit export, retain the manifest rows together with the compressed
objects and checksum verification report. Never edit an archive object in
place; a corrected export must use new content and therefore a new checksum key.
