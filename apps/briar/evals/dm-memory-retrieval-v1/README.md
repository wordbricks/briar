# DM memory retrieval evaluation v1

This directory contains synthetic Korean and English retrieval fixtures and the
measured reports used for the first opt-in recall rollout. It contains no Briar
conversation or account data.

`dataset.json` has 40 answerable queries and 20 no-answer queries. Development
and final rows are separated before scoring. Each language direction has ten
Korean-to-English and ten English-to-Korean answerable queries. Similar topics
with a different person, platform, action, time, or requested attribute are
included in the no-answer set.

`vector-report.json` records the raw BGE-M3 cosine results. A score threshold
alone reached Hit@5 100%, but its final false-positive rate was 60%. This failed
the 10% release target, so the implementation does not treat vector similarity
as the final relevance decision.

`semantic-report.json` records a second pass over the ten highest vector
candidates with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The request uses
strict JSON, no tools, and treats the query and candidates as untrusted data.
Development and final sets each measured Hit@5 100% and false-positive rate
10%. Korean-to-English and English-to-Korean Hit@5 were both 100%. The observed
verifier p95 was 1,235.55 ms and the maximum was 1,628.96 ms.

The deployed vector floor is `0.5`. Every positive truth pair scored above it;
the semantic pass rejects scope-mismatched candidates above the floor. The
whole lookup still has a five-second deadline and returns no memory when the
embedding, vector index, semantic verifier, or final authorization check is
unavailable.

These measurements use a small synthetic corpus and a local Worker connected to
the remote Workers AI service. They are an opt-in rollout gate, not production
latency or long-term quality evidence. Keep automatic learning disabled until
its separate 20 store and 20 do-not-store evaluation passes with a funded,
privacy-compatible proposer and verifier.
