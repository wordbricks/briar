# DM memory delivery

The target is the complete [DM memory SPEC](dm-memory-spec.md). Delivery is split
into at most four pull requests. A merged intermediate PR does not mean that
automatic learning or end-to-end recall is complete.

| PR | Scope | State |
| --- | --- | --- |
| 1 | Versioned storage, ownership, CRUD/export, desktop/Android/iOS management | [#1497](https://github.com/wordbricks/briar/pull/1497), merged |
| 2 | Chunking, durable indexing, Vectorize search, briefs, purge lifecycle | [#1499](https://github.com/wordbricks/briar/pull/1499), merged |
| 3 | Worker capability, DM lookup loop, provider session fencing, citations | In progress on `codex/dm-memory-execution` |
| 4 | Durable learning claims, proposals, independent verification, consolidation, evaluations | Pending |

Keep automatic learning disabled until its runtime, budgets and evaluation pass.
Do not advertise recall before PR 3 connects the DM execution path. Use synthetic
fixtures; never commit the user archive, profiles or conversation text.

The final audit must bind M01–M28 to actual test evidence and record the four PR
numbers, verified heads, required signoffs and merge commits. Retrieval and
learning quality targets require measured results, not module existence.

## Storage PR evidence

- Validated head: `beefc6632d0e519043b23d85993a4127df6fa0b1`. All four required
  `ci:signoff` contexts passed, including 2,165 app/Worker tests and 94 D1 tests.
  Merge commit `ecf6eb9c08220da5adeb6df74679b52352b4929d` was verified on `origin/main`.
- Full `mobile:ci` passed: 20 iPhone UI tests, iPad accessibility/Dynamic Type,
  native unit tests, Production analysis/build, and the isolated Android APK build.

- Real isolated D1 plus the full API handler: 14 tests covering atomic writes,
  idempotency, competing revisions, source edits, owner isolation, roster changes,
  leave/rejoin, deletion and streamed ZIP export.
- React management: three tests covering pending saves, failed-save retries and
  closed spaces. Shared Worker/mobile contract: twelve tests.
- Native iPhone simulator: 17 shared-contract tests and the actual DM header →
  memory list → edit/save → version update → forget UI test passed.
- Android arm64 debug APK built. No connected Android device was available;
  this does not establish device UI or download behavior.
- Aside browser: the real React dialog with synthetic API responses, desktop
  and a 390px iframe. Save acknowledgement and version 2 remain distinct from
  the pending index. This is fixture evidence, not authenticated production QA.
- Native validation exposed an existing missing return in `CompanionViews.runs`;
  the PR restores the return without changing its ordering behavior.
- Full migration coverage caught duplicate Inbox events from internal memory
  counters. The migration keeps ordinary channel/message notifications intact
  while ignoring counter-only updates; the existing Inbox regression and the
  memory source-edit event-count check pass.
- The native project-selection UI test was updated for the existing nested
  team/project menu. It now selects the leaf and verifies the resulting scope;
  the focused rerun passed without changing product navigation.

Index jobs intentionally remain pending until PR 2. Recall and automatic learning
capabilities are false; automatic-learning opt-in is rejected until PR 4. No
remote migrations, deployments, or private conversation imports were performed.

## Retrieval preparation

- A four-sentence synthetic Workers AI probe returned four 1,024-dimensional
  BGE-M3 vectors in 710 ms through a local Worker with a remote AI binding.
  This verifies the binding and response shape, not retrieval accuracy or p95.
- The chunk budget uses pinned `js-tiktoken@1.0.21` with `cl100k_base`. It is
  independent of the embedding model's billing tokenizer. A local workerd probe
  encoded 61,600 synthetic UTF-8 bytes in 58 ms after 125 ms initialization.
  Real retrieval evaluation remains a release gate.
- A separate, temporary Vectorize index held three synthetic vectors. Actual
  BGE-M3/Vectorize queries selected the English source for the Korean question and
  the Korean source for the English question. An identical source in another
  memory space was excluded by the filter. The two queries plus `queryById` took
  1,724 ms in one observation; this is not a p95 or quality benchmark.
- The real binding returned string mutation IDs and timestamps, unlike the
  installed generated declarations. The adapter validates the V2 runtime and
  decodes its actual response. After deletion, the processed mutation matched
  the delete receipt and `getByIds` returned no vectors.
- The temporary index was deleted after confirming vector removal; Cloudflare's
  read-back returned `vectorize.index.deleted`. No production index was created.
- Tokenizer initialization is lazy, so ordinary requests do not build its tables.
  The updated local startup profile measured 117.3 ms active time, with a
  5,498.54 KiB bundle and 1,323.35 KiB gzip. This is not deployed Cloudflare latency.
- Pre-commit focused validation: 93 tests across chunking, provider failure
  classification, real D1 storage/retrieval and scheduled routing; Worker
  TypeScript and type-aware lint passed. All four required signoffs passed for
  `9785ee1f2da9b9f2a33a8317435e9e85db597b4d`; merge commit
  `229cd4ee37b9a8eb3e7f38399b98bb75d4ec2dc3` was verified on `origin/main`.

The remaining execution/UI pass must cover owner revision history, visible expiry
and indexing updates, citations, and the distinction between forgetting a memory
and deleting its conversation source, on desktop/Android and native iOS.

## Execution PR preparation

- Real D1 and owner-management integration: 55 tests passed across execution,
  storage, retrieval, React history and shared mobile contracts. Existing channel
  and delegation regressions plus the actual CLI loop: 53 tests passed.
- The CLI loop uses synthetic HTTP responses and an injected provider. It checks
  a fresh conversation's reconstructed lookup context, pre-invocation and
  pre-publication revocation, and abort-before-activity behavior. This does not
  establish real model recall quality or the PR 4 learning pipeline.
- Native iPhone simulator: shared-contract tests and DM citation → version read
  → save → history → forget passed. The test exposed a blank SwiftUI sheet from
  separately captured route state; the citation route now carries its store and
  reference as one value.
- Aside: actual React components with synthetic API responses verified exact
  cited-version reads, read-only old bodies, current-draft preservation, expiry
  and pending index labels at desktop and 390px widths. Screenshots are local
  evidence, not authenticated production or Android device validation.
- Native evidence is under `/tmp/briar-dm-memory-pr3-ios-evidence/`; browser
  evidence is under the Aside session's `artifacts/dm-memory-pr3-*` paths.
  Temporary Vite fixtures and owned browser tabs were removed after capture.
- Recall remains off pending the measured bilingual evaluation. No production
  vector index, migration or deployment was performed.
