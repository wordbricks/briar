# iOS TestFlight releases

Record each uploaded Briar Companion build after App Store Connect processing
finishes. A release is complete only when the build is valid and its internal
TestFlight state is `IN_BETA_TESTING`.

## Native-only release contract

`config/ios-release.json` declares a single `native` implementation. The release
command always archives `BriarCompanion-Production` from the SwiftUI Xcode
project; it has no implementation selector and no Tauri fallback. The
Production scheme preserves the existing App Store bundle ID
`app.briar.companion`, while the Development scheme remains isolated as
`app.briar.companion.native.dev`.

Every release command validates the shared API contract, runs the Swift App,
Unit, UI, accessibility and largest Dynamic Type checks on iPhone and iPad,
analyzes and builds the Production configuration, checks session/download/log
security invariants, and builds the retained Tauri Android app before archiving
iOS. `bun run ios:release:verify` also rejects obsolete Tauri Apple sources if
they are reintroduced.

The trusted release host must provide the encrypted Apple Distribution
certificate and password. The certificate must belong to team `QFJZ2V3829`.
The command imports it into an ephemeral keychain, restores the user's original
keychain search list, and deletes the temporary keychain on every exit.

Configure and verify APNs before distributing a build by following
[Mobile push notifications](mobile-push-notifications.md). The active App Store
provisioning profile must include the Push Notifications capability, and the
terminated-app delivery check must run on a physical device.

## Internal TestFlight candidate

Use a monotonically increasing App Store build number. The command decrypts the
App Store Connect API key only in a mode-0600 temporary directory, requests
automatic provisioning, verifies the archive bundle ID, distribution signature,
provisioning profile and production entitlements, then uploads the exact exported
IPA.

```sh
bun run ios:release -- \
  --channel internal \
  --marketing-version 1.2.169 \
  --build-number 1 \
  --upload
```

Wait for App Store Connect processing and record the immutable processed build
ID rather than the upload request ID.

## Release checklist

- **Identity and migration:** when testing an upgrade from a previously shipped
  Tauri build, confirm the bundle ID remains `app.briar.companion`, the signed-in
  account opens without authentication, and the plaintext legacy `session.json`
  is deleted only after the token is readable from the device-only Keychain.
  Also verify fresh install, sign-out, `401` expiry, and malformed or missing
  legacy session recovery.
- **Accessibility and layout:** run VoiceOver through login, project selection,
  Tasks, Agents, Search, Inbox, settings, issue creation, and issue detail. Repeat
  with the largest accessibility text size on the smallest supported iPhone and
  an iPad in portrait and landscape.
- **Network and data:** verify offline launch and recovery, interrupted and slow
  requests, cursor-expiry snapshot recovery, and upload/download at the contract
  limits of five files, 20 MB per file, and 25 MB total. Downloads must remain
  file-backed.
- **Performance and memory:** capture production-archive launch, hangs,
  allocations, leaks, scrolling, foreground/background, project switching,
  image preview, and long-list traces on physical iPhone and iPad devices.
- **Security:** confirm secrets and attachment bodies do not appear in logs or
  crash diagnostics. Confirm the archive has no `get-task-allow`, uses the App
  Store profile, and contains only the expected associated-domain entitlement.
- **Regression and stability:** the automated mobile gate must pass, including
  the Android Tauri regression build. Record observation dates, devices,
  crash/hang metrics, and accepted limitations for the processed iOS build.

## Production and recovery

Production uses the same native-only archive path and requires explicit upload:

```sh
bun run ios:release -- \
  --channel production \
  --marketing-version 1.2.169 \
  --build-number 2 \
  --upload
```

App Store Connect does not support downgrading an installed build. If monitoring
finds a release blocker, fix the SwiftUI implementation, increment the build
number, repeat the full gate, and submit the corrected native build. There is no
Tauri iOS rollback binary or source-retention policy.

## 2026-08-30 — 1.2.172 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.172`
- App Store Connect build: `1`
- App Store Connect build ID: `ed8f0017-6397-43be-9469-87e7a7c29587`
- Latest main commit: `95bf188eca59d60507b54a6eb17e7ae27c373b6b`
- Release source commit: `7c27c93c3a98e3486a5e3758ff3776ef98a47f0c`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `e747f6d9219c051c553eff44c8e1b49f6d220ae0f75fe3c48d7f12a72602193f`

The release passed the shared API contract (12/12), Swift unit tests, 19 iPhone
UI tests, iPad accessibility checks, Production analyze/build, session/download/
log security invariant checks, and the retained Tauri Android arm64 debug
regression build. The release gate was updated to enter issue creation through
the current Tasks floating menu. The archive identity, App Store provisioning,
distribution signature, and production entitlements were independently verified
before the exact exported IPA was uploaded.

## 2026-08-28 — 1.2.170 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.170`
- App Store Connect build: `1`
- App Store Connect build ID: `0a9d6ea1-c986-419e-882c-7b8ae885e0a2`
- Latest main commit: `47b50f65ce19e0fd8a1877881a417dce59711e1e`
- Release source commit: `7b9f97f5c88e47147feb1615536fb32264a5c1fd`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `3097bc4ab2d18b4c9973c8baf92145d8d20b95abda4cba212e0d5393c6fa820e`

