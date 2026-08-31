# DM memory delivery

The target is the complete [DM memory SPEC](dm-memory-spec.md). Delivery is split
into at most four pull requests. A merged intermediate PR does not mean that
automatic learning or end-to-end recall is complete.

| PR | Scope | State |
| --- | --- | --- |
| 1 | Versioned storage, ownership, CRUD/export, desktop/Android/iOS management | In progress on `codex/dm-memory-storage` |
| 2 | Chunking, durable indexing, Vectorize search, briefs, purge lifecycle | Pending |
| 3 | Worker capability, DM lookup loop, provider session fencing, citations | Pending |
| 4 | Durable learning claims, proposals, independent verification, consolidation, evaluations | Pending |

Keep automatic learning disabled until its runtime, budgets and evaluation pass.
Do not advertise recall before PR 3 connects the DM execution path. Use synthetic
fixtures; never commit the user archive, profiles or conversation text.

The final audit must bind M01–M28 to actual test evidence and record the four PR
numbers, verified heads, required signoffs and merge commits. Retrieval and
learning quality targets require measured results, not module existence.

## Storage PR evidence

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
