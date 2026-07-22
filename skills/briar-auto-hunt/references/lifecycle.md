# Auto Hunt lifecycle

Auto Hunt separates universal execution status from repository-specific progress.

## Universal status

| Status | Meaning |
| --- | --- |
| `queued` | Work is waiting for an agent |
| `running` | Work is active at a configured workflow stage |
| `blocked` | External action is required |
| `failed` | Execution or verification failed |
| `completed` | All required snapshot stages and completion rules passed |
| `cancelled` | Work was intentionally stopped |

## Configured workflow stages

`briar auto-hunt doctor` returns the ordered workflow selected when the repository was connected. Available stage IDs cover common cases such as `analyzing`, `planning`, `implementing`, `reviewing`, `pr_open`, `local_qa`, `ci_qa`, `staging_qa`, `production_qa`, and `monitoring`. Only the stages present in the run snapshot apply.

New projects default to `local`: `analyzing → implementing → local_qa`. Other built-in presets are `review`, `release`, and `research`; a project may also use a custom ordered selection.

Within an attempt, moving backward is rejected. Retry creates a new attempt with the same workflow snapshot and preserves earlier evidence.

## Event keys and flags

Use `<source-key>:<stage-or-status>:<semantic-milestone>`, for example:

- `BRIAR-123:queued:intake`
- `BRIAR-123:analyzing:root-cause`
- `BRIAR-123:local_qa:full-checks`
- `BRIAR-123:completed:criteria-met`

Common flags:

- identity: `--source`, `--source-key`, `--title`, `--event-key`
- execution: `--status`, `--workflow-stage`, `--status-detail`, `--actor`, `--observed-at`
- Git: `--repository`, `--branch`, `--commit-sha`, repeated `--pull-request-url`, `--target-sha`
- content: `--issue-description-file`, `--result-summary-file`, `--context-json`
- tracker: `--tracker-provider`, `--issue-id`, `--issue-identifier`, `--issue-url`, `--issue-state`

`--stage` remains a compatibility flag for older automations, but new work must use `--status` and `--workflow-stage`.

For configured `staging_qa` or `production_qa` stages, record the running stage with pending QA and then submit the matching `qa-result`. Those environment-specific writes are irrelevant when the stages are absent.

## Failed-run recovery

After `blocked` or `failed`, fix the cause and use `briar auto-hunt retry`, followed by `briar auto-hunt next`. To abandon work, use `briar auto-hunt cancel`. Reuse a `--request-id` only when retrying the same timed-out recovery request.