The release passed the shared API contract (12/12), Swift unit tests, 17 iPhone
UI tests, iPad accessibility checks, Production analyze/build, session/download/
log security invariant checks, and the retained Tauri Android arm64 debug
regression build. The archive identity, App Store provisioning, distribution
signature, and production entitlements were independently verified before the
exact exported IPA was uploaded.

## 2026-08-28 — 1.2.168 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.168`
- App Store Connect build: `1`
- App Store Connect build ID: `b89eeb18-97b3-439b-82ec-43eaf6dce255`
- Latest main commit: `90ac23d23471d5d9dadeb1cb868c62ca87acf05a`
- Release source commit: `90ac23d23471d5d9dadeb1cb868c62ca87acf05a`
- Implementation: Tauri
- Toolchain: Xcode 26.6, iOS 26.5 SDK, Tauri CLI 2.11.4
- Minimum iOS version: 14.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Automatic tester notification: enabled
- IPA SHA-256: `389474240eb2e52ee023a8c455d50b4dd370988b9d423d109a54daa5d05db00d`

The release passed the shared API contract, Swift unit/UI tests, iPhone and
iPad accessibility/layout checks, Production analyze/build, session/download/
log security checks, and Tauri iOS/Android regression builds. The archive
identity, App Store provisioning, distribution signature, and production
entitlements were independently verified before upload. App Store Connect
reported the minimum iOS 14.0 setting as a future Spring 2027 upload warning.

## 2026-08-24 — 1.2.154 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.154`
- App Store Connect build: `1`
- App Store Connect build ID: `350abd8d-d5fe-4777-ad91-78d134ae6817`
- Latest main commit: `e4c8a138b67a14e521cf5146d815cc9e26976eb2`
- Release source commit: `db2222d2cf23c6e01161d1e3fbd1b0d6f0e4e2c5`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `2cdb3d1e64d13e979685dacd8d3a0702937827f7f20b53bdf2f5bc879d6b1bf9`

The release passed the shared API contract, Swift unit/UI tests, iPhone and
iPad accessibility/layout checks, Production analyze/build, session/download/
log security checks, and Tauri iOS/Android regression builds. The archive
identity, App Store provisioning, distribution signature, and entitlements
were independently verified before upload.

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

## 2026-08-08 — 1.2.87 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.87`
- App Store Connect build: `1`
- App Store Connect build ID: `060f1151-278d-452e-a7aa-d46812b0c071`
- Latest main commit: `35140950`
- Release source commit: `35140950e90a0a3436aac10301c23e25576a8717`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `868ec67eab8169c3afc2eb263b08d46c6d4a43ef541b14ba3d2bc9398e2d3001`

The release includes the native iOS fix that shows the full channel roster as
soon as `@` is typed, the mobile channel issue-proposal approval flow, and the
1.2.87 release metadata. It passed the shared API contract, Swift unit and UI
tests, iPhone and iPad accessibility and layout tests, Production analyze and
build checks, session/download/log security checks, and the Tauri iOS and
Android regression builds. Archive identity, App Store provisioning,
distribution signature, production entitlements, and all alternate app icons
were verified before upload.

Build `1` of version `1.2.86` (`5da89954-fc49-49ec-bc9f-7dc43c31ece3`)
processed as `VALID` from commit
`5a283951d7489706863cb900b738cf790ca03d05`. Main then advanced through a
mobile-path change and the `1.2.87` version release, so `1.2.87 (1)` is the
final build handed off for this release.

## 2026-08-08 — 1.2.88 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.88`
- App Store Connect build: `1`
- App Store Connect build ID: `c9ae20f2-29b8-4a2a-9db7-7b97e67f9601`
- Latest main commit: `ed8188af`
- Release source commit: `ed8188af07220bfe7dde8729a872bf07a67e10de`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `04eba6b2100ccc7fe1e94103ec7ea6c4f64495c25d8788d5bc1eec791a2e32b9`

The release includes project-agent execution on selected workers, channel
notifications in Inbox, blue mention links and issue autocomplete, and the
redesigned channel detail header. It passed the shared API contract, Swift unit
and UI tests, iPhone and iPad accessibility and layout tests, Production
analyze and build checks, session/download/log security checks, and the Tauri
iOS and Android regression builds. Archive identity, App Store provisioning,
distribution signature, production entitlements, and all alternate app icons
were verified before upload.

## 2026-08-08 — 1.2.90 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.90`
- App Store Connect build: `1`
- App Store Connect build ID: `88aeff4c-21ed-4c41-a333-55c45cd2e07d`
- Latest main commit: `3ff10049`
- Release source commit: `3ff10049a1dd4eee9587a16673f7d9ee8da8c6a7`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `cdeece0390c6a4799eab0c65710bc4c32a2ff92ff97bafcf3f59402039787ad9`

