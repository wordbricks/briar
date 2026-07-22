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

Every push to `main` and every `v*` tag builds an ad-hoc-signed macOS candidate.
The workflow uploads the `.dmg`, a zipped `.app`, `release-manifest.json`, and
`SHA256SUMS` for 30 days. The manifest binds the channel, previous version,
target, commit, source commit timestamp, artifact sizes, and SHA-256 hashes. A tag must
exactly match the version in `src-tauri/tauri.conf.json`; matching tags also
create a draft GitHub release.

The public API endpoint and disabled demo mode live in `config/release.env`.
They contain no secrets and are injected explicitly, so a clean runner produces
the same connected app as a developer machine. The PR gate verifies that the
compiled frontend contains that endpoint.

Run the same packaging contract locally:

```sh
bun run tauri:build:release
scripts/package-macos-release.sh
(cd release-artifacts && shasum -a 256 --check SHA256SUMS)
bun run src-cli/release-manifest.ts verify --root release-artifacts
```

The release workflow then mounts the DMG into an isolated QA root, installs the
app, replaces it with the candidate while retaining the previous bundle, and
rolls back. Bundle identity, version, architecture, embedded Auto Hunt skill,
signature completeness, and state-file hashes must all survive the cycle. The
machine-readable lifecycle evidence is added to the artifact and checksum file. See
[`rc-lifecycle.md`](rc-lifecycle.md) for the cross-version acceptance run.

Developer ID signing, notarization, updater signatures, and publication of a
non-draft release remain Production gates. Ad-hoc signing proves bundle
integrity in CI but does not make an artifact trusted by Gatekeeper.

## Rollback

- Worker: redeploy a known-good main SHA or use `wrangler rollback`.
- D1: capture a Time Travel bookmark before each remote migration and restore it
  only after confirming the forward fix is unsafe.
- Desktop: retain the previous signed release until the new candidate passes
  production QA.
