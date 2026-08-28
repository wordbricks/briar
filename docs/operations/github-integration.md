# GitHub App integration

Briar receives signed GitHub App webhooks and mirrors linked pull request state.
When every pull request linked to the current run revision is merged, an issue
waiting at an **after `pr_open`** checkpoint is approved and handed back to the
worker queue automatically. A pull request that is merely closed never resumes
the issue. Organization owners and admins connect the App from **Organization
settings → Integrations → GitHub**; the GitHub user token used to verify the
installation is never persisted.

## 1. Create the GitHub App

Generate one webhook secret and keep the shell open while completing steps 1
and 2:

```sh
BRIAR_GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

Create a GitHub App. Use **Public** visibility when installations must be
available to GitHub accounts outside the account that owns the App. Configure:

- User authorization callback URL:
  `https://<worker-host>/github/oauth/callback`
- Setup URL: `https://<worker-host>/github/install/callback`
- **Request user authorization (OAuth) during installation:** disabled. Briar
  starts the PKCE-protected authorization step after the setup callback.
- Webhook URL: `https://<worker-host>/github/webhooks`
- Webhook secret: the value of `BRIAR_GITHUB_WEBHOOK_SECRET`
- Repository permissions:
  - **Pull requests — Read-only**
- Subscribe to events:
  - **Pull request**

Record the App's **Client ID**, generate a **Client secret**, and record the App
slug from `https://github.com/apps/<app-slug>`. The App does not need Contents
or Commit statuses write access, an App private key, or a long-lived user or
installation token. Signed webhooks are inbound authority only; the designated
local Worker uses its existing `gh` login for bors-style integration refs,
ordinary pull-request merges, and status reporting. Briar does not inspect or
modify repository rulesets. GitHub's native Merge queues permission and Merge
group webhook are not required.

GitHub sends a signed `ping` delivery when the webhook is saved. A successful
configuration receives an HTTP 200 response from Briar.

## 2. Configure and deploy Briar

Encrypt the exact webhook value used in the GitHub App; do not generate a
second value here. `GITHUB_CALLBACK_ORIGIN` is the fixed public Worker origin,
without a path or trailing slash. It prevents an inbound Host header from
changing the OAuth redirect URI.

```sh
bunx dotenvx set GITHUB_APP_CLIENT_ID '<github-app-client-id>' \
  -f .env.production --no-native --no-armor
bunx dotenvx set GITHUB_APP_CLIENT_SECRET '<github-app-client-secret>' \
  -f .env.production --no-native --no-armor
bunx dotenvx set GITHUB_APP_SLUG '<github-app-slug>' \
  -f .env.production --no-native --no-armor
bunx dotenvx set GITHUB_CALLBACK_ORIGIN 'https://<worker-host>' \
  -f .env.production --no-native --no-armor
bunx dotenvx set GITHUB_WEBHOOK_SECRET "$BRIAR_GITHUB_WEBHOOK_SECRET" \
  -f .env.production --no-native --no-armor
unset BRIAR_GITHUB_WEBHOOK_SECRET
```

Then apply the D1 migration and deploy:

```sh
bun run secrets:check
bun run d1:migrate:remote
bun run worker:deploy
```

The five GitHub settings form one optional deployment group. Configure all of
them or none of them; the deployment wrapper rejects a partial group. Without
the group, the rest of Briar remains available, the Integrations page reports
that GitHub is not configured, and `POST /github/webhooks` returns 503.

## 3. Connect a Briar organization

An organization owner or admin opens **Organization settings → Integrations →
GitHub**, opens the GitHub card, and selects **Enable**. The browser flow:

1. signs in to GitHub;
2. installs the GitHub App on a personal account or organization;
3. selects all repositories or a limited repository set; and
4. authorizes Briar to verify that exact installation.

The setup callback treats GitHub's `installation_id` as untrusted. Briar rotates
the one-time state, completes OAuth with PKCE, and verifies the installation
through the authorizing user's `/user/installations` access before storing the
organization mapping and repository snapshot. The temporary `ghu_` token is
discarded immediately. Returning focus to Briar refreshes the page until it
shows **Connected**.

This organization connection is separate from the desktop's local GitHub CLI
readiness. The local `gh` login is still required for a worker to push branches
and create or inspect pull requests; the GitHub App connection supplies signed
inbound events.

## 4. Link a project and pull request

The Briar project must have a GitHub repository in `owner/repository` form. The
desktop repository connection derives this value from the Git `origin` remote.

The worker creates the durable run-to-PR link when it records `pull_request`
evidence. Evidence for another repository or provider is rejected while a
GitHub repository is configured for the project.

Before sending the evidence, the bundled Briar CLI adds the exact Briar issue
URL to the PR description and reads the PR through `gh api`. The evidence
includes GitHub's repository ID, PR ID, node ID, and PR number. Neither the
editable description nor the worker-supplied identity is trusted alone. Briar
accepts a merge only when the signed GitHub payload contains that exact
project/run link and its immutable identity matches the independently stored
evidence. The first non-merge delivery must also match the configured
`owner/repository` name. Later deliveries use the verified immutable IDs, so an
already-bound link survives a repository rename.

Provider and server receipt timestamps fence the evidence write and current run
revision. A snapshot whose merge or original receipt predates the link is not
adopted. GitHub timestamps are second-granularity, so the exact signed
project/run association plus server ordering handles a legitimate merge in the
same second without trusting the worker clock.

New URL-only evidence from an older CLI is rejected for the configured
repository: a deleted repository's name can be reused for a different
repository, so accepting only the URL could bind the wrong PR. Evidence that
predates this integration is intentionally not backfilled; an already-paused
run keeps the existing manual **Approve and continue** path. Start a new run
revision and record PR evidence with the matching bundled CLI to enable
automatic sync; adding another PR to the same legacy revision does not make the
unverifiable evidence safe.

For a current run revision with multiple linked PRs, Briar waits until all of
them are merged. Links from an earlier attempt or revision cannot approve a
newer checkpoint.

## State and retry behavior

- `opened`, `reopened`, draft, and ordinary updates store the current open state.
- `closed` with `merged: false` stores closed state and leaves review paused.
- Only `pull_request`, `action: closed`, and `merged: true` stores merged state
  and evaluates automatic resume.
- A run whose current revision belongs to an active Briar merge batch remains
  paused until every original PR in that batch has a signed merged delivery.
  The existing one-minute reconciliation resumes it after the batch completes.
- Merge state is stored before resume is attempted. If PR evidence is already
  linked and merge arrives before the run reaches its checkpoint, checkpoint
  creation immediately reconciles the stored state.
- If a merge races an evidence request that has already authenticated, the
  signed provider snapshot retains the exact project/run association. The
  evidence write consumes it after committing, so no manual redelivery is
  required.
- A PR whose signed merge snapshot predates its evidence remains on the existing
  manual **Approve and continue** path.
- `X-GitHub-Delivery` is the idempotency key. Completed redeliveries are no-ops;
  failed processing claims are released so the same delivery can be retried.
- Immediate resume is best-effort after the pause is committed. A one-minute
  scheduled reconciliation sweep retries any merged run left paused by a
  transient database failure.

GitHub does not automatically redeliver failed webhooks. Use the GitHub App's
Recent deliveries screen to redeliver a failed request after correcting the
configuration.