The release includes canonical threaded-reply message IDs on mobile, exact
agent-task claim routing, continued active runs across agent turns, and the
removal of workflow v1 compatibility. It passed the shared API contract, Swift
unit and UI tests, iPhone and iPad accessibility and layout tests, Production
analyze and build checks, session/download/log security checks, and the Tauri
iOS and Android regression builds. Archive identity, App Store provisioning,
distribution signature, production entitlements, and all alternate app icons
were verified before upload.

## 2026-08-08 — 1.2.91 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.91`
- App Store Connect build: `1`
- App Store Connect build ID: `23c34ef3-b469-4aa6-b6f2-8a96c39b9ec6`
- Latest main commit: `da2885e7`
- Release source commit: `da2885e75d255095a22523df08c99a50e6676812`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `be89a5d26ec9c57131df724dcb8111da4fcc1b6a9e621a39cb6165110c0a5fc1`

The release includes canonical iOS agent execution IDs, terminal-state Inbox
notification filtering, and the 1.2.91 release metadata. The first latest-main
gate exposed a stale uppercase UUID expectation, which was corrected and
merged in PR #793 before the release archive was created. The corrected source
passed the shared API contract, Swift unit and nine UI tests, iPhone and iPad
accessibility and layout tests, Production analyze and build checks,
session/download/log security checks, and the Tauri iOS and Android regression
builds. Archive identity, App Store provisioning, distribution signature,
production entitlements, and all alternate app icons were verified before
upload.

Build `1` of version `1.2.90`
(`88aeff4c-21ed-4c41-a333-55c45cd2e07d`) remains `VALID`, but main advanced
through the iOS execution-ID fix, notification filtering, and the 1.2.91
release. Version `1.2.91 (1)` is therefore the final build handed off from
the latest main commit.

## 2026-08-10 — 1.2.99 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.99`
- App Store Connect build: `1`
- App Store Connect build ID: `dbd60e93-fbaf-420b-b3a3-84199af3f663`
- Latest main commit: `4462418a`
- Release source commit: `4462418aa291f4967e9be7b60f5603e565fa9ca3`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `43bdcd09ffe535f17550a993825f43a6b4f90417c8807054a760eb784e34ef6c`

The release includes concurrent project-agent runs, inline issue editing, full
auto mode for issues, emoji reactions and reply participants in channel
conversations, usage-ledger cost reporting, and the iOS tasks-loading fix. The
latest-main gate exposed a stale blocked-status UI test expectation, which was
corrected and merged in PR #867 before the release archive was created. The
corrected source passed the shared API contract, Swift unit and UI tests,
iPhone and iPad accessibility and layout tests, Production analyze and build
checks, session/download/log security checks, and the Tauri iOS and Android
regression builds. Archive identity, App Store provisioning, distribution
signature, production entitlements, and all alternate app icons were verified
before upload.

The prior final handoff, `1.2.91 (1)`, remains `VALID`, but main advanced
through the 1.2.99 release. Version `1.2.99 (1)` is therefore the final build
handed off from the latest main commit.

## 2026-08-11 — 1.2.99 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.99`
- App Store Connect build: `2`
- App Store Connect build ID: `8ffbbb10-7713-4643-ad62-ef93fb78a870`
- Release base main commit: `513a3dde`
- Release source commit: `eeb6af7a40b45e3e55a4c494647b7255d81f01b0`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `5f574e70206a7a16b35ae57e720938a0c648319ab63108075cced40b68c8a175`

The release passed the shared API contract, Swift unit and UI tests, iPhone
and iPad accessibility and layout tests, Production analyze and build checks,
session/download/log security checks, and the Tauri iOS and Android regression
builds. Archive and IPA export used the Apple Distribution identity and the
App Store provisioning profile with the production Associated Domains
entitlement verified before upload. The release gate also increased the native
UI transition wait to tolerate slow simulator startup. The checked-in default
implementation remains Tauri and `nativeStabilization` remains unset pending
the internal observation checklist.

## 2026-08-11 — 1.2.103 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.103`
- App Store Connect build: `1`
- App Store Connect build ID: `44a663e2-f7e5-4e8c-a179-7d7cfe6ea743`
- Latest main commit: `09ce884a`
- Release source commit: `09ce884a91c4fa28efe1e349f967a39f398f71e9`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `0a07f5ad3f5fd2d9dd6c6762528eaa45bceed0969836a4c64abe768fcda264b8`

The release includes native iOS localization, synchronized Inbox read state,
conversational issue creation and execution approvals, natural-language
Project Agent Skill execution approval, connected mention buttons, and stable
conversation image loading. The latest-main gate exposed Swift 6 inference,
actor-isolation, helper-shadowing, and channel-delta fixture validation
regressions. They were corrected and merged in PR #894 before the archive was
created.

The corrected source passed the shared API contract, Swift unit and 12 UI
tests, iPhone and iPad accessibility and layout tests, Production analyze and
build checks, session/download/log security checks, and the Tauri iOS and
Android regression builds. Archive identity, App Store provisioning,
distribution signature, production entitlements, and all alternate app icons
were verified before upload.

The prior final handoff, `1.2.99 (2)`, remains `VALID`, but main advanced
through the 1.2.103 release. Version `1.2.103 (1)` is therefore the final build
handed off from the latest main commit.

