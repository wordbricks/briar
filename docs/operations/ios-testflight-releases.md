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

## 2026-08-05 — 1.2.71 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.71`
- App Store Connect build: `1`
- App Store Connect build ID: `54e06c4a-f9c0-435a-8110-f8c379b88715`
- Latest main commit: `b28b08b`
- Release source commit: `553a608e726cbf9833fd790c77beadcfd91e8271`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `e40ef2bb10be6856e6281bae5870e0bd92c3ea856654d77fb252eb3773e1140e`

The release passed the shared API contract, Swift unit and UI tests, iPhone and
iPad accessibility, Dynamic Type and layout audits, Production analyze and
build checks, session/download/log security checks, and the Tauri iOS and
Android regression builds. Archive identity, App Store provisioning,
distribution signature, production entitlements, and all alternate app icons
were verified before upload.

## 2026-08-06 — 1.2.72 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.72`
- App Store Connect build: `1`
- App Store Connect build ID: `67eb703e-c578-4adc-b4a2-6603884aadce`
- Latest main commit: `761bbe9`
- Release source commit: `c42c865056cb6968f4ec16889d3512aa31ef753f`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `1c76f7bc16cbcb2c158a9b789fdbd6ada1a38b9ad830c0abe97cae136f902d9d`

The release passed the shared API contract, Swift unit and UI tests, iPhone and
iPad accessibility and layout tests, Production analyze and build checks,
session/download/log security checks, and the Tauri iOS and Android regression
builds. The completed-issue UI test now verifies the selected Result tab and
visible result content instead of relying on an overwritten list accessibility
identifier. Archive identity, App Store provisioning, distribution signature,
production entitlements, and all alternate app icons were verified before
upload.

## 2026-08-06 — 1.2.77 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.77`
- App Store Connect build: `1`
- App Store Connect build ID: `da37daae-cb38-429f-a01d-bfb089afb350`
- Latest main commit: `00fed4b1`
- Release source commit: `52fd88678135879f083a069a94e17c84a692172a`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `9903d192c6db27c0ed4b7e0be022bfb9c3b4d6077a8077cbfaac7ad02983360f`

The release passed the shared API contract, Swift unit and UI tests, iPhone and
iPad accessibility and layout tests, Production analyze and build checks, and
the Tauri iOS and Android regression builds. It restores Swift 6 compilation,
uses the iOS-supported paste button for clipboard image attachments, and makes
dependency selection reliable on iOS 26. Archive identity, App Store
provisioning, distribution signature, production entitlements, and all
alternate app icons were verified before upload.

## 2026-08-07 — 1.2.79 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.79`
- App Store Connect build: `2`
- App Store Connect build ID: `3303ae5f-8a68-4578-82d8-237611738bc9`
- Latest main commit: `85d8094e`
- Release source commit: `85d8094ea6563c68302522a5e73c0bdbb828a1b9`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `a82a5079076837534d8a33eb0296601c82d8babc4c3871c527622556e4daf611`

The release passed the shared API contract, Swift unit and UI tests, iPhone and
iPad accessibility and layout tests, Production analyze and build checks,
session/download/log security checks, and the Tauri iOS and Android regression
builds. Archive identity, App Store provisioning, distribution signature,
production entitlements, and all alternate app icons were verified before
upload.

Build `1` (`54b73944-44b2-4a25-9059-4df289c9ee9e`) was processed as `VALID`
from commit `6fad1765abe9fe6b7e610e26a08a8200db3cacd6`. While Apple was processing it,
main advanced to `85d8094e`; build `2` was rebuilt and revalidated from that
new latest main commit and is the final build handed off for this release.

## 2026-08-07 — 1.2.79 (3)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.79`
- App Store Connect build: `3`
- App Store Connect build ID: `9539daa7-6d23-40aa-8cc3-af2ca14e3401`
- Latest main commit: `fff1856e`
- Release source commit: `fff1856e54b28549750465164239e2aaf6c7f56b`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `651ba75e0d4f6f154b491cd4ad1841e93ceb517fcbb1b766677542d955cf3494`

The release includes the improved mobile channel conversation UI and the
Swift compatibility fix merged in PR #711. It passed the shared API contract,
Swift unit and UI tests, iPhone and iPad accessibility and layout tests,
Production analyze and build checks, session/download/log security checks, and
the Tauri iOS and Android regression builds. Archive identity, App Store
provisioning, distribution signature, production entitlements, and all
alternate app icons were verified before upload.
