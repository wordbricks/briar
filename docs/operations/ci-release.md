# CI and release gates

Briar's Beta gate is enforced by GitHub Actions with read-only default token
permissions and immutable action commit references.

## Required pull request checks

- `App and Worker quality`
- `D1 migration contract`
- `Rust quality`
- `Dependency and secret audit`

The security job uses `bun audit`, checksum-verified `cargo-audit`, and a
checksum-verified Gitleaks CLI. Rust vulnerabilities and any warning not in the
dated advisory allowlist fail the gate. The first Rust audit prints all known
warnings before the strict allowlist check, so accepted debt remains visible in
the job log. GitHub Code Security is not assumed because the repository is
private and the feature may not be licensed. Enable GitHub secret scanning and
push protection later when the organization has Code Security available.

Any audit exception must be narrow, dated, and recorded in
[`security-exceptions.md`](security-exceptions.md) with a removal condition.

## Release candidates

Every push to `main` and every `v*` tag builds an unsigned macOS candidate. The
workflow uploads the `.dmg`, a zipped `.app`, and `SHA256SUMS` for 30 days. A tag
must exactly match the version in `src-tauri/tauri.conf.json`; matching tags also
create a draft GitHub release.

Run the same packaging contract locally after `bun run tauri build`:

```sh
scripts/package-macos-release.sh
(cd release-artifacts && shasum -a 256 --check SHA256SUMS)
```

Signing, notarization, updater signatures, and publication of a non-draft
release remain Production gates. Do not distribute these unsigned Beta
artifacts as a trusted public release.

## Rollback

- Worker: redeploy a known-good main SHA or use `wrangler rollback`.
- D1: capture a Time Travel bookmark before each remote migration and restore it
  only after confirming the forward fix is unsafe.
- Desktop: retain the previous signed release until the new candidate passes
  production QA.