## 2026-08-12 — 1.2.106 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.106`
- App Store Connect build: `1`
- App Store Connect build ID: `39631998-ba22-470e-98aa-7d6738674485`
- Latest main commit: `ed911768`
- Release source commit: `ed9117682e86c0d571a5df2e8a686b3c1a7d7366`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `a81d5108ab9767b65b99735ddcb85a2a4bdb204f7da90b0168b30c5921715cc1`

The release includes the restored native channel UI, cross-project Inbox
polling, Worker permissions for conversation agents, SSE and delta-based
channel synchronization, optimized dashboard, tray, and project-agent
synchronization, migration-first Worker claims, and Organization Agent
context. Main advanced once during the release gate with README and landing
copy changes only; the archive was nevertheless regenerated from the new exact
main commit before upload.

The release passed the shared mobile contract, Swift compile, unit and UI
tests, iPhone and iPad accessibility and layout tests, Production analyze and
build checks, and the Tauri iOS simulator and Android ARM64 regression builds.
Archive identity, App Store provisioning, distribution signature, production
entitlements, exported IPA signature, and all alternate app icons were
verified before upload.

The prior final handoff, `1.2.103 (1)`, remains `VALID`, but main advanced
through the 1.2.106 release. Version `1.2.106 (1)` is therefore the final build
handed off from the latest main commit.

## 2026-08-12 — 1.2.107 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.107`
- App Store Connect build: `1`
- App Store Connect build ID: `6b0b6de5-f61e-4d65-b477-0b8594303e5a`
- Latest main commit: `9f91eb08`
- Release source commit: `9f91eb08d84d889fc1985cdcd1bd9b26350b9cc4`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `2ba6e90e3aedba27c9f43b793e93f46fe970f0ff4330eff083bab3d4c5cfd239`

Main advanced after the 1.2.106 upload with canonical Inbox session versions,
the repeated Inbox session notification fix, and the 1.2.107 release metadata.
The exact new main commit passed the shared mobile contract, Swift compile,
unit and UI tests, iPhone and iPad accessibility and layout tests, Production
analyze and build checks, and the Tauri iOS simulator and Android ARM64
regression builds. Archive identity, App Store provisioning, distribution
signature, production entitlements, exported IPA signature, and all alternate
app icons were verified before upload.

Build `1` of version `1.2.106`
(`39631998-ba22-470e-98aa-7d6738674485`) remains `VALID`, but main advanced
through the Inbox session fix and the 1.2.107 release. Version `1.2.107 (1)` is
therefore the final build handed off from the latest main commit.

## 2026-08-12 — 1.2.111 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.111`
- App Store Connect build: `2`
- App Store Connect build ID: `631b2583-6d79-4960-a3c8-3ee6871d3103`
- Latest main commit: `1580b5a6`
- Release source commit: `3032eaf67f098b2b6ae97185975ed9b1eac240de`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `fe8e9f8ffb19e14d7eed3fa4d84a29b61227f4d76c34d56946a3f770da55148b`

This candidate includes the latest main Inbox full-screen UI change and the
Swift 6 release-gate compatibility fix. The exact source commit passed the
shared mobile contract, Swift compile, unit and UI tests, iPhone and iPad
accessibility and layout tests, Production analyze and build checks, and the
Tauri iOS simulator and Android ARM64 regression builds. Archive identity, App
Store provisioning, distribution signature, production entitlements, and the
exported IPA were verified before upload.

## 2026-08-13 — 1.2.117 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.117`
- App Store Connect build: `1`
- App Store Connect build ID: `5a9075c4-7b9e-4287-960c-ed7dd0db173a`
- Latest main commit: `78204df5`
- Release source commit: `78204df5feab06182a31c3f5170aeb655cbf5cbf`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `c68544865bc4abe9a9578d495c7cd53e9ee3df9e69d093e23b7aa81ea9f41e06`

This release includes the default Developer agent responsibility for owning
development work, Inbox channel alerts opening in the detail panel, corrected
mobile Inbox conversation navigation, improved channel Markdown readability,
agent avatars, channel mention pills, the simplified project sidebar, and the
latest thread typing and Codex token-usage fixes.

The latest-main release gate exposed a misplaced SwiftUI Agents toolbar and
incomplete issue-creation fixtures. They were corrected and merged in PR #989
before the archive was created. The exact merged source passed 1,890 app and
Worker tests, D1 migration, Rust, and security sign-off, plus the shared mobile
contract, Swift unit and 13 iPhone UI tests, iPad accessibility and layout
testing, Production analyze and build checks, the Tauri iOS simulator bundle,
and the Android ARM64 APK build. Archive identity, App Store provisioning,
distribution signature, production entitlements, exported IPA signature, and
all alternate app icons were verified before upload.

The prior final handoff, `1.2.111 (2)`, remains `VALID`, but main advanced
through the 1.2.117 release and the release-gate fixes. Version `1.2.117 (1)` is
therefore the final build handed off from the latest main commit.

