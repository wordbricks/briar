# Optional review, release, and QA stages

Read the run workflow first. This reference applies only to review, CI, deployment, QA, or monitoring stages that are actually configured.

## Discover the repository adapter

Read applicable `AGENTS.md`, manifests, CI workflows, deployment configuration, and existing scripts. Map each configured stage to a real repository action. Prefer existing commands and documented paths. Never create a staging or production environment merely to satisfy Auto Hunt.

## Stage evidence

- `reviewing`: review findings and their resolution.
- `pr_open`: PR/review URL and checks started.
- `local_qa`: focused checks plus the repository-required local suite.
- `ci_qa`: actual CI run and result.
- `staging_qa`: deployed staging target and behavior verification; then submit staging `qa-result`.
- `production_qa`: deployed production target and behavior verification; then submit production `qa-result`.
- `monitoring`: observation window, signals checked, and outcome.

If a configured action is unavailable, record a blocker. If a stage is absent, skip it without ceremony.

## Completion summary

Summarize the requested outcome, implementation, evidence for every required configured stage, review/release references that apply, rollback posture, and remaining risks. Do not claim a deployment or environment that was not part of the snapshot workflow.
