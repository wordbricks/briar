# Worklog tool persistence boundary

Issue: https://briar-api.wbai.workers.dev/open/issues/4947dcf7-694e-4a0e-b702-ac9ce562b018/65d2ed49-8b67-5a8b-b52b-ceb8c2dd941e

## Policy

New ingestion retains explicit normalized message fields, conversation/turn boundaries,
user messages, final results, and terminal error/block classifications. All command,
file-change, search and generic tool activities (including failures and compacted deltas),
approval inputs, opaque provider events, and raw envelopes are excluded from D1 and R2.
Raw envelopes are removed even when accompanied by a retained assistant message.
Provider error messages can echo tool payloads: only the known error code or block reason
is archived. The independently recorded run failure/result and evidence remain unchanged.
Agent-written explanations, final answers and change summaries remain messages; deliberate
quotations in those messages are not content-redacted.

Filtering happens in server ingest, after issue-execution observes usage and blocks and
detached-provider-turn consumes session IDs, approvals and terminal status. Provider SDK
execution/resume, model tool results, local provider session history, wire sequencing and
telemetry are unchanged. Server-side enforcement also covers older workers and reply tasks.
Tool-only batches return zero counters before D1/R2 access; no session is created or touched.
Retained sequences are not renumbered. Projection uses original updated_sequence cursors,
and deterministic R2 keys/manifest repair and duplicate detection remain in place.

No schema migration, historical deletion, debug collector, UI component, or mobile change.
Legacy activity readers and archive fallbacks remain compatible. Existing writing tool
entries are not rewritten when a new turn boundary arrives.

## Identical-sample measurement (2026-09-08)

Baseline: 4ed2242b4f6d114f7697f652f0f00aef20338b9e, original agent-worklog.ts.
Both implementations were run against the same local workerd D1 schema/R2 binding with
fresh sessions. A temporary comparison test loaded the baseline beside the new ingest,
counted explicit D1 run/batch statements and R2 put calls, and read stored body bytes.
The temporary baseline and instrumentation were removed after measurement.

Sample: sequence 1 command activityStarted (id t, title bun test, text input, raw input);
sequence 2 activityCompleted (completed, same id/title, text and raw output each equal to
`"test output\n".repeat(1000)`). Mixed adds sequence 3 final messageCompleted (id m,
text Tests passed, raw unrelatedTool input). All events use server direction and event
envelopes. Counts below exclude SQL trigger-internal statements, reads, and wire bytes.

| Sample | Metric | Before | After |
| --- | --- | ---: | ---: |
| Tools only | D1 explicit write statements | 4 | 0 |
| Tools only | R2 object puts | 1 | 0 |
| Tools only | R2 uncompressed JSONL bytes | 26,378 | 0 |
| Tools only | R2 gzip bytes | 270 | 0 |
| Tools only | D1 entry body bytes | 12,000 | 0 |
| Mixed | D1 explicit write statements | 5 | 4 |
| Mixed | R2 object puts | 1 | 1 |
| Mixed | R2 uncompressed JSONL bytes | 26,556 | 146 |
| Mixed | R2 gzip bytes | 321 | 129 |
| Mixed | D1 entry body bytes | 12,012 | 12 |

Fresh-session D1 writes include session insert/update, segment manifest insert and projected
entries. The manifest's existing triggers maintain session totals. Repetitive output makes
this sample especially compressible. These are observed storage/call differences, not a
prediction of production traffic, billed rows, or invoice savings.

## Verification scope

Focused workerd tests cover all nine provider identifiers at the common boundary, zero
D1/R2 access for tool-only retries, mixed batches, sequence gaps, stale/repeated messages,
actual decompressed R2 contents, safe terminal classifications, JSON-RPC tool responses,
compacted messages, interruption recovery, concurrent segments, manifest repair, session
totals and project isolation. Provider integration and reply regression suites run in local CI.
No paid live model turns are needed for this server-only change; provider resume and usage
behavior is covered by existing adapter/execution tests and unchanged caller inspection.