## 2026-08-13 — 1.2.118 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.118`
- App Store Connect build: `2`
- App Store Connect build ID: `b35283b6-76de-44c3-b010-821d9fd685b2`
- Latest main commit: `4e83ec80`
- Release source commit: `4e83ec80dfe49c22e8d02a1757414871319dccbf`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `1d826f1569950beec0cf7ebc187a7d9679b484028ca8972cfdfb6fdfdd817001`

This release includes the latest main project badges in Inbox icons. The exact
source commit passed the shared mobile contract, Swift unit and 13 iPhone UI
tests, iPad accessibility and layout testing, Production analyze and build
checks, session/download/log security checks, and the Tauri iOS simulator and
Android ARM64 regression builds. Archive identity, App Store provisioning,
distribution signature, production entitlements, and the exported IPA were
verified before upload.

Build `1` of version `1.2.118`
(`6c2136ff-fbbf-4c40-a0c5-5179fb40a0be`) remains `VALID`, but main advanced
through PR #1001 while that candidate was being released. Build `2` above also
remains `VALID`, but main advanced through PRs #1002 and #1003 before the final
candidate below was released.

## 2026-08-13 — 1.2.118 (3)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.118`
- App Store Connect build: `3`
- App Store Connect build ID: `9a34f8e4-7c69-4477-b489-d4efa3565d11`
- Latest main commit: `24c8590a`
- Release source commit: `24c8590a172b266d57626d280a322c21a09c6ae1`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `efb5a46bf088ece96814e27e4dfb70ea1cb44d81412b1c2b28b28d07d0d54ba2`

This is the final internal TestFlight handoff from the latest main commit. It
includes the latest mobile channel header, composer, and mention-chip updates
from PRs #1002 and #1003. The exact source commit passed the shared mobile
contract, Swift unit and 13 iPhone UI tests, iPad accessibility and layout
testing, Production analyze and build checks, session/download/log security
checks, and the Tauri iOS simulator and Android ARM64 regression builds.
Archive identity, App Store provisioning, distribution signature, production
entitlements, and the exported IPA were verified before upload.

## 2026-08-14 — 1.2.119 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.119`
- App Store Connect build: `1`
- App Store Connect build ID: `577f704f-bc9f-4df9-9422-6215e1238259`
- Latest main commit: `ff485508`
- Release source commit: `ff485508f9b2b99b97752e573507e3c5a4661ee5`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `4a469bc66807fa7a60eb21cc983d41300f6eb9a1effa9fcddff84606e78471ea`

This release includes the refreshed native issue conversation UI and the
corrected Inbox thread reply layout from PRs #1005 and #1006, together with the
1.2.119 release metadata. The exact source commit passed the shared mobile
contract, Swift unit and 13 iPhone UI tests, iPad accessibility and layout
testing, Production analyze and build checks, the Tauri iOS simulator bundle,
and the Android ARM64 APK build. Archive identity, App Store provisioning,
distribution signature, production entitlements, exported IPA signature, and
all alternate app icons were verified before upload.

Version `1.2.118 (4)` (`64684398-ee1b-40b5-a7fa-2f5f66a53d14`) was uploaded
and remains `VALID`, but main advanced to version 1.2.119 while it was being
processed. Version `1.2.119 (1)` is therefore the final build handed off from
the latest main commit.

## 2026-08-14 — 1.2.121 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.121`
- App Store Connect build: `1`
- App Store Connect build ID: `d231cf9e-b2a1-4536-a417-3f74d9e17fcd`
- Latest main commit: `2ba01537`
- Release source commit: `ef3c64343f39cb2996cef31b3b09c14460e76e21`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `6bcc4aa536ce131b0581a7c3dea9d14f109eb79e59e4f9d01ee621083ef5eb42`

The candidate was archived and uploaded from `ef3c6434`, the latest main
commit when the release gate started. Main later advanced through PR #1023
(`2ba01537`) while App Store Connect processed the upload; that PR changes only
the web Inbox filter UI and does not change the iOS or Android sources. The
exact release source passed the shared mobile contract, Swift unit and 13
iPhone UI tests, iPad accessibility and largest Dynamic Type layout testing,
Production analyze and build checks, session/download/log security checks, and
the Tauri iOS simulator and Android ARM64 regression builds. Archive identity,
App Store provisioning, distribution signature, production entitlements
(`get-task-allow=0`), exported IPA verification, and alternate app icons were
verified before upload.

## 2026-08-15 — 1.2.125 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.125`
- App Store Connect build: `1`
- App Store Connect build ID: `67cdbe14-2c51-4ca6-b774-a95f96746d27`
- Latest main commit: `c1be0a01`
- Release source commit: `c1be0a0194ebf86fc00494f208c279912db190d9`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `54de458f6f604698010d188223776c2f3691b6995ee8ad42a8353ebf9de6212b`

This release includes streamed channel-agent activity, faster channel and idle
project synchronization, materialized channel notifications, persistent reply
threads, provider and sender avatars, image lightbox downloads, and the narrow
issue conversation tab. The exact source commit passed the shared mobile
contract, Swift unit and 13 iPhone UI tests, iPad accessibility and layout
testing, Production analyze and build checks, the Tauri iOS simulator bundle,
and the Android ARM64 APK build. Archive identity, App Store provisioning,
distribution signature, production entitlements, exported IPA signature, and
all alternate app icons were verified before upload.

