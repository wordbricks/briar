# Slack integration

Briar's Slack app creates an issue when someone mentions `@Briar`. Each
connected Slack workspace has one default Briar project, which an organization
owner or admin can change in **Organization settings → Integrations**.

## 1. Create the Slack app

1. Open [Slack API: Your Apps](https://api.slack.com/apps), choose
   **Create New App → From an app manifest**, and select the target workspace.
2. Copy [`config/slack-app-manifest.yaml`](../../config/slack-app-manifest.yaml)
   into the manifest editor.
3. Replace both `YOUR_BRIAR_API_HOST` placeholders with the public hostname of
   the deployed Worker, without a trailing slash.
4. Create the app. Under **Basic Information**, copy the Client ID, Client
   Secret, and Signing Secret.

The configured URLs must be:

- OAuth redirect:
  `https://<worker-host>/slack/oauth/callback`
- Events request URL:
  `https://<worker-host>/slack/events`

Slack verifies the Events URL by sending a signed challenge. The Worker rejects
unsigned requests and signed requests older than five minutes.

## 2. Configure and deploy Briar

Set these encrypted values in `.env.production`:

```dotenv
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
SLACK_TOKEN_ENCRYPTION_KEY=
```

Generate a dedicated token-encryption key:

```sh
openssl rand -base64 32
```

Do not reuse the Slack signing or client secret for encryption. Briar derives an
AES-256-GCM key from `SLACK_TOKEN_ENCRYPTION_KEY`; OAuth bot tokens are never
stored in plaintext.

Apply the D1 migration and deploy:

```sh
bun run d1:migrate:remote
bun run worker:deploy
```

## 3. Connect a workspace

1. In Briar, open **Organization settings → Integrations**.
2. Choose the default project and click **Add Slack workspace**.
3. Approve the requested Slack permissions.
4. Return to Briar and refresh the Slack connection card.

The person connecting Slack must be a Briar organization owner or admin and
must be permitted to install apps in the Slack workspace.

For private Slack channels, invite the bot first:

```text
/invite @Briar
```

## Create issues

The first non-empty line becomes the title. Additional lines become the issue
description.

```text
@Briar 로그인 버튼이 동작하지 않아요
Safari에서 OAuth 후 돌아오면 버튼이 비활성화됩니다.
```

Supported options:

- `--priority P1` through `--priority P4`
- `--priority urgent|high|medium|low`
- `--backlog` to create without immediately adding the issue to Auto Hunt

Example:

```text
@Briar 결제 완료 화면이 비어 있어요 --priority high --backlog
```

Mention `@Briar help` or `@Briar 도움말` to show usage in Slack.

Each Slack event ID is claimed before processing, so Slack retries do not create
duplicate issues. Failed events are released for a later retry.

## Access model

Anyone who can mention the installed bot in a channel can create an issue in
that workspace's selected default project. Do not add Briar to external shared
channels unless those participants should have that ability. Disconnecting a
workspace removes the stored encrypted bot token from Briar; remove the app in
Slack as well if it should no longer appear there.
