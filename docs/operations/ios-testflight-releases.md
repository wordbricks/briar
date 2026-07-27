# iOS TestFlight releases

Record each uploaded Briar Companion build after App Store Connect processing
finishes. A release is complete only when the build is valid and its internal
TestFlight state is `IN_BETA_TESTING`.

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
