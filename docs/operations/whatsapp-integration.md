# WhatsApp integration

Briar's Phase 1 WhatsApp integration bridges one Meta WhatsApp Business phone
number to one representative Organization Agent. Text sent from a linked phone
number becomes a user-authored direct message in Briar, so the existing reply,
delegation, organization-scope, and DM-memory pipeline remains authoritative.
Agent replies are delivered asynchronously through the WhatsApp Cloud API.

## 1. Configure Meta

Create or select a Meta app with the WhatsApp product and collect:

- App secret
- WhatsApp Business Account ID
- Phone number ID
- Permanent or otherwise operational Cloud API access token

Configure the callback URL as:

```text
https://<worker-host>/whatsapp/webhook
```

Choose a unique webhook verify token with at least 16 characters. Subscribe the
app to WhatsApp message events. The Worker validates the GET challenge against
the stored token hash and validates every POST with `X-Hub-Signature-256` before
accepting it.

## 2. Configure and deploy Briar

Generate a dedicated AES-256-GCM token-encryption key:

```sh
openssl rand -base64 32
```

Add both values to the encrypted `.env.production` file:

```dotenv
WHATSAPP_APP_SECRET=
WHATSAPP_TOKEN_ENCRYPTION_KEY=
```

These values are an optional deployment pair while WhatsApp is disabled. When
either value is present, both must be present. Do not reuse the Meta app secret
as the token-encryption key. Access tokens are encrypted before D1 storage and
are never returned by the settings API.

Apply the D1 migration and deploy:

```sh
bun run d1:migrate:remote
bun run worker:deploy
```

The Cloud API version defaults to `v25.0` through
`WHATSAPP_GRAPH_API_VERSION`. Change that Worker variable when upgrading the
Meta Graph API version.

## 3. Connect an organization

Phase 1 uses the authenticated Worker API instead of a settings screen. As an
organization owner or co-owner, send:

```http
PUT /organizations/<organization-id>/integrations/whatsapp
Content-Type: application/json

{
  "agentId": "<organization-agent-id>",
  "phoneNumberId": "<meta-phone-number-id>",
  "wabaId": "<whatsapp-business-account-id>",
  "accessToken": "<meta-access-token>",
  "verifyToken": "<webhook-verify-token>"
}
```

The representative must be an Organization Agent, not a project agent. An
organization can have only one active connection, and a Meta phone number can
belong to only one active connection.

Inspect the connection and linked users with:

```http
GET /organizations/<organization-id>/integrations/whatsapp
```

Disconnect with `DELETE` on the same URL. Disconnecting dead-letters pending
outbound messages and disables the user links attached to that connection.

## 4. Link user phone numbers

A phone-number link is the authorization boundary for creating a Briar DM. Add
a link for an existing organization member:

```http
PUT /organizations/<organization-id>/integrations/whatsapp/links
Content-Type: application/json

{
  "userId": "<briar-user-id>",
  "phoneNumber": "+821012345678"
}
```

Briar normalizes the number to digits before storage and matching. Remove a
link with:

```http
DELETE /organizations/<organization-id>/integrations/whatsapp/links/<link-id>
```

Messages from unlinked numbers do not create a DM. Briar only sends a link
instruction back to that number.

## 5. Delivery behavior

- Each Meta `wamid` is claimed once, so webhook retries do not duplicate the
  Briar message. Failed processing releases the claim for another delivery.
- Completed agent replies enter an outbox in the same database transaction as
  reply completion. Webhook handling and reply completion never wait on Meta.
- A minute cron retries transient Cloud API failures with exponential backoff.
  Exhausted messages remain as dead letters for operator inspection.
- Replies are downgraded from Markdown and split on Unicode boundaries into
  ordered messages of at most 4096 characters.
- Approval proposals become a text summary and Briar app link. Approval actions
  remain available only inside Briar.
- Replies outside Meta's 24-hour customer-service window are dead-lettered. The
  Phase 1 integration does not send template messages.

Phase 1 supports inbound and outbound text only. Media transfer, embedded Meta
signup, template messages, and a graphical settings or self-service linking
flow are deferred.