The initial 1.2.124 gate was stopped before archive upload when main advanced
to the 1.2.125 release commit. Version `1.2.125 (1)` is therefore the final
build handed off from the latest main commit.

## 2026-08-15 — 1.2.125 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.125`
- App Store Connect build: `2`
- App Store Connect build ID: `93881e0e-ac81-4d47-80cc-783066572ce5`
- Latest main commit: `3eb25611`
- Release source commit: `3eb256117a6407b9ee9eeebfa2ef91876e4a1032`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `57c34076c6a979774d7a194d2b6a6ded9921fb6313ed75997c1f148fe61a23f9`

This release adds initial-load channel messages on native iOS, immediate
conversation draft clearing, issue conversation realtime synchronization and
notification suppression, the redesigned first-run onboarding flow, Block Kit
webhook rendering, pixel-grid agent reply loading, and structured approval
reply output. The exact source commit passed the shared mobile contract, Swift
unit and 14 iPhone UI tests, iPad accessibility and layout testing, Production
analyze and build checks, the Tauri iOS simulator bundle, and the Android ARM64
APK build. Archive identity, App Store provisioning, distribution signature,
production entitlements, exported IPA signature, and all alternate app icons
were verified before upload.

Build `1` of version `1.2.125` remains `VALID`, but main advanced through the
conversation, onboarding, and approval updates above. Version `1.2.125 (2)` is
the final build handed off from that main commit. Main then advanced to the
1.2.126 release metadata commit while App Store Connect processed the build.

## 2026-08-15 — 1.2.126 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.126`
- App Store Connect build: `1`
- App Store Connect build ID: `be4d13ee-4d4f-4f78-9411-4fec50ca2d10`
- Latest main commit: `51d35bd7`
- Release source commit: `51d35bd7a79e98cc3f2d81087aaa53916492a0a0`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `14dfc8f0b194526e75c6e6010f2ab7bca01f634fe91c31a41dd99482784bbfae`

This release carries the native conversation, onboarding, approval, channel,
and notification updates from 1.2.125 (2) with the 1.2.126 release metadata.
The exact latest main commit passed the shared mobile contract, Swift unit and
14 iPhone UI tests, iPad accessibility and largest Dynamic Type layout testing,
Production analyze and build checks, the Tauri iOS simulator bundle, and the
Android ARM64 APK build. Archive identity, App Store provisioning, distribution
signature, production entitlements, exported IPA signature, and all alternate
app icons were verified before upload.

The first exact-main verification attempt hit a transient XCTest accessibility
audit timeout on iPad. The complete release gate was rerun from a clean checkout
and passed before archive upload. Version `1.2.126 (1)` is the final build handed
off from the latest main commit.

## 2026-08-16 — 1.2.126 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.126`
- App Store Connect build: `2`
- App Store Connect build ID: `7e84a6ef-3eb6-416f-bfaf-4b030469a1e4`
- Latest main commit: `fed3d958`
- Release source commit: `fed3d95817a40b8da651eb1364a3eacf1044df0b`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `46160c6f42991cfb37e251a00bb8e37d42e7984ba97930eabc02cee05e6f8bca`

This release adds immediate message display when re-entering a mobile channel
and dismisses the native iOS mention picker after a selection. The exact latest
main commit passed the shared mobile contract, Swift unit and 15 iPhone UI
tests, iPad accessibility and largest Dynamic Type layout testing, Production
analyze and build checks, the Tauri iOS simulator bundle, and the Android ARM64
APK build. Archive identity, App Store provisioning, distribution signature,
production entitlements, exported IPA signature, and all alternate app icons
were verified before upload.

Version `1.2.126 (1)` remains `VALID`, but main advanced through PRs #1063 and
#1064. Version `1.2.126 (2)` is therefore the final build handed off from the
latest main commit.

## 2026-08-16 — 1.2.126 (3)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.126`
- App Store Connect build: `3`
- App Store Connect build ID: `c0b38739-1de1-40bc-abfa-f945e87d84f0`
- Latest main commit: `53d51ffe`
- Release source commit: `15363661bd9575b40b01a2c310970fb40cf22157`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `c4a6d4bb08f06e830e30afd062bb96efe8555690fbc860b310cfb6f2cc0cd2c8`

This release carries the latest main updates for stale mobile reply-state
handling, native channel-load progress, valid mention highlighting, and thread
re-entry cache display. The exact release source also includes a test-only
timing stabilization for the channel loading-spinner UI test. The complete
release gate passed the shared mobile contract, Swift unit and 16 iPhone UI
tests, iPad accessibility and largest Dynamic Type layout testing, Production
analyze and build checks, the Tauri iOS simulator bundle, and the Android ARM64
APK build. Archive identity, App Store provisioning, distribution signature,
production entitlements, exported IPA signature, and all alternate app icons
were verified before upload.

