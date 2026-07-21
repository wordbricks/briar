# Auto Hunt lifecycle

Use this ordered lifecycle. Repeating the current stage is allowed with a new semantic event key; moving backward is not.

| Stage | Meaning | Minimum evidence |
| --- | --- | --- |
| `queued` | Work accepted | stable source identity and title |
| `analyzing` | Context and root cause investigation | Velen request/evidence plus repository findings |
| `implementing` | Code or configuration is changing | reproducible signal or explicit hypothesis |
| `pr_open` | Review boundary exists | PR/review URL when available and checks started |
| `staging_qa` | Candidate is deployed to staging | target SHA/version and environment URL when available |
| `production_qa` | Candidate is deployed to production | production target SHA/version |
| `completed` | Production outcome verified | production QA passed/skipped, result summary, terminal Linear state when linked |
| `blocked` | External action is required | concrete blocker and owner/action |
| `failed` | Execution or verification failed | observed command/environment failure |
| `cancelled` | Work intentionally stopped | cancellation reason |

## Event key convention

Use `<source-key>:<stage>:<semantic-milestone>`, for example:

- `WRD-123:queued:intake`
- `WRD-123:analyzing:root-cause`
- `WRD-123:implementing:fix-started`
- `WRD-123:pr_open:pr-482`
- `WRD-123:staging_qa:sha-abc1234`
- `WRD-123:production_qa:sha-abc1234`
- `WRD-123:completed:production-verified`

Reuse the exact key and payload when retrying a timed-out write.

## Common record flags

`briar auto-hunt record` accepts:

- identity: `--source`, `--source-key`, `--title`, `--event-key`
- state: `--stage`, `--status-detail`, `--actor`, `--observed-at`, `--priority`
- Git: `--repository`, `--branch`, `--commit-sha`, repeated `--pull-request-url`, `--target-sha`
- content: `--issue-description-file`, `--result-summary-file`, `--context-json`
- tracker: `--tracker-provider`, `--issue-id`, `--issue-identifier`, `--issue-url`, `--issue-state`

The CLI detects repository, branch, and commit when omitted.

## QA writes

After recording the matching QA stage, submit:

```sh
briar auto-hunt qa-result \
  --run-id '<run-id>' \
  --environment staging \
  --result passed \
  --detail-file '<qa-evidence-file>'
```

Use `production` for production. `skipped` is allowed only when the environment/check is genuinely unavailable or non-applicable; explain why in the detail file.
