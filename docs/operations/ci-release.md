# Local CI and release gates

Briar runs validation and macOS release builds on developer-controlled machines.
The repository does not contain hosted automation workflows. Local CI also
fails if a file is added under `.github/workflows/`.

## Required pull request signoffs

Branch protection requires these commit statuses:

- `signoff/app-worker`
- `signoff/d1-migrations`
- `signoff/rust`
- `signoff/security`

Run all checks locally:

```sh
bun run ci:local
```

After committing and pushing the exact revision that passed, publish all four
statuses with `gh-signoff`:

`gh-signoff` is a **Briar repository contributor/release tool**, not a runtime
Worker or default Workflow dependency. Projects whose own validation scripts
invoke `gh` must declare and provision that project-specific requirement; the
Briar GitHub App flow itself never asks users to install or authenticate it.

```sh
bun run ci:signoff
```

The signoff command is self-contained: it installs the locked dependencies,
prepares shared build inputs once, and runs the four independent contexts in
parallel before publishing any status. Do not precede it with a separate
`bun run check`; that check is already part of `signoff/app-worker`.

### Shared Cargo target directory

The `rust` context builds into a shared Cargo target directory instead of
`apps/briar/src-tauri/target`, so `cargo fmt`, `cargo clippy`, and `cargo test`
stay incremental across git worktrees: a fresh Auto Hunt worktree reuses the
artifacts of previous runs rather than rebuilding every crate. The default is
`$(getconf DARWIN_USER_CACHE_DIR)/briar/ci/cargo-target` (falling back to
`$TMPDIR` when that is unavailable). Override it with
`BRIAR_CI_CARGO_TARGET_DIR`, which must be an absolute path ending in
`/cargo-target`, or set `BRIAR_CI_CARGO_TARGET_DIR=local` to fall back to the
per-worktree target directory when debugging a build. Unlike the release cache,
the CI cache takes no exclusive lock: Cargo's own file lock serialises
concurrent access, so several worktrees can run local CI at the same time and
simply wait for each other.

Mobile contract validation is separate from the required pull request
signoffs. On a macOS worker with Xcode, JDK 17, and Android SDK 36, install the
repository-pinned tools and explicitly provision the required iOS runtime and
simulators before running mobile CI:

```sh
mise install
bun run ios:bootstrap
bun run mobile:ci
```

The bootstrap installs the selected Xcode's current iOS Platform Support when
it is missing, derives the default Simulator OS version from that Xcode SDK,
and idempotently creates the default iPhone and iPad destinations. Platform
Support readiness is checked through an actual Xcode Simulator destination;
the presence of a same-version runtime alone is insufficient because Xcode can
reject prerelease or otherwise incompatible runtime builds.
`bun run mobile:ci` then:

- checks the canonical Buf descriptor and generated TypeScript/Swift Connect artifacts, and exercises representative generated client-to-Worker service boundaries;
- builds and runs the independent SwiftUI App, Unit Test, and UI Test targets;
- analyzes and builds the SwiftUI Production configuration without signing; and
- builds the retained Tauri Android debug APK.

Set `BRIAR_IOS_DESTINATION` and `BRIAR_IPAD_DESTINATION` to equivalent Xcode
destinations when the worker uses differently named simulators. The command
verifies the native-only iOS release contract and never changes the Android
Tauri application identifier or release scheme.

The security phase uses `bun audit`, `cargo-audit`, and Gitleaks. Rust
vulnerabilities and any warning not in the dated advisory allowlist fail the
gate. The first Rust audit prints all known warnings before the strict allowlist
check, so accepted debt remains visible in the local log.

Any audit exception must be narrow, dated, and recorded in
[`security-exceptions.md`](security-exceptions.md) with a removal condition.

## Local release candidates

Build the ad-hoc-signed macOS candidate, package it, exercise isolated install
and rollback, prove that it cannot satisfy the Production signature gate, and
write checksummed lifecycle evidence:

```sh
bun run release:macos:candidate
```

The command compares `HEAD` with `v$BRIAR_PREVIOUS_VERSION`. It skips the
expensive ad-hoc Tauri bundle when only ordinary application code and the
release version fields changed. Release scripts, packaging, updater, signing,
dependencies, public release configuration, icons, capabilities, or other
bundle configuration force the full candidate. A missing base tag or a dirty
worktree also fails closed to the full build. Routine releases must use the
automatic gate. Use `bun run release:macos:candidate -- --force` only when
validating changes to the release pipeline itself.

The command writes the `.dmg`, zipped `.app`, `release-manifest.json`,
`lifecycle-evidence.json`, and `SHA256SUMS` to `release-artifacts/`. The manifest
binds the channel, previous version, target, commit, source commit timestamp,
artifact sizes, and SHA-256 hashes.

The public API endpoint and disabled demo mode live in `config/release.env`.
They contain no secrets and are injected explicitly, so a clean release host
produces the same connected app as a developer machine.

Developer ID signing, notarization, updater signatures, and public publication
remain Production gates. Ad-hoc signing proves bundle integrity but does not
make an artifact trusted by Gatekeeper.

The complete fail-closed local tag transaction, trust ceremony, R2 promotion
order, and signed provenance contract are documented in
[`production-release.md`](production-release.md). Incident response and SLOs
live in [`incident-runbook.md`](incident-runbook.md).

iOS TestFlight uploads and their final App Store Connect states are recorded in
[`ios-testflight-releases.md`](ios-testflight-releases.md).

## Rollback

- Worker: redeploy a known-good main SHA or use
  `bun --cwd apps/briar wrangler rollback`.
- D1: capture a Time Travel bookmark before each remote migration and restore it
  only after confirming the forward fix is unsafe.
- Desktop: retain the previous signed release until the new candidate passes
  Production QA.
