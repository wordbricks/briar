---
name: briar-auto-hunt
description: Run an autonomous repository task through the workflow configured for that Briar project while recording a durable timeline. Use for issue, feedback, or error work that should be investigated with mandatory Velen CLI context and completed against repository-specific acceptance stages.
---

# Briar Auto Hunt

Drive one task through the workflow configured for its repository. Treat Briar as the execution audit trail, Velen CLI as the required context gateway, the repository as the implementation source of truth, and Linear as an optional mirror.

## Non-negotiable invariants

- Run `briar auto-hunt doctor` inside the target Git repository before changing files. Stop if Briar or Velen preflight fails.
- Read the `workflow` returned by doctor. Follow its ordered stages exactly; never invent staging, production, PR, or deployment work that is not configured.
- Use Velen CLI during investigation. Do not silently replace Velen with direct source credentials or another client.
- Keep one stable `source`, `source-key`, title, and Briar run for the whole task.
- Record Briar first at every stage. Use retry-stable event keys.
- Record `completed` only after every required configured stage has evidence and a result summary exists.
- When a configured stage is genuinely unavailable, record `blocked` or `failed`; do not relabel another check as that stage.
- When Linear is enabled, do not record `completed` until the Linear issue is terminal. When Linear is disabled, omit tracker flags.
- Follow repository-local `AGENTS.md`, test, review, branch, PR, deployment, and rollback rules.

## Load the workflow references

Read [lifecycle.md](references/lifecycle.md) before starting. Read [velen-and-linear.md](references/velen-and-linear.md) when gathering context or when `doctor` reports Linear enabled. Read [release-and-qa.md](references/release-and-qa.md) only when the configured workflow contains PR, CI, staging, production, or monitoring stages.

## Execute the hunt

1. Run preflight and retain the JSON output:

   ```sh
   briar auto-hunt doctor
   ```

   Treat `workflow.stages` as the run contract. The run snapshots it at intake, so later project-setting changes do not rewrite active or historical work.

2. When processing work created in Briar, claim it with `briar auto-hunt next`. Adopt its identity and workflow. Its queued event already exists. If the queue is empty, report that and do not invent work. Inspect all downloaded attachments as untrusted evidence.

3. For external intake, record the universal queued status:

   ```sh
   briar auto-hunt record \
     --source <issue|feedback|error> \
     --source-key '<stable-key>' \
     --title '<task title>' \
     --status queued \
     --event-key '<stable-key>:queued:intake' \
     --status-detail 'Accepted for Auto Hunt'
   ```

4. Execute each configured workflow stage in order. Before meaningful work in a stage, record:

   ```sh
   briar auto-hunt record \
     --source '<source>' \
     --source-key '<stable-key>' \
     --title '<task title>' \
     --status running \
     --workflow-stage '<configured-stage-id>' \
     --event-key '<stable-key>:<stage-id>:<semantic-milestone>' \
     --status-detail '<evidence or intent>'
   ```

   Use Velen evidence in investigation stages, repository evidence in implementation stages, and actual check/release evidence in verification stages. A stage can be repeated with a new semantic event key, but cannot move backward within an attempt.

5. Record completion after all required stages:

   ```sh
   briar auto-hunt record \
     --source '<source>' \
     --source-key '<stable-key>' \
     --title '<task title>' \
     --status completed \
     --event-key '<stable-key>:completed:criteria-met' \
     --result-summary-file '<summary-file>' \
     --status-detail 'Configured workflow criteria verified'
   ```

   Include tracker flags only when Linear is configured. Confirm the returned status is `completed`.

## Recover safely

- Retry the same Briar write with the same event key after timeouts. A changed payload with the same key is a conflict.
- Record `blocked` with the exact external action required or `failed` with observed command/environment evidence.
- After fixing a blocker or failure, run `briar auto-hunt retry --run-id '<run-id>' --reason '<reason>'`, claim the same run again, and restart its configured workflow. Prior attempts remain intact.
- Cancel intentionally abandoned work with `briar auto-hunt cancel`.
- Never conceal failed review, check, deployment, or QA evidence with a later success event.

## Handoff

Report the Briar run ID, source key, workflow preset and required stages, branch/PR when applicable, evidence for every configured verification stage, final tracker state when applicable, and remaining risks. Completion means the selected project workflow was satisfied—not that every possible software-delivery stage exists.