## 2026-08-16 — 1.2.126 (4)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.126`
- App Store Connect build: `4`
- App Store Connect build ID: `c2994ed2-41e2-494a-aa42-f4d074ec0bb8`
- Latest main commit: `37ea2e1345f282ec55a647d1b560b31cf72e2d1a`
- Release source commit: `fd8514d85ddce893d7cb749bb1ae5935a306f467`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `409356d6f90bec6de1b87cce2a8a07ca82695bbb2c5d40a9bc1513f220a5f8a0`

This release carries the latest main updates for the conversation scroll-to-
latest action, selectable long-press message ranges, optimistic sent-message
display, and streamed live agent activity. The exact release source also
updates UI assertions for the selectable native text surface and regenerates
the Xcode project metadata. The complete release gate passed the shared mobile
contract, Swift unit and 16 iPhone UI tests, iPad accessibility and largest
Dynamic Type layout testing, Production analyze and build checks, session/
download/log security checks, and the Tauri iOS simulator and Android ARM64
regression builds. Archive identity, App Store provisioning, distribution
signature, production entitlements, exported IPA signature, and all alternate
app icons were verified before upload.

## 2026-08-18 — 1.2.131 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.131`
- App Store Connect build: `1`
- App Store Connect build ID: `8c8ebdd8-3d5b-44f0-8647-a827ac6afaa8`
- Latest main commit: `db54d3a55386f273969b4f49f958feaee0208621`
- Release source commit: `e54e97ec410c4ca15465da279af33ecfa5732cb5`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `9081c8ef28f7160d909d5e22252eef7bdb44a1c412992ad7e4202ea88dd60939`

This release adds Cursor agent support, richer agent descriptions and branding,
project-grouped channels, channel thread subscriptions, copy-link and copy-
message actions, clearer in-progress agent output, configurable schedule tabs,
awaiting-review work summaries, and issue-editor layout and link improvements.
The exact release source differs from latest main only by squash history and has
the identical Git tree. It passed the shared mobile contract, Swift unit and 17
iPhone UI tests, iPad accessibility and largest Dynamic Type layout testing,
Production analyze and build checks, session/download/log security checks, and
the Tauri iOS simulator and Android ARM64 regression builds. Archive identity,
App Store provisioning, distribution signature, production entitlements,
exported IPA signature, and all alternate app icons were verified before upload.

The initial gate stopped before upload because selectable SwiftUI message text
is exposed to XCTest as a text view instead of a static text. PR #1101 made the
optimistic-message assertion element-type independent, passed the complete
repository signoff, and was merged into main before this exact verified IPA was
uploaded. App Store Connect accepted the build as `VALID` and automatically
made it available to the all-builds internal group.

## 2026-08-19 — 1.2.138 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.138`
- App Store Connect build: `2`
- App Store Connect build ID: `da01f92c-0f1a-4f36-a0c1-6009c83b177e`
- Latest main commit: `a74e7076549cd9d908bb112f05e616e547cde715`
- Release source commit: `5b885b2ce3e03b36375bb197d97641f1848d9f5d`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `0fbc367e45e5c4d3ede5ded44116fb6d3ef40f55f6126e300dd4e42134f16b40`

This release adds channel settings, invitations, deletion, emoji reactions,
attachment previews and cards; Project Agent issue replies; OpenRouter support;
guided Agent templates; Inbox unread counts; mobile rendering-cache and
navigation fixes; and the latest email OTP authentication changes. The release
source passed the shared mobile contract, Swift unit and 18 iPhone UI tests,
iPad accessibility and largest Dynamic Type layout testing, Production analyze
and build checks, session/download/log security checks, and the Tauri iOS
simulator and Android ARM64 regression builds. Archive identity, App Store
provisioning, distribution signature, production entitlements, exported IPA
signature, and all alternate app icons were verified before upload.

The initial latest-main gate stopped before upload on Swift compile errors from
new initializer arguments and an actor-isolated XCTest request-body assertion.
PR #1158 corrected those call sites, passed the complete repository signoff,
and was merged before the release gate was rerun. Build 2 was then created from
the newer email OTP main commit. One iPad accessibility audit timed out inside
XCTest; the isolated retry and the complete clean gate rerun both passed.

While that gate was running, main advanced to the recorded latest commit through
PR #1160, which changes only web spinner CSS and its test. The native iOS inputs
are identical to the release source; the changed spinner tests also passed.
App Store Connect accepted the build as `VALID` and automatically made it
available to the all-builds internal group.

## 2026-08-23 — 1.2.150 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.150`
- App Store Connect build: `2`
- App Store Connect build ID: `431363e2-1b9c-4002-bbbd-f3fec0ce885a`
- Latest main commit: `aac0db7b`
- Release source commit: `a8baecb95e5d4af59cb5e6bcd8b61955d5781d73`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Internal group: `wordbricks` (`hasAccessToAllBuilds=true`)
- Automatic tester notification: enabled
- IPA SHA-256: `f121be03e3b56676d450a1624b48246002625f4ddd7b72e2607597202f9674c3`

This release includes the latest main line-art Briar branding and app icon.
The exact release source passed the shared API contract, Swift unit and 18
iPhone UI tests, iPad accessibility and largest Dynamic Type layout testing,
Production analyze and build checks, session/download/log security checks, and
the Tauri iOS simulator and Android ARM64 regression builds. Archive identity,
App Store provisioning, distribution signature, production entitlements, and
the exported IPA signature were verified before upload.

