# Review, release, and QA

## Discover the repository adapter

Auto Hunt is repository-agnostic. Derive commands and environments from the target repository instead of assuming Wordbricks:

1. Read every applicable `AGENTS.md`.
2. Inspect package/build manifests, CI workflows, deployment configuration, and existing release scripts.
3. Identify the smallest relevant lint, typecheck, unit/integration test, build, staging deploy, production deploy, smoke check, and rollback commands.
4. Prefer existing scripts and documented workflows. Do not create a new deployment path merely to finish the hunt.

If the repository has no production environment, define the real terminal environment with the user or record a blocker. Do not relabel a local check as production QA.

## Before review

- Verify the original failure or requirement.
- Run focused tests, then repository-required broader checks.
- Inspect the diff for unrelated edits, secrets, generated artifacts, migrations, compatibility, and rollback risk.
- Record the exact commands and results in the Briar detail/context.
- Commit intentional files only.

## Staging

Record `staging_qa` only after the candidate exists in staging. Include target SHA/version and PR URL. Exercise the actual user-visible or system behavior, not only deployment health. Save concise evidence and submit the staging QA result.

## Production

Record `production_qa` only after the candidate exists in production. Verify deployment health and the changed behavior against production. Submit the production QA result. If monitoring has a natural stabilization window, observe it before completion.

## Completion summary

Write a short file containing:

- root cause or requested outcome;
- implementation and relevant migration/config changes;
- checks and review result;
- staging target and QA evidence;
- production target and QA evidence;
- PR/release references;
- rollback posture and remaining risks.

Pass that file with `--result-summary-file` on the `completed` event.
