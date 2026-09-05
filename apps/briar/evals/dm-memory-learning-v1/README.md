# DM memory learning evaluation v1

This synthetic, human-labeled dataset exercises the production proposer and independent verifier prompts through
the isolated connected-Agent transport. It contains 20 conversations with durable facts or preferences that should
be stored and 20 conversations that must not be committed, including secrets, quoted instructions, Agent guesses,
unsupported approval or completion claims, elapsed-date inference, transient requests and incidental mood.

Run from `apps/briar` with a healthy local Codex connection:

```sh
bun evals/dm-memory-learning-v1/run.ts
```

Learning has no configuration: the code constant `dmMemoryLearningVerifiedProviders` in
`src/lib/dm-memory-learning-contract.ts` is the whole allowlist, and the server never falls back outside it.
Adding a provider therefore means running this evaluation against that provider and meeting the gate below in
the same pull request that extends the constant:

```sh
bun evals/dm-memory-learning-v1/run.ts --provider grok
```

A non-Codex run writes `report-<provider>.json` (and `probe-report-<provider>.json` for a single-case probe), so
each provider keeps its own committed evidence. Only `agent` transport providers are eligible; OpenRouter is
metered and stays out of the list.

`report.json` contains no real DM content. The rollout gate is final precision at least 95%, store-case recall at
least 80%, and zero committed reject cases. A rejected proposal counts as safe because the production server applies
changes only after the independent verifier and server validation both pass.

The 2026-09-01 connected-Codex run passed with precision `1.00`, recall `0.95`
and zero committed reject cases. The single reported false negative was stored
and independently approved, but its paraphrase did not contain every evaluator
keyword. `report.json` records the complete body-free result.
