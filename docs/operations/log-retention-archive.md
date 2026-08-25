# D1 hot / R2 cold log retention

Briar keeps active work and recent history in D1. Completed, append-only history
is moved to immutable `logs/v1/` objects in the existing private R2 bucket. The
Worker continues to return one timeline, evidence list, conversation, audit log,
or transcript by merging D1 rows with verified R2 archives.

This is an application archive, not a replacement for D1 Time Travel or an
account-level disaster-recovery backup.

## Retention policy

| Data | D1 hot window | R2 long retention | Archive eligibility |
| --- | ---: | ---: | --- |
| Completed run events | 90 days | 7 years | Run is completed and the event is older than the hot window |
| Run evidence and evidence-image metadata | 180 days | 7 years | Run is completed and evidence is older than the hot window |
| Run-scoped execution audit events | 365 days | 7 years | Run is completed and the audit event is older than the hot window |
| Detached agent transcripts | 30 days | 3 years | Session is old and its linked run is completed, or it has no linked run |
| Completed issue conversations | 365 days | 7 years | Every message in the completed issue is older than the hot window |
| Completed project-agent session snapshots | 30 days | 1 year | Session is completed, failed, or interrupted and is older than the hot window |

Active runs, active project-agent sessions, incomplete conversation threads,
and recent records are never selected. The code-owned policy table in
`apps/briar/worker/src/archive.ts` is authoritative; update this document and the tests in
the same change when a retention decision changes.

## Raw transcript preservation policy

Detached-agent raw transcripts preserve the events needed to replay a run and
audit its outcome:

- client/user payloads, provider session starts, approvals, blocks, errors,
  results, execution metrics, and otherwise unknown provider audit payloads;
- message and activity start/completion snapshots, including tool calls,
  results, status, and turn-completion boundaries; and
- streaming message/activity delta text when no complete snapshot has replaced
  it.

Provider-only token, reasoning, and progress delta envelopes that have no
normalized message or activity event are omitted. Their eventual user-visible
message, tool result, error, or turn boundary remains covered by the rules
above.

High-frequency deltas with the same direction, event type, and stable message
or activity ID are stored as one normalized delta with its first source
sequence and source-event count. The repeated provider streaming envelope is
not retained. If a full, non-truncated start or completion snapshot arrives
before upload and ends with the pending delta text, that snapshot supersedes
the pending delta. This keeps the terminal state without storing the same text
twice.

Uploads occur after 500 ms of inactivity, at a five-second maximum checkpoint,
at the existing event/byte bounds, and immediately at meaningful status
boundaries. A controlled failure or shutdown flushes pending compacted deltas,
so an incomplete turn remains reconstructable; the D1 work-log projection also
marks open entries interrupted at turn completion. Retry identity remains the
deterministic sequence-range plus content-SHA object key. If R2 already has the
exact object but its D1 segment manifest was not committed, retry reuses that
object after checking its identity metadata instead of issuing another put.

This changes only detached transcript representation and upload frequency. It
does not change the retention period or storage policy for attachments,
evidence, releases, issue messages, or any other archive kind.

The regression fixture sends 1,000 one-character normalized message deltas at
10 ms intervals. The prior fixed 500 ms flush model produces 20 objects with
1,000 archived events, 212,893 uncompressed bytes, and 6,270 gzip-compressed
bytes. The compacted policy produces 2 objects with 2 archived events, 1,397
uncompressed bytes, and 320 compressed bytes: **90% fewer PutObject calls,
99.34% fewer uncompressed bytes, and 94.90% fewer stored compressed bytes** for
that same synthetic load. These are deterministic local regression-fixture
measurements, not production billing observations.

## Archive format and safety properties

Each object is gzip-compressed JSON Lines. The first line is a version 1
manifest; every later line contains a typed source record. Object keys are
deterministic and include the format version, project, scope, data kind, and a
SHA-256 content identity.

D1 stores the object key, format version, source row count, compressed byte
size, compressed-object SHA-256, uncompressed-content SHA-256, covered time
range, creation/verification/completion times, expiry, failures, and linked
evidence-image keys.

The scheduler follows this order:

1. Select a bounded batch from completed or terminal data.
2. Serialize deterministically and reject an object above the 16 MiB
   application limit before upload.
3. Upload through the R2 binding with a SHA-256 checksum.
4. Read R2 metadata back and verify size plus both checksums.
5. Persist a `verified` D1 manifest.
6. Re-read and verify the object, then delete source rows in batches of 100.
7. Mark the manifest `complete`.

An upload or checksum failure leaves every source row in D1. A failure during
deletion leaves the manifest `verified`; the next run re-verifies the same
object and resumes idempotent deletes. The scheduler never treats an unverified
or failed object as readable archive history.

