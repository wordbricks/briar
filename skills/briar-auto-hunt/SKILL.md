---
name: briar-auto-hunt
description: Run an autonomous repository task from intake through production verification while recording a durable Briar Auto Hunt timeline. Use for issue, feedback, or error work that should be investigated with mandatory Velen CLI context, implemented, reviewed, released, and QA-verified. Supports optional Linear mirroring through a configured Velen Linear source but must also work without Linear.
---

# Briar Auto Hunt

Drive one task to a verified production outcome and make every meaningful stage visible in the Briar dashboard. Treat Briar as the execution audit trail, Velen CLI as the required context gateway, the repository as the implementation source of truth, and Linear as an optional mirror.

## Non-negotiable invariants

- Run `briar auto-hunt doctor` inside the target Git repository before changing files. Stop if Briar or Velen preflight fails.
- Use Velen CLI during investigation. Do not silently replace Velen with direct source credentials or another client.
- Keep one stable `source`, `source-key`, title, and Briar run for the whole task.
- Record Briar first at every stage. Linear comments or state changes happen only after the corresponding Briar event succeeds.
- Use retry-stable event keys. Never put timestamps or random values in event keys.
- Do not record `completed` until production QA is passed or explicitly skipped with a defensible reason and a result summary exists.
- When Linear is enabled, do not record `completed` until the Linear issue is in a terminal state. When Linear is disabled, omit all tracker flags and continue normally.
- Record `blocked` with a concrete blocker or `failed` with the observed failure before stopping.
- Follow repository-local `AGENTS.md`, test, review, branch, PR, deployment, and rollback rules.

## Load the workflow references

Read [lifecycle.md](references/lifecycle.md) before starting. Read [velen-and-linear.md](references/velen-and-linear.md) when gathering context or when `doctor` reports Linear enabled. Read [release-and-qa.md](references/release-and-qa.md) before opening a PR or releasing.

## Execute the hunt

1. Run preflight and retain the JSON output:

   ```sh
   briar auto-hunt doctor
   ```

2. Choose the canonical identity:

   - `source=issue`: an external or repository issue; prefer its immutable ID as `source-key`.
   - `source=feedback`: customer or internal feedback; prefer the feedback record ID.
   - `source=error`: an error occurrence/group; prefer the provider's stable group ID.
   - If no upstream ID exists, derive a stable repository-scoped key such as `repo:<owner/name>:request:<normalized-slug>`. Reuse it on retries.

3. Record intake before investigation:

   ```sh
   briar auto-hunt record \
     --source <issue|feedback|error> \
     --source-key '<stable-key>' \
     --title '<task title>' \
     --stage queued \
     --event-key '<stable-key>:queued:intake' \
     --status-detail 'Accepted for Auto Hunt'
   ```

   Save the returned `runId`. Every later QA result uses that ID.

4. Gather Velen evidence, then record `analyzing`. Use connected sources and memory relevant to the repository and task. Capture useful request IDs in the detail or context JSON. If Velen has no relevant evidence, record that fact and continue with repository evidence; Velen execution itself is mandatory.

5. Reproduce or establish a failing signal when practical. Form a testable hypothesis. Record `implementing` immediately before editing code.

6. Implement the smallest complete fix. Add proportionate automated tests. Run repository-prescribed checks and review the diff for security, regressions, generated files, and unrelated changes.

7. Commit on an appropriate branch. Open one PR for the hunt when the repository uses pull requests. Record `pr_open` with every PR URL. If the repository uses another review/release mechanism, record the equivalent review boundary in the detail.

8. Follow the repository's release path through staging and production. Record `staging_qa`, submit its QA result, then record `production_qa` and submit its QA result. Never infer production success from a staging result.

9. If Linear is enabled, mirror concise progress after Briar succeeds and move the issue to a terminal state only after production QA. Fetch the final issue state and include it in the completion event.

10. Record completion with a durable summary:

    ```sh
    briar auto-hunt record \
      --source '<source>' \
      --source-key '<stable-key>' \
      --title '<task title>' \
      --stage completed \
      --event-key '<stable-key>:completed:production-verified' \
      --result-summary-file '<summary-file>' \
      --status-detail 'Production QA verified'
    ```

    Include tracker flags only when Linear is configured. Read back the Briar dashboard or record response and confirm the run is completed.

## Recover safely

- Retry the same Briar write with the same event key after timeouts. A changed payload with the same key is a conflict; investigate instead of inventing a new key.
- If implementation cannot proceed, record `blocked` and state what external action unblocks it.
- If a check, deployment, or QA action fails, record `failed` with command/environment evidence. Fix forward or follow the repository rollback procedure, then record the next truthful stage.
- If the task is intentionally abandoned, record `cancelled` with the reason.
- Never conceal failed deployment or QA evidence by recording a later success event.

## Handoff

Report the Briar run ID, source key, branch/PR, checks, staging QA, production QA, final tracker state when applicable, and remaining risks. A code merge without production verification is not a completed Auto Hunt.
