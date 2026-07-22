# Velen and optional Linear

## Mandatory Velen evidence pass

The `doctor` command verifies authentication, project mapping, organization, and configured Linear source. Then use Velen directly for task context:

```sh
velen --output json --org '<org>' source list
velen --output json --org '<org>' memory status
velen --output json --org '<org>' memory recall --dataset '<dataset>' --query '<task and repository context>'
```

Inspect source capabilities before guessing an API operation:

```sh
velen --output json --org '<org>' api --source '<provider://source-key>'
```

Use `--dry-run` for unfamiliar or mutating API calls. Preserve the Velen `requestId` with important evidence. If memory is unavailable or no connected source is relevant, say so and continue with local repository evidence. Do not skip the Velen pass.

## Linear is optional

Read `linearEnabled` and `linearSource` from `briar auto-hunt doctor`.

- When disabled, do not call Linear and do not pass tracker flags to Briar. The configured project workflow still applies.
- When enabled, use only the configured Velen source. Do not use a direct Linear token or a separate Linear CLI.

Describe the configured source to get its current supported operations:

```sh
velen --output json --org '<org>' api --source '<linear://source-key>'
```

Typical operations are:

```sh
velen --output json --org '<org>' api --source '<linear://source-key>' --op get_issue '<TEAM-123>'
velen --output json --org '<org>' api --source '<linear://source-key>' --op create_comment \
  -f 'issueId=<immutable-issue-id>' -f 'body=<concise progress update>'
velen --output json --org '<org>' api --source '<linear://source-key>' --op list_workflow_states \
  -f 'teamId=<team-id>'
velen --output json --org '<org>' api --source '<linear://source-key>' --op update_issue \
  -f 'issueId=<immutable-issue-id>' -f 'stateId=<terminal-state-id>'
```

Record the immutable issue ID, identifier, URL, and current state on Briar events. Briar remains authoritative for execution progress; Linear is a user-facing mirror.

## Write ordering

For each milestone:

1. Write the Briar event.
2. Confirm success and retain its run ID, status, and workflow stage.
3. Create or update the Linear comment if useful.
4. On completion, update the Linear state, fetch the issue again, then record Briar `completed` with the terminal state.

If a Linear mirror write fails after Briar succeeds, retry Linear without duplicating the Briar event. If Linear is configured but unavailable, record `blocked` or `failed` rather than falsely completing.
