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
