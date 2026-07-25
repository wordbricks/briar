# Auto Hunt lifecycle

Auto Hunt separates universal execution status from repository-specific progress.

## Universal status

| Status | Meaning |
| --- | --- |
| `backlog` | Work is tracked but is not eligible for Auto Hunt |
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

## Worktree lifecycle

| Point | What happens |
| --- | --- |
| `briar auto-hunt next` | The base branch is fetched, then a worktree and branch are created for the run and returned as `issue.worktree` |
| during the run | All work happens in that worktree; `record` picks up its branch and commit automatically |
| `blocked` / `failed` | The worktree is left in place so the failure stays reproducible |
| retry | Claiming the same run again re-enters the same worktree (`reused: true`) |
| after `completed` | `briar auto-hunt worktree remove` once the work is merged or abandoned |

Allocation failure does not release the claim: `next` returns `worktreeError` with a null worktree, and the run must be recorded `blocked` with that message. The usual cause is an unreachable remote or a repository with no `origin/HEAD`, `main`, or `master` — `briar auto-hunt doctor` reports the resolved base ref under `worktrees.baseRef`.

Removal is deliberately conservative: it refuses while the worktree has uncommitted or untracked changes, and it keeps any branch that holds commits the base ref does not already contain. A preserved branch is reported as `preservedBranch`.

## Failed-run recovery

After `blocked` or `failed`, fix the cause and use `briar auto-hunt retry`, followed by `briar auto-hunt next`. To abandon work, use `briar auto-hunt cancel`. Reuse a `--request-id` only when retrying the same timed-out recovery request. Retrying reuses the run's existing worktree, so anything already committed there is still available.
