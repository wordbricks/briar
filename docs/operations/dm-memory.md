# DM memory operations

The [SPEC](../plans/dm-memory-spec.md) defines ownership and behavior. The
[delivery log](../plans/dm-memory-delivery.md) distinguishes merged foundations
from enabled recall and learning. Recall is an owner opt-in even when its Worker
flags are active. Do not import a private conversation archive for a smoke test.

## Index provisioning

The production binding is `DM_MEMORY_INDEX`, using
`briar-dm-memory-prod-m3-v1`. Before a deployment that includes this binding,
inspect the account and existing index. Create it only if absent:

```sh
bun x wrangler vectorize get briar-dm-memory-prod-m3-v1
bun x wrangler vectorize create briar-dm-memory-prod-m3-v1 \
  --dimensions 1024 --metric cosine --no-update-config
bun x wrangler vectorize create-metadata-index briar-dm-memory-prod-m3-v1 \
  --propertyName memorySpaceId --type string
bun x wrangler vectorize list-metadata-index briar-dm-memory-prod-m3-v1
bun x wrangler vectorize info briar-dm-memory-prod-m3-v1
```

Creation returns an asynchronous receipt. Wait for `memorySpaceId` to appear as
a string metadata index before inserting any vectors. Verify the dimensions and
cosine metric. Never put a different embedding profile into this index.

Use a different index name for staging or local probes. The production binding
has `remote: false` so ordinary local development does not access the production
vector index. An explicit, isolated probe configuration can set `remote: true`
on its own test index and AI binding. Workers AI calls are remote and billable,
including when the surrounding Worker runs locally.

Apply D1 migrations before deploying code that references the new tables. Keep
`DM_MEMORY_INDEX_ENABLED` and `DM_MEMORY_RETRIEVAL_ENABLED` false until their
respective rollout gates pass. Enabling indexing does not enable model recall or
automatic learning. A disabled indexing switch does not stop vector cleanup.

## Indexing and deletion

The minute schedule leases at most four indexing jobs. Each submission contains
at most sixteen chunks. Jobs persist before embedding and vector writes; no
memory body is kept in an in-process queue or vector metadata. Each vector's
metadata contains only memory-space, document, version and chunk identifiers.

An upsert receipt is not readiness. The next run checks the index's processing
information, fetches the expected IDs and exercises a filtered `queryById` call.
Only the current, authorized source can become ready. Search rechecks the current
D1 version, exclusions, expiry and ownership even if an old vector remains.

The vector registry has no cascading foreign keys and contains no body or body
hash. Source/document/account deletion leaves the registry's purge intent behind.
A late upsert receipt invalidates an in-flight cleanup lease and schedules
another deletion. Cleanup confirms absence after the delete mutation has been
processed. Purged identifiers are checked again daily to catch interrupted
writers whose receipt was lost. The status describes observed removal, not a
claim that Cloudflare backups or an external model's prior context vanished.

