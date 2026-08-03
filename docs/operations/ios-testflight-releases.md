# iOS TestFlight releases

Record each uploaded Briar Companion build after App Store Connect processing
finishes. A release is complete only when the build is valid and its internal
TestFlight state is `IN_BETA_TESTING`.

## Release implementation gate

`config/ios-release.json` is the reviewed source of truth for the iOS release
implementation. It starts with `tauri`, so merging the native app does not
silently replace the current App Store binary. Both implementations archive as
`app.briar.companion`; the native Development scheme remains isolated as
`app.briar.companion.native.dev`.

The selector has two intentionally different boundaries:

- `--channel internal --implementation native` is allowed before stabilization
  so a native candidate can reach Internal TestFlight.
- `--channel production --implementation native` fails until
  `nativeStabilization` records `status: passed`, the processed App Store build
  ID, and the approval time. Omitting `--implementation` always uses the
  checked-in default.
- `rollback.implementation` must remain `tauri`, and its generated iOS source
  must remain in the repository through version `1.3.0`. The configuration
  validator rejects removing this recovery path.

Every release command runs the shared API contract, Swift unit/UI suite,
accessibility and largest Dynamic Type UI audit on iPhone and iPad, static
analysis, session/download/log security checks, and the existing Tauri iOS and
Android regression builds before it archives anything.

The trusted release host must add `IOS_DISTRIBUTION_CERTIFICATE` (base64 `.p12`)
and `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` to the encrypted `.env.release`.
The certificate must contain an Apple Distribution identity for team
`QFJZ2V3829`; the Developer ID certificate used by the macOS release is not
interchangeable. The command imports it into an ephemeral keychain, restores
the user's original keychain search list, and deletes the temporary keychain on
every exit.

## Native Internal TestFlight candidate

Use a monotonically increasing App Store build number. The command decrypts the
existing App Store Connect API key only in a mode-0600 temporary directory,
requests automatic provisioning, verifies the archive bundle ID, distribution
signature, provisioning profile, production entitlements, and then uploads the
exact exported IPA.

```sh
bun run ios:release -- \
  --channel internal \
  --implementation native \
  --marketing-version 1.2.52 \
  --build-number 3 \
  --upload
```

Do not record the command's upload request ID as the stabilized build. Wait for
App Store Connect processing, select the processed build, and record its
immutable App Store build ID in the checklist below.

## Stabilization checklist

Keep the checked-in default on Tauri until all items are observed on the same
processed native build. Store measurements and screenshots with the release
record; a policy threshold is not evidence that the build met it.

- **Identity and migration:** upgrade the current Tauri TestFlight build in
  place, confirm the bundle ID remains `app.briar.companion`, and confirm the
  signed-in account opens without authentication. Then verify the plaintext
  Tauri `session.json` is gone only after the token is readable from the
  device-only Keychain. Also verify fresh install, sign-out, `401` expiry, and
  malformed/missing legacy session recovery. A Tauri rollback may require one
  sign-in because the native app never recreates the plaintext token file.
- **Accessibility and layout:** run VoiceOver through login, project selection,
  Tasks, Agents, Search, Inbox, settings, issue creation, and issue detail.
  Repeat with the largest accessibility text size on the smallest supported
  iPhone and an iPad in portrait and landscape; there must be no clipped required
  action or unreachable control.
- **Network and data:** verify launch while offline, recovery without relaunch,
  an interrupted request, a slow connection, cursor-expiry snapshot recovery,
  and upload/download at the contract limits of five files, 20 MB per file, and
  25 MB total. Attachment downloads must remain file-backed rather than loading
  the whole response into memory.
- **Performance and memory:** capture Instruments launch, hangs, allocations,
  leaks, and scrolling traces on a physical iPhone and iPad using a production
  archive. Compare them with the current Tauri build on the same devices and
  data set; investigate every regression before approval. Exercise repeated
  foreground/background, project switching, image preview, and a long task list.
- **Security:** confirm no bearer token, authorization header, session payload,
  local path, or attachment body appears in unified logs or crash diagnostics.
  Confirm the archive has no `get-task-allow`, uses the App Store profile, and
  contains only the expected associated-domain entitlement.
- **Regression and stability:** the automated mobile quality gate must pass;
  there must be no unresolved release-blocking crash, hang, data-loss,
  authentication, or accessibility defect during the internal observation
  period. Record the observation dates, testers/devices, crash/hang metrics, and
  every accepted limitation rather than using an unmeasured generic pass.

After approval, update `config/ios-release.json` in a reviewed PR:

```json
{
  "defaultImplementation": "native",
  "nativeStabilization": {
    "status": "passed",
    "buildId": "APP-STORE-CONNECT-BUILD-ID",
    "approvedAt": "2026-08-10T09:00:00+09:00"
  }
}
```

Keep the other fields unchanged. `bun run ios:release:verify` must pass. The
next Production invocation can then omit `--implementation` and will resolve to
native.

## Production and rollback

Production uses the same fail-closed archive path and still requires an
explicit `--upload`:

```sh
bun run ios:release -- \
  --channel production \
  --marketing-version 1.2.52 \
  --build-number 4 \
  --upload
```

If native stabilization or production monitoring finds a release blocker,
build the preserved Tauri source explicitly with a new build number:

```sh
bun run ios:release -- \
  --channel production \
  --implementation tauri \
  --marketing-version 1.2.52 \
  --build-number 5 \
  --upload
```

App Store Connect does not support downgrading an already installed build. The
rollback is therefore a new Tauri binary using the same App Store identity.
Confirm reauthentication, deep links, notifications, alternate icons, and the
Android regression build before release. Do not delete the Tauri iOS source
until the configured retention version has shipped and the rollback window has
been closed in a separate reviewed change.

## 2026-07-27

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.1.1`
- App Store Connect build: `2`
- App Store Connect build ID: `d6b69cc5-cf16-49fc-beaa-25ad8bdadccb`
- Source commit: `3acdedb`
- Toolchain: Xcode 26.6, iOS 26.5 SDK, Tauri CLI 2.11.4
- Minimum iOS version: 14.0
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled

The release build passed all 337 frontend tests and the release frontend
configuration check. Xcode Organizer performed the final Wordbricks
distribution signing and App Store Connect upload.

## 2026-08-04

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.53`
- App Store Connect build: `2`
- App Store Connect build ID: `34f15ecf-d9b5-4245-ab2c-655d61f152fc`
- Source commit: `b5b3c378263cbc6c65416dcd8adc32a1d284008f`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- Delivery UUID: `34f15ecf-d9b5-4245-ab2c-655d61f152fc`
- IPA SHA-256: `84bfa5059ccacbbb092d3bf21a48c4a870982732f3f06625e997a6a6c54e5b0e`

The shared Companion API contract, iPhone unit/UI suite, iPad VoiceOver and
largest Dynamic Type layout suite, Production static analysis and unsigned
build, session/download/log security checks, Tauri iOS simulator build, and
Tauri Android debug build all passed. The signed archive was also verified for
its App Store profile, production entitlements, bundle identity, and compiled
primary and alternate app icons before upload.
