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

After committing and pushing the exact revision to an `origin` branch, run and
publish all four statuses with the authenticated GitHub CLI:

```sh
bun run ci:signoff
```

The signoff command is self-contained: before any expensive setup or checks, it
fails fast unless the worktree is clean and `HEAD` exactly matches the live
remote push branch. It records the current `origin/main`, immediately publishes
all selected contexts as pending, and checks the local HEAD, push branch, and
base branch every ten seconds. Moving any of them interrupts the remaining work
and marks the target commit's contexts failed; rerun on the new base. Each
context publishes its own final status as it finishes. Do not precede signoff
with a separate `bun run check`; that check is already part of
`signoff/app-worker`.

`signoff/app-worker` builds the frontend twice, not three times: `build:release`
is the authoritative desktop bundle (`apps/briar/dist`) and `web:build` is the
Worker asset bundle (`apps/briar/dist-web`, served through `wrangler.jsonc`).
The plain dev-env `bun run build` of `@briar/app` was redundant with
`build:release` — same Vite build, same task dependencies, only the env differs
— so CI runs `bun run build:workspaces` (every package except `@briar/app`)
instead. Both `build:release` and `test` are now Turborepo-cached, so an
unchanged tree replays them from `.turbo` rather than rebuilding and retesting.

Vitest sizes its worker pool from `os.availableParallelism()` (capped at 8 for
the miniflare-backed Worker suites). Set `VITEST_MAX_WORKERS` to pin a lower
value on constrained machines; it is in `globalPassThroughEnv`, so it never
changes a Turborepo cache key.

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
`bun run mobile:ci` is an `effect/unstable/cli` command whose scope cleans up
its isolated source/build copy and interrupts every spawned build on failure.
XcodeGen runs once in that copy before the parallel jobs, so builds never race
while replacing the checked-in project. It:

- checks the canonical Buf descriptor and generated TypeScript/Swift Connect artifacts, and exercises representative generated client-to-Worker service boundaries;
- builds and runs the independent SwiftUI App, Unit Test, and UI Test targets;
- analyzes and builds the SwiftUI Production configuration without signing; and
- builds the retained Tauri Android debug APK.

The three independent iOS build/test jobs use bounded concurrency. The default
is two; use `bun run mobile:ci -- --jobs 1` on a memory-constrained runner or
`--jobs 3` on a dedicated host.

Set `BRIAR_IOS_DESTINATION` and `BRIAR_IPAD_DESTINATION` to equivalent Xcode
destinations when the worker uses differently named simulators. The command
verifies the native-only iOS release contract and never changes the Android
Tauri application identifier or release scheme.

The security phase uses `bun audit`, `cargo-audit`, and Gitleaks. Rust
vulnerabilities and any warning not in the dated advisory allowlist fail the
gate. The first Rust audit prints all known warnings before the strict allowlist
check, so accepted debt remains visible in the local log; the strict pass reuses
the advisory database that the first pass fetched.

Gitleaks scans only the commits the branch adds on top of the base ref
(`origin/main`, falling back to `main`, or `BRIAR_CI_BASE_REF`) instead of the
whole history. It falls back to the full `--all` history scan — and says so in
the log — when no base ref resolves, when `HEAD` adds nothing over the base
(for example a run on the base branch itself), or when
`BRIAR_CI_GITLEAKS_FULL=true` is set.

Local CI uses an Effect runner with `effect/unstable/cli`. The typed CLI runs
the selected contexts with scoped child processes and temporary directories.
The first failed context interrupts its still-running siblings, so a known
failure does not leave expensive builds or Miniflare pools running. Local CI
assumes the repository dependencies have already been installed. An atomic
lock in the linked worktree's Git metadata rejects a second local, signoff, or
mobile CI run in the same worktree while still allowing different worktrees to
validate in parallel. Stale locks left by a killed process are reclaimed.

Command output is written to per-context temporary logs while one-line start,
finish, and timing events stream to the terminal. Successful logs disappear
with the Effect scope; on failure only the last 200 lines of the failed context
are printed. Set `BRIAR_CI_TIMING_FILE` when a persistent TSV timing artifact is
needed.

All four contexts, `d1-migrations` included, run in parallel. The D1 migration
suite pins itself to a single Vitest worker while `app-worker` runs so the
combined Miniflare pool stays small. Set `BRIAR_CI_SERIAL_CONTEXTS=true` to run
the contexts one at a time on constrained machines.

## Production Worker serialization

Both `bun run worker:deploy` and direct `bun run d1:migrate:remote` require a
clean checkout at the exact fetched `origin/main` commit. They acquire the same
renewable `worker-production` lease in Production D1. The deploy command holds
it across both migration and Worker publication, so separate terminals or
hosts cannot interleave schema and code deployments. A process that loses its
lease aborts; an abandoned lease expires after 20 minutes.

### The D1 schema snapshot

`apps/briar/migrations-snapshot/schema.sql` is a generated dump of the fully
migrated D1 database: every migration except
`0142_restore_cvs_slack_history.sql` (6 MB of restored customer messages, no
schema change), plus the rows that data-only migrations seed. The `worker-d1`
Vitest project loads it in one batch instead of replaying ~190 migrations into
each test file's isolated database.

The migrations remain the source of truth. `d1:migrate:local`, `d1:migrate:remote`
and the migration regression suite still use the real files. CI relies on the
suite's two full-history replays plus four domain-grouped cutover entries; it no
longer pays for a third, redundant Wrangler replay on every signoff.

After adding or editing a migration that changes the schema or seeds rows:

```sh
bun run d1:snapshot   # regenerate; takes ~45s
```

Commit the regenerated `schema.sql` with the migration. The `d1-migrations` CI
context runs `bun run d1:snapshot:check` before the migration regression suite;
it compares the `migrations-digest` and `snapshot-digest` lines in the snapshot
header against the migration files on disk and fails in under a second if either
the migrations changed without a regeneration or the snapshot was hand-edited.
`bun run d1:snapshot:check:full` regenerates into a temporary file and prints a
diff — use it when the fast check disagrees with what you expect.

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
