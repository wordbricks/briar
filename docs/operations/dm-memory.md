# DM memory operations (superseded)

> **Superseded (2026-10-14).** DM memory is the memory vault; operate it with
> [memory-vault.md](memory-vault.md). The D1 memory these operations covered —
> the `DM_MEMORY_INDEX` Vectorize index (`briar-dm-memory-prod-m3-v1`), its
> index/retrieval flags, briefs, lookups and the learning pipeline — was removed
> with `0222_remove_legacy_dm_memory.sql`. The previous runbook is in git
> history: `git show dc40e2cc:docs/operations/dm-memory.md`.

What remains of the D1 schema (memory spaces, reply fences, activity
revocations, exclusions) is described in
[dm-memory-spec.md](../plans/dm-memory-spec.md).

## Retiring the Vectorize index

Once the release that drops the `DM_MEMORY_INDEX` binding is deployed, nothing
reads or writes the index. Delete it then (irreversible; it held only
embeddings of the dropped D1 documents):

```sh
bunx wrangler vectorize delete briar-dm-memory-prod-m3-v1 --force
```
