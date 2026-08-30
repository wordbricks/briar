# Mobile push notifications

Briar Companion uses provider-delivered remote notifications when iOS or
Android is suspended or terminated. The Worker reads the same per-user Inbox
feed and notification preferences as the foreground clients, then delivers
eligible messages through APNs or Firebase Cloud Messaging (FCM). Foreground
polling remains the fallback and suppresses a local notification when the same
message was already delivered remotely.

## Provider configuration

Store provider credentials only in the encrypted `.env.production` file. Each
provider is an optional all-or-nothing group:

- APNs requires `APNS_KEY_ID` and `APNS_PRIVATE_KEY`. The checked-in Worker
  configuration supplies Apple team `QFJZ2V3829` and the app registers topic
  `app.briar.companion` for Production builds.
- FCM requires `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
  `FIREBASE_PRIVATE_KEY` from one service account with permission to send
  Firebase Cloud Messaging messages.

Use `dotenvx set` to add each value, run
`bun run secrets:verify-encrypted`, and deploy through the existing Worker
deployment command. A partially configured provider group is rejected before
deployment. Never commit an APNs private key or Firebase service-account JSON
in plaintext.

The Android application also needs these public Firebase identifiers in the
release environment used by the Tauri build:

- `BRIAR_FIREBASE_ANDROID_APPLICATION_ID`
- `BRIAR_FIREBASE_ANDROID_API_KEY`
- `FIREBASE_PROJECT_ID`
- `BRIAR_FIREBASE_MESSAGING_SENDER_ID`

These values are compiled into Android `BuildConfig`; they are identifiers, not
service-account credentials. If any value is empty, the Android app deliberately
skips Firebase initialization and does not register a device token.

The iOS App Store provisioning profile must include the Push Notifications
capability. Development builds register with the APNs sandbox, while Production
builds register with APNs production.

## Release verification

Verify both platforms with signed builds and physical devices:

1. Sign in, grant notification permission, and confirm the Worker has accepted
   the device registration.
2. Terminate the app, create one eligible Inbox event from another account, and
   confirm an OS notification arrives without reopening the app.
3. Tap the notification from a cold start and confirm Briar opens the referenced
   issue, conversation, session, or channel thread.
4. Repeat with the app backgrounded, then bring it foreground and confirm the
   same message is not notified a second time by local polling.
5. Disable each notification category and confirm matching messages are silent;
   mark a message read before delivery and confirm it is not pushed.
6. Sign out and confirm the device registration is removed. Also rotate or
   invalidate a provider token and confirm the Worker removes the stale
   registration without blocking other devices.

Provider failures are retried by the independent push outbox and do not block
Inbox persistence or websocket realtime delivery. The Worker limits one flush
to five grouped alerts per device so recovery from a long offline interval does
not flood the user.