After the native gate completed, main advanced through `969327c8` and
`aac0db7b`. Those commits change only the desktop changelog and trusted CI
file-mode validation; they do not change the native iOS inputs or uploaded
IPA. The final release PR includes both commits.

## 2026-08-23 — 1.2.150 (3)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.150`
- App Store Connect build: `3`
- App Store Connect build ID: `8d5c683d-3b09-434b-be57-5b4d72d981c1`
- Latest main commit: `e0ccd3ec6897b23c512d2f611ea67fe08ec02e87`
- Release source commit: `55e7cc2a30e758e7dbe9e989ba912cb0bd36d97a`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Automatic tester notification: enabled
- IPA SHA-256: `d75889cd47dc00df12235a9b652d923a23977d661f924c86eef742c9bb819651`

This release includes the latest main channel-thread interaction: long-press
a root channel message, choose `스레드 시작`, and open its reply conversation.
The release source also makes that gesture high priority over attachment and
other nested controls, and selects the message body deterministically in the
native UI test. The complete gate passed the shared mobile contract, Swift
unit and 18 iPhone UI tests, iPad accessibility and largest Dynamic Type
layout testing, Production analyze and build checks, session/download/log
security checks, and the Tauri iOS simulator and Android ARM64 regression
builds. Archive identity, App Store provisioning, distribution signature,
production entitlements, exported IPA signature, and the IPA checksum were
verified before upload.

App Store Connect accepted the build as `VALID` and placed it in internal
TestFlight testing.

After the upload, `main` advanced through `9c4ec1d9` (the worker route-family
refactor in PR #1237). That worker-only change is included in the release PR;
it does not change the native iOS inputs or the uploaded IPA.

## 2026-08-23 — 1.2.152 (1)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.152`
- App Store Connect build: `1`
- App Store Connect build ID: `a3444726-0be2-4f24-a8b9-f2cc8c66d9d6`
- Latest main commit: `ef1a92fc30dbbd1d2aa1daaef915e6679948d107`
- Release source commit: `31c2fada74899c05d8d9f02a55e909e9763ac8df`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Automatic tester notification: enabled
- IPA SHA-256: `5201bc976fbff606f547acbbd92e8f18f1e1fa51f4ce9d774070d98e87780357`

The exact latest-main release source passed the shared API contract, 15 iPhone
UI tests, the iPad accessibility and largest Dynamic Type layout test,
Production analyze and build checks, session/download/log security checks, and
the Tauri iOS simulator and Android ARM64 regression builds. Archive identity,
App Store provisioning, distribution signature, production entitlements,
exported IPA signature, and the IPA checksum were verified before upload.

The release source adds explicit `@MainActor` isolation to the native
`ChannelsStoreTests` and `CompanionReadTests` XCTest classes for Swift 6 test
compilation. This is test-only and does not change the app's runtime behavior
or Android source. App Store Connect accepted the build as `VALID`, enabled
automatic internal tester notification, and placed it in internal TestFlight
testing; external beta submission remains pending (`READY_FOR_BETA_SUBMISSION`).

## 2026-08-23 — 1.2.152 (2)

- App: Briar Companion (`app.briar.companion`)
- Marketing version: `1.2.152`
- App Store Connect build: `2`
- App Store Connect build ID: `0d87a837-76e4-4586-aba2-2bde899547f4`
- Latest main commit: `34ee613995389d35bac766a3beaf0cb9eff05091`
- Release source commit: `bef054a09095135398a6f941cbd556ed71dba159`
- Implementation: native SwiftUI
- Toolchain: Xcode 26.6, iOS 26.5 SDK
- Minimum iOS version: 17.0
- App Store Connect processing state: `VALID`
- TestFlight state: `IN_BETA_TESTING`
- Automatic tester notification: enabled
- External beta state: `READY_FOR_BETA_SUBMISSION`
- IPA SHA-256: `6f674a2cd3170765dc7aace20c3ab9b770d0d417c47419a25f86c9c95458b15d`

This is the final latest-main release for this run. It includes the latest
main channel interaction update from PR #1265: messages without reactions no
longer show a standalone React button, and long-pressing the message opens the
quick-reaction actions. The release source also makes the direct-message UI
test target the message body text view when SwiftUI exposes the same identifier
on the message's accessibility subviews. The earlier 1.2.152 (1) upload was
valid, but build 2 supersedes it because main advanced before the final release
was completed.

The complete gate passed the shared API contract, Swift unit and 15 iPhone UI
tests, the iPad accessibility and largest Dynamic Type layout test, Production
analyze and build checks, session/download/log security checks, and the Tauri
iOS simulator and Android ARM64 regression builds. Archive identity, App Store
provisioning, distribution signature, production entitlements, exported IPA
signature, and the IPA checksum were verified before upload. App Store Connect
accepted the build as `VALID`, enabled automatic internal tester notification,
and placed it in internal TestFlight testing; external beta submission remains
pending (`READY_FOR_BETA_SUBMISSION`).
