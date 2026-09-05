# DM memory delivery

The target is the complete [DM memory SPEC](dm-memory-spec.md). The four
foundation pull requests are merged. Recall and the connected-Agent learning
runtime are enabled only after their separate measured gates pass.

| PR | Scope | State |
| --- | --- | --- |
| 1 | Versioned storage, ownership, CRUD/export, desktop/Android/iOS management | [#1497](https://github.com/wordbricks/briar/pull/1497), merged |
| 2 | Chunking, durable indexing, Vectorize search, briefs, purge lifecycle | [#1499](https://github.com/wordbricks/briar/pull/1499), merged |
| 3 | Worker capability, DM lookup loop, provider session fencing, citations | [#1500](https://github.com/wordbricks/briar/pull/1500), merged |
| 4 | Durable learning claims, proposals, independent verification, consolidation, release gates | [#1501](https://github.com/wordbricks/briar/pull/1501), merged |

Use synthetic fixtures; never commit the user archive, profiles or conversation
text. Per-DM recall and automatic learning remain owner opt-ins even though the
recall flags are active and learning is built in with no flag or policy.

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

- Validated head `c675b20d9d3b00372d366eab57c8807a44594330`; all four signoffs passed:
  2,223 app/Worker tests in 334 files, 94 D1 tests, Rust and security.
  Full mobile CI passed with 20 iPhone UI tests, native unit tests, iPad
  accessibility/Dynamic Type, Production analysis/build and an Android arm64 APK.
  Merge commit `d711f18008ae7a287124efe026ff6a3ae90e3077` was verified on `origin/main`.
- XcodeGen regenerated checkout-name-dependent group names and object IDs during
  mobile CI. A structural comparison confirmed identical native targets,
  source/resource paths, build phases and target build settings. Those generated
  metadata changes were restored before publishing the successful CI results on
  the unchanged, clean pushed head. No validation gate was bypassed.

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

## Learning PR preparation

- Migration 0155 keeps source intervals, immutable input hashes, model-call
  reservations, proposals, independent verification decisions and commit
  receipts in D1. A job can write memory only after a fresh scope, source,
  policy, budget and version check in the same commit gate.
- A normal DM reply may emit a capability-gated `memorySaveRequest`. This is a
  request to review the owner's trigger message, not a storage receipt. The
  reply and durable outbox entry commit together. The learning snapshot contains
  that request plus only the current target documents discovered during the
  reply. Quotations, attachments and Agent messages cannot grant the exception.
- The original proposer and verifier use separate, stateless OpenRouter requests.
  The Worker pins one configured model and upstream provider, disables paid
  fallback, requires parameter support and requests data-collection denial and
  ZDR. This transport remains supported for compatible policies. These options
  follow the current
  [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
  [chat completion](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion),
  and [structured output](https://openrouter.ai/docs/guides/features/structured-outputs)
  contracts.
- Synthetic D1 integration follows a DM reply through the atomic outbox,
  explicit claim, proposed change, independent approval, atomic memory commit,
  twelve intervening messages and a fresh reply brief. The focused learning and
  execution pass currently covers 29 tests. Separate authenticated API tests use
  a mock OpenRouter HTTP server and cover lost commit acknowledgements without
  duplicate model calls or memory writes.
- Source deletion and expiry invalidate current derived documents recursively.
  Forgetting remains pending until vectors for those derived documents are also
  purged. Terminal private model payloads are cleared after 24 hours; body-free
  hashes, cost totals and commit receipts remain for audit.
- Owner UI on desktop/Android and native iOS shows opt-in, configured models,
  UTC daily calls and reserved cost, pending/failed states and safe failure codes.
  A bounded owner retry preserves the source interval and cumulative six-call
  ceiling and cannot bypass current daily budgets or scope epochs.
- The focused native iPhone UI test opened the real DM memory sheet and observed
  automatic-learning control, a safe model-unavailable explanation and the retry
  action. Aside exercised the real React dialog with synthetic API data: the
  failed count changed from one to zero and status changed to waiting after retry.
  These are local fixture checks, not authenticated production or Android-device
  evidence.

PR #1501 merged as `dadc9fca2b82b2da259de8f0ee85b9e524ef8a2c`.
Migration 0155 and the production Vectorize index were provisioned before the
activation change. Existing memory, indexing, learning-outbox, model-call and
commit row counts were all zero, so no private DM was imported or backfilled.

## First recall activation

- The checked-in rollout turns on `DM_MEMORY_INDEX_ENABLED` and
  `DM_MEMORY_RETRIEVAL_ENABLED` with vector floor `0.5`. Per-DM memory use remains
  an owner opt-in. Existing conversations are not backfilled.
- The versioned synthetic evaluation is under
  `apps/briar/evals/dm-memory-retrieval-v1`. It has 40 answerable and 20
  no-answer queries, with separate development/final splits and ten examples in
  each Korean/English direction.
- Raw BGE-M3 vectors reached Hit@5 100%, but final false-positive rate 60%.
  Recall therefore adds a bounded Llama 3.3 70B semantic relevance check after
  vector retrieval. Development and final results each measured Hit@5 100% and
  false-positive rate 10%; both language directions measured Hit@5 100%.
  Verifier p95 was 1,235.55 ms and maximum was 1,628.96 ms.
- Semantic verification receives at most ten candidate excerpts, has no tools,
  uses strict JSON, and treats all supplied text as untrusted. Invalid output,
  provider failure, snapshot change, or the five-second overall deadline returns
  no memory.
- The OpenRouter request now uses the endpoint-supported `max_tokens` field.
  The previous `max_completion_tokens`, `modalities`, and `n` combination had no
  matching pinned xAI ZDR endpoint when parameter support was required.
- `DM_MEMORY_LEARNING_ENABLED` remains false and its policy map remains empty.
  A real Grok proposer/verifier smoke passed, but the configured OpenRouter
  account reported zero purchased credits during the 20/20 run. Paid calls then
  returned 402, while available free alternatives either failed the ZDR policy
  or returned provider capacity errors. The incomplete run is not reported as a
  quality pass. Automatic learning still requires the full 20 store and 20
  do-not-store evaluation, precision at least 95%, recall at least 80%, no
  protected/scope violations, and a funded privacy-compatible runtime.

## Connected-Agent learning activation

- The Worker learning capability advances to protocol 2 and advertises the
  exact healthy connected providers. An Agent policy is claimable only when the
  Worker advertises both the Agent transport and the pinned proposer/verifier
  providers. Protocol 1 OpenRouter policies remain compatible.
- Each stage is a fresh, stateless text call. The Worker copies only provider
  authentication into a mode-0700 temporary home, starts in an empty temporary
  workspace, supplies no attachments, skills, tools, MCP, retained conversation
  or network permission, and accepts only the strict proposal or verification
  JSON schema. Cleanup runs after success and failure.
- The initial organization policy pins connected Codex with its configured
  default model for both stages. Subscription usage is not presented as tracked
  per-call cost; daily call limits remain enforced. There is no automatic paid
  fallback and another connected provider cannot silently replace the policy.
- `apps/briar/evals/dm-memory-learning-v1` contains 20 human-labelled store and
  20 reject cases in Korean and English. The live connected-Codex run measured
  precision 100%, recall 95% and zero safety violations. One stored and approved
  preference missed an evaluator-specific keyword and was counted as a false
  negative. The report stores IDs and decisions, not source or generated bodies.
- The checked-in rollout sets `DM_MEMORY_LEARNING_ENABLED=true` for the limited
  organization policy. Every DM remains owner opt-in and starts learning only
  from the point of opt-in; no existing conversation is imported or backfilled.

## Derived learning provider

- Automatic learning has no configuration left. `DM_MEMORY_LEARNING_ENABLED` and
  `DM_MEMORY_LEARNING_POLICIES` are removed from `wrangler.jsonc` and the
  generated Worker types, and the server reads neither. Learning is built in;
  `learningAvailable` and the `automaticLearning` capability are always true.
- `dmMemoryLearningVerifiedProviders` in
  `apps/briar/src/lib/dm-memory-learning-contract.ts` is the entire allowlist and
  currently holds `codex`. `dmLearningAgentPolicy(provider)` builds the policy
  from code constants and canonicalizes to exactly the JSON already stored in
  pending production jobs, so those jobs stay claimable across the deploy.
- The queue derives each job's policy from the DM's own Agent provider
  (`dmLearningPreferredProvider`): that provider when verified, otherwise the
  first verified one. The derived policy is written to `policy_json` at enqueue.
- The claim UPDATE resolves the provider in place. It keeps `policy_json` when
  the claiming Worker advertises both stage providers and otherwise substitutes
  the first verified provider that Worker advertises, matching
  `resolveDmLearningProvider`. Resolving inside the UPDATE rather than after it
  keeps the write atomic: a SQLite UPDATE guard reads pre-update values, so a
  later write would have been checked against the provider the Worker cannot run.
  `RETURNING` then hands back the resolved row, the snapshot is captured with
  that policy, and `snapshot.policy` equals the stored `policy_json`.
- `dmLearningWorkerCurrentSql` now requires protocol 2, the `agent` transport and
  the provider named in `policy_json` for both stages, so lease renewal, model
  reservations and commit all fail closed if the Worker stops advertising it. The
  OpenRouter claim branches are gone; `invokeOpenRouterDmLearningModel` stays as
  dormant client code and is not reachable from a job.
- Every server path that used to read the policy from the environment now reads
  it from the job row (`requireDmLearningClaim` returns it, decoded with
  `DmLearningPolicy` and compared to the snapshot). The remaining
  `job.policy_json = ?` guards bind the snapshot's own policy; the redundant ones
  were dropped and the input-hash and lease guards are unchanged.
- Retry rewrites `policy_json` to the preferred derived policy and lets claim
  time resolve any fallback. Its daily micro-USD guards became `<=` because a
  subscription Agent policy has a zero micro-USD ceiling, which the previous
  strict comparison could never satisfy.
- `DmMemoryLearningConfiguration` gains `agent_provider`,
  `agent_provider_verified` and `worker_available`. `readDmLearningStatus` always
  returns a configuration for an existing space and probes for an eligible online
  Worker with the same rules as a claim, minus the job binding. Desktop/Android
  and iOS present provider identity as information: the same provider as the DM
  Agent, an unverified Agent falling back to the connected verified provider, or
  a warning that no Worker can run learning right now.
- The eval runner takes `--provider <id>` and writes `report-<provider>.json` for
  anything other than Codex. Adding a provider to the constant requires that run
  and the existing gate in the same pull request. The evaluation was not re-run
  for this change; it consumes the user's provider subscription.
- Tests run for this change: `bun run typecheck` (clean), `bun run lint` and
  `bun run lint:type-aware` (clean), `bunx vitest run
  src/components/DmMemoryDialog.test.tsx src/lib` (120 files, 675 tests passed),
  `bunx vitest run --config vitest.worker.config.ts` (61 files, 241 tests
  passed), `bunx vitest run --config vitest.worker-d1.config.ts` (56 files, 529
  tests passed, including 21 in `dm-memory-learning-storage.test.ts`), `bunx
  vitest run src-cli/dm-memory` (2 files, 11 tests passed) and
  `bash scripts/check-contracts.sh` (clean).

- Independent review reran `bun run typecheck`, both lint passes, the full
  Worker projects (117 files, 770 tests) and the full unit project (393 files,
  2,523 tests); all passed. `dmMemoryCanonicalJson(dmLearningAgentPolicy("codex"))`
  was confirmed byte-identical to the removed production policy JSON. The iOS
  change in `DmMemory.swift` type-checked cleanly in a simulator build run with
  `-continue-building-after-errors`; the app build itself currently fails on
  `main` because `CompanionStore`/`CompanionViews`/`ChannelsStore` still use
  `projectID` after the Project → Team contract rename (#1565). That breakage
  predates this change and is tracked separately.

- Running the eval against Claude exposed a bug in the read-only Agent
  environment: it copied `~/.claude/.credentials.json` whenever the file
  existed and consulted the macOS Keychain only when it was absent, so a stale
  file left from an earlier login shadowed the live Keychain credential and every
  Claude stage failed with "Not logged in". The isolated home now prefers the
  Keychain credential and falls back to the file, matching
  `readClaudeCredentials`; a regression test covers the stale-file case.

Validation head and signoffs: pending.

Rollback sets retrieval and indexing flags to false while leaving owner edit,
forget, exclusion, and vector cleanup paths available. A rollback does not
delete owner-managed memory.
