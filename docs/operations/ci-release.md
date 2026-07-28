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

```sh
bun run ci:signoff
```

The signoff command is self-contained: it installs the locked dependencies,
prepares shared build inputs once, and runs the four independent contexts in
parallel before publishing any status. Do not precede it with a separate
`bun run check`; that check is already part of `signoff/app-worker`.

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

- Worker: redeploy a known-good main SHA or use `wrangler rollback`.
- D1: capture a Time Travel bookmark before each remote migration and restore it
  only after confirming the forward fix is unsafe.
- Desktop: retain the previous signed release until the new candidate passes
  Production QA.