The Worker runs the sweep at minute 17 every six hours. One invocation creates
at most 6 objects by default, with at most 500 primary source rows per normal
batch (4 potentially large evidence or audit rows, up to 1,000 messages from
one complete thread, and one bounded transcript/session snapshot per object). This keeps
D1 statements, Worker memory, CPU, and R2 object sizes well below platform
limits. Large-fixture tests exercise multi-object pagination, the 16 MiB guard,
checksum failure, deletion ordering, retry convergence, and archived reads.

## Monitoring

Worker logs emit one structured `log archive sweep completed` record with
attempted/completed objects, archived rows, per-kind failures, expired objects,
and cleanup results. `log archive sweep failed` is an alert condition.

Organization owners and admins can read
`GET /projects/{projectId}/storage-metrics`. It reports:

- current D1 database bytes from D1 query metadata;
- hot row counts for every governed table;
- archived object, row, byte, and failure counts by kind and status;
- pending object-cleanup count; and
- the active retention policy.

Alert when a `failed` or `verified` manifest persists across two scheduled
runs, cleanup failures grow, D1 bytes continue increasing after eligible data
exists, or a project approaches the D1 database limit. A persistent `verified`
manifest means R2 is safe but D1 deletion needs investigation; do not delete
the object manually.

## Issue and project deletion

Before deleting an archived issue or project, the API captures all archive
object keys and any evidence-image keys. After the D1 owner row is deleted, it
places those keys in a cleanup queue without foreign keys. R2 deletion is then
attempted immediately and retried by later scheduled runs. A cleanup failure
may temporarily retain an inaccessible object, but cannot erase live issue
history or lose the retry instruction.

Cleanup retries use exponential backoff from one minute up to 64 minutes. After
eight failed attempts the row is dead-lettered (`dead_lettered_at`), excluded
from automatic selection, and exposes a structured pending alert in
`alert_detail_json` with code `ARCHIVE_CLEANUP_DEAD_LETTER`. Alert on every row
whose `alert_state = 'pending'`; investigate R2 credentials, bindings, and the
specific bucket/key before replaying it. Permanent failures therefore cannot
consume the selection limit and starve newer privacy deletions.

To replay one verified dead letter, acknowledge it and create a new CAS
generation. Use the exact bucket and object key from its structured alert:

```sql
update briar_archive_cleanup_queue
set attempts = 0,
    last_attempt_at = null,
    next_attempt_at = null,
    dead_lettered_at = null,
    alert_state = 'acknowledged',
    generation = generation + 1,
    queued_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where bucket = :bucket
  and object_key = :object_key
  and dead_lettered_at is not null;
```

Do not delete a dead-letter row manually. Cleanup completion globally rechecks
live metadata and removes only the exact selected generation, so a concurrent
owner refresh remains queued.

## Backup and audit operations

Maintain both layers:

1. Use D1 Time Travel for short-term operational recovery and create a bookmark
   before every remote schema migration.
2. Export D1 regularly with `bun --cwd apps/briar wrangler d1 export briar-db --remote` and store the
   encrypted export outside the production account according to the company
   backup policy.
3. Protect the private R2 bucket with least-privilege credentials. Inventory
   `logs/v1/` objects and D1 manifests during the backup check; row counts,
   object sizes, and checksums must agree.
4. Do not configure an R2 lifecycle rule that expires `logs/v1/` sooner than
   the `expires_at` recorded in D1. The application removes expired objects and
   manifests together.
5. Audit-log archives are retained for seven years. Legal hold requires moving
   the affected objects to a hold prefix or bucket and recording the exception
   before changing application expiry.

## Recovery procedure

For normal issue-detail recovery, no rehydration is needed: the authenticated
API reads verified archive objects and merges them with hot rows.

For disaster recovery or forensic export:

1. Stop archival and destructive cleanup by disabling the cron trigger for the
   recovery deployment. Do not modify the production bucket.
2. Restore D1 to a separate database from the latest trusted Time Travel point
   or encrypted export, then apply migrations through the archive-manifest
   migration.
3. For every required manifest, fetch its exact `object_key`, verify compressed
   byte size and SHA-256, decompress it, verify `content_sha256`, and validate
   the version 1 manifest, project/run scope, row count, and covered period.
4. Prefer serving the restored D1 plus original R2 objects through an isolated
   Worker. Reinsert archive rows only when an offline consumer requires a fully
   hot database; preserve original IDs and insert parent session/evidence rows
   before child transcript/image metadata.
5. Compare per-kind hot plus archived row counts with the pre-incident metrics,
   open representative issue timelines, evidence, audit history, conversations,
   and transcripts, and only then direct users to the recovered environment.
6. Re-enable archival after the recovery owner records the validated D1 point,
   archive checksum sample, observed row counts, and rollback decision.

If an R2 checksum or manifest does not match, quarantine that object, keep any
surviving D1 rows, and restore the object from the independent backup. Never
mark a manifest complete or manually delete its D1 source rows to bypass a
verification failure.
