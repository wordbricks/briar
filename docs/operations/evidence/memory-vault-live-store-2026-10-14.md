# Memory vault live store check — 2026-10-13

`scripts/memory-vault-live-check.ts`: `ArtifactsVaultGitStore` bundled unchanged into a throwaway Worker (`briar-memory-vault-live-check-066ca7c7`, namespace `briar-memory-live-check`), run once against real Artifacts, then deleted. Result: **pass**. Times are wall-clock ms inside the Worker.

```json
{"name":"createRepo","ok":true,"ms":4959}
{"name":"createRepo is idempotent","ok":true,"ms":53}
{"name":"repoExists","ok":true,"ms":302}
{"name":"head of an empty repository is null","ok":true,"ms":902}
{"name":"snapshot of an empty repository","ok":true,"ms":299}
{"name":"write 1","ok":true,"ms":1476,"detail":"08e1ae140d69869daf5f6c1cada2b676bd457b45"}
{"name":"write 2 sees write 1 as head","ok":true,"ms":1323,"detail":"31bae87a0bf722f48029acc31dd40582e1b584f5"}
{"name":"concurrent writers: one commits, the other gets a conflict","ok":true,"ms":2769,"detail":"6ba60934813c80dacbd1658c3faf62bfb10f0150"}
{"name":"head is the winning commit","ok":true,"ms":207}
{"name":"readFile at head","ok":true,"ms":142}
{"name":"readFile at an old commit","ok":true,"ms":106}
{"name":"readFile of a missing path is null","ok":true,"ms":75}
{"name":"readFile at an unknown commit is null or not found","ok":true,"ms":60}
{"name":"snapshot at head and at an old commit","ok":true,"ms":2044,"detail":{"head":["README.md","knowledge/facts/a.md","knowledge/facts/forget.md","timeline/daily/2026-10-13.md"],"old":["README.md","knowledge/facts/a.md"]}}
{"name":"history newest first, stopAt excluded","ok":true,"ms":974,"detail":["x1","w2","w1"]}
{"name":"a skipped plan writes nothing","ok":true,"ms":511}
{"name":"forget commit removes the file","ok":true,"ms":784,"detail":"691df9b1150493926c6db7c7516ea69771e9a5b8"}
{"name":"rewrite into the next generation without the forgotten file","ok":true,"ms":9083,"detail":{"sourceHead":"691df9b1150493926c6db7c7516ea69771e9a5b8","head":"4e7db37f14b4a499f2ea3a502b42685484bb624e","commits":4}}
{"name":"target head tree equals the source head tree","ok":true,"ms":3138}
{"name":"no commit of the target holds the forgotten text","ok":true,"ms":16187}
{"name":"deleting the old generation purges it","ok":true,"ms":2564}
{"name":"listRepos shows only the new generation","ok":true,"ms":1178}
{"name":"cleanup","ok":true,"ms":3485}
```