Transient indexing failures retry up to three times with backoff and jitter.
Recognized authentication, paid-plan, daily-allocation and invalid-model errors
stop immediately. Resolve the configuration before requeuing affected jobs; a
provider failure never advances a learning watermark or becomes `no_change`.
The classification follows [Workers AI's error codes](https://developers.cloudflare.com/workers-ai/platform/errors/).
Failure codes and counts can be recorded; prompts, memory bodies, query text and
raw provider errors must not be logged. After three purge failures, the registry
keeps a `purge_failed` intent and the document remains pending physical cleanup.
Do not delete these rows or report completed erasure. After fixing the provider
configuration, an operator can requeue a specific failed vector ID by changing
its state to `purging`, clearing its lease, resetting `attempt`, and setting
`available_at` to the current UTC time. Do not bulk-requeue unrelated failures.

## Retrieval checks

The initial profile is `cf-bge-m3-1024-cosine-v1`. Chunking uses pinned
`js-tiktoken@1.0.21` and `cl100k_base` as a local budget, independently of the
embedding provider's tokenizer or billable usage. Index and query preprocessing
use the same embedding model without translating the source language.

Search accepts one to three unique queries, merges at most twenty candidates per
query and returns at most ten final results. The first rollout uses BGE-M3 cosine
floor `0.5`, followed by a strict JSON semantic check of at most ten candidates
with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The measured report and fixtures
are in `apps/briar/evals/dm-memory-retrieval-v1`. An absent threshold disables
semantic retrieval.
Source-body reads are bounded, deadline-limited and checked against the active
claim's space. A timeout returns no documents and `memoryRevision: null` if the
snapshot could not be established in time. It does not fall back to keyword
search or dump all memories.

For topic documents, `memory_get` keeps offsets in the original normalized
Markdown but returns only Current sections. An offset preceding Current advances
to that section; `nextOffsetBytes` skips excluded History sections. Owner-only
management/export retains the original document.

Before enabling recall, run the SPEC's Korean/English positive and negative
evaluation with held-out queries, validate cross-space and deletion isolation,
and connect the execution Worker protocol. Before enabling learning, also verify
the independent proposal/verifier path, configured model budget, and human-labeled
learning evaluation. Passing D1 tests or a four-sentence embedding probe does not
satisfy those quality gates.

## Reply execution and management

Workers advertise `dmMemory: { protocol: 1 }`. The server binds each eligible DM
claim to its own memory space and revocation epoch, including claims made by old
Workers. Old Workers receive no memory payload and cannot resume a provider
conversation that previously held memories. Supported Workers fetch the bounded
brief, check permissions before each provider turn and activity publication, and
check once more before completing. The completion transaction repeats the fence.

A revocation clears retained provider IDs, removes lookup payloads and requeues
active replies. Memory restarts keep activity attempt numbers increasing without
consuming the ordinary failure budget. Activity credentials also bind the claim
hash, so a credential from a prior execution cannot publish after reclamation.
A body-free outbox also clears the revoked activity frame. Owner mutations flush
it promptly and the minute schedule retries failed publications. Its attempt
number cannot erase a newer reply's activity.
Lookup request IDs survive transport retries; a new ID consumes a new lookup turn
from the three-turn limit shared with organization context. Memory changes
invalidate cached payloads without resetting that budget.

Missing or invalid Vectorize or Workers AI bindings return unavailable
retrieval. They do not activate a fallback. The semantic verifier also fails
closed on invalid output or provider failure. Brief availability does not prove
that semantic search is ready.

The current rollout sets `DM_MEMORY_INDEX_ENABLED=true`,
`DM_MEMORY_RETRIEVAL_ENABLED=true` and `DM_MEMORY_MINIMUM_SCORE=0.5`. Learning has
no flag and no organization policy: it is built in, and the only remaining
prerequisites are a protocol-2 learning Worker advertising a verified provider and
owner opt-in for that DM. Rolling learning back means changing code, so treat
`dmMemoryLearningVerifiedProviders` as the switch and ship a revert rather than a
variable change. To roll back recall, set retrieval and indexing false and
redeploy. Keep cleanup and owner management available; do not delete D1 originals
or purge registries as a flag rollback.

## Connected-Agent learning runtime

Learning Workers advertise `dmMemoryLearning: { protocol: 2, transports,
providers }`. The server checks both proposer and verifier against that exact
capability before claim and commit. A protocol-1 Worker, and any protocol-2 Worker
without the `agent` transport or without a verified provider, claims no learning
work at all.

Nothing configures the learning provider. The queue derives it from the DM's own
Agent: that provider when it appears in the code constant
`dmMemoryLearningVerifiedProviders` (`apps/briar/src/lib/dm-memory-learning-contract.ts`),
otherwise the first provider in that list. The derived policy is stored in the
job's `policy_json` at enqueue. At claim time the server re-resolves it against
the providers the claiming Worker advertises and writes the resolved policy in the
same guarded batch that stores the input snapshot, so the snapshot policy and the
row always agree. Fallback never leaves the verified list, and OpenRouter is never
part of it: that transport is metered and would be a silent paid path. Adding a
provider means running `bun evals/dm-memory-learning-v1/run.ts --provider <id>`
from `apps/briar`, meeting the gate below, and extending the constant in the same
pull request. The memory dialog on desktop, Android and iOS shows the DM Agent's
provider, whether it is verified, and whether any Worker can currently run
learning.

An Agent stage reuses the user's existing local provider connection without
sending its credential to Cloudflare. It copies the provider's minimal auth files
to a mode-0700 temporary home and runs in a separate empty workspace with a new
conversation, read-only execution, no attachments or skills, and a strict output
schema. Codex also has MCP, apps, plugins, external tools and network permission
disabled. The provider receives only the bounded snapshot JSON and fixed system
instructions. Proposer and verifier never share a provider conversation.

The Worker deletes both temporary homes and workspaces in `finally`. A crash may
leave a directory until the existing stale-temp cleanup runs; do not claim
provider-side deletion. Provider errors, invalid JSON and timeouts fail the job
without advancing the watermark or writing a partial proposal. Subscription Agent
calls have zero tracked micro-USD cost in the status UI, but retain per-space and
per-organization call limits.

Before adding a provider to `dmMemoryLearningVerifiedProviders`, run
`bun evals/dm-memory-learning-v1/run.ts --provider <id>` from `apps/briar` with
synthetic cases, confirm precision at least 95%, recall at least 80% and zero
safety violations, then verify the target Worker heartbeat advertises protocol 2,
the `agent` transport and that provider. Never use a private conversation archive
for this check.

Temporary memory files live outside the checkout with directory mode 0700 and
file mode 0600. Completion/failure removes them. On a subsequent invocation,
cleanup removes directories left by dead processes or past the 24-hour retention
bound; a stopped machine cannot perform immediate erasure. The minute maintenance
pass removes lookup payloads and discovered-reference sets for abandoned claims.
No provider-side erasure is asserted.

Owner management supports paged revision metadata and exact-version reads.
Desktop/Android and iOS show history without overwriting the current edit, refresh
index/expiry status, and open cited versions through the owner-authenticated API.
Forgetting purges all revision bodies and citation links; original chat messages
remain visible to the user but excluded message IDs are withheld from future
Agent snapshots and attachment reads.
