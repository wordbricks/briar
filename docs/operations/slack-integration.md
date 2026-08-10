# Slack integration

Briar's Slack app exposes a **Create a Briar issue** global shortcut, which is
searchable from Slack's `/create` menu, and also opens the issue form directly
with the `/create` slash command. The form lets a user choose a Briar project
and enter a title, description, and attachments.
`@Briar` mentions remain available as a quick text-only intake path. Each
connected Slack workspace has one default Briar project, which an organization
owner or admin can change through the authenticated organization Slack API.

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
- Slash command:
  `https://<worker-host>/slack/commands`
- Interactivity:
  `https://<worker-host>/slack/interactions`
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

Slack connection is not currently exposed in **Organization settings →
Integrations**. Use the authenticated Worker API until that UI is restored:

1. As a Briar organization owner or admin, send `POST
   /organizations/<organization-id>/slack` with a bearer token and JSON body
   `{ "defaultProjectId": "<project-id>" }`.
2. Open the returned `installUrl` and approve the requested Slack permissions.
3. Confirm the installation with `GET
   /organizations/<organization-id>/slack`.

Change the default project with `PUT
/organizations/<organization-id>/slack/installations/<team-id>` and the same
JSON body. Disconnect with `DELETE` on that installation URL.

The person connecting Slack must be a Briar organization owner or admin and
must be permitted to install apps in the Slack workspace.

After changing shortcut or slash-command configuration, apply the updated app
manifest. Slack propagates shortcuts to existing installations. If an existing
installation predates the `commands` or `files:read` scopes, reinstall that
workspace because existing bot tokens do not automatically receive new scopes.

For private Slack channels, invite the bot first:

```text
/invite @Briar
```

## Create issues from Slack's `/create` menu

Enter `/create` in any Slack message composer and choose **Create a Briar
issue**. Briar opens the issue form without requiring any command text.

## Create issues with the `/create` slash command

Send `/create` directly in any Slack message composer. Briar opens a modal with:

- Project, preselected to the workspace's default Briar project
- Title
- Optional description
- Up to five optional image or video attachments

The optional text after the command pre-fills the title:

```text
/create 로그인 버튼이 동작하지 않아요
```

Submitted issues enter the Auto Hunt queue. Briar sends the invoking user an
ephemeral confirmation containing the project and issue ID. Attachments use the
same limits as the Briar app: JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, or
QuickTime; 20MB per file and 25MB total.

## Quick text intake with `@Briar`

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

Anyone who can use the **Create a Briar issue** shortcut, `/create`, or mention
the installed bot can create an issue in one of the Briar organization
projects exposed by that workspace connection. Do not add Briar to external
shared channels unless those participants should have that ability.
Disconnecting a workspace removes the stored encrypted bot token from Briar;
remove the app in Slack as well if it should no longer appear there.
