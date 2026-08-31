# DM memory operations

The [SPEC](../plans/dm-memory-spec.md) defines ownership and behavior. The
[delivery log](../plans/dm-memory-delivery.md) distinguishes merged foundations
from enabled recall and learning. Neither indexing nor retrieval is enabled by
default. Do not import a private conversation archive for a smoke test.

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
query and returns at most ten final results. The similarity threshold must come
from the SPEC evaluation; an absent threshold disables semantic retrieval.
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
