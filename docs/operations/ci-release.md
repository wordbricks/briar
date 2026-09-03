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

The signoff command is self-contained: before any expensive setup or checks, it
fails fast unless the worktree is clean and `HEAD` exactly matches its push
branch. It then prepares shared build inputs once and runs the four independent
contexts in parallel before publishing any status. Do not precede it with a
separate `bun run check`; that check is already part of `signoff/app-worker`.

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

### The app test suites

`bun run test` at the repository root is `turbo run test:all //#test:repo-tools`.
`test:all` owns no script anywhere; it is a Turborepo fan-out node. Every package
except `@briar/app` resolves it to that package's own `test` task, and
`@briar/app` overrides it in `apps/briar/turbo.json` with three independently
cached leaf tasks:

| Task | Script | Covers |
| --- | --- | --- |
| `test:unit` | `vitest run` | `src/`, `src-agent/`, `src-cli/` plus `worker/src/html-artifact-preview-shell.test.ts` (the Node-only suite), driven by `vite.config.ts` |
| `test:worker:unit` | `vitest run --config vitest.worker.config.ts` | the `worker-unit` Vitest project: every Worker test that never touches D1 |
| `test:worker:d1` | `vitest run --config vitest.worker-d1.config.ts` | the `worker-d1` Vitest project: the files listed in `vitest.worker.test-files.ts`, on the schema snapshot |

Previously `@briar/app#test` was one task that ran all three behind
`$TURBO_DEFAULT$` inputs and a `transit` dependency, so it hashed the whole
package: editing a single React component reran the Worker suites, and editing a
single Worker test reran the app suite. The three leaf tasks declare their inputs
explicitly instead (no `$TURBO_DEFAULT$`, no `dependsOn: ["transit"]`, `outputs:
[]`, `cache: true`), so each one reruns only when something it actually reads
changes.

The declared inputs were derived from the transitive import closure of each
suite's test files and widened to whole directories, so they are supersets rather
than exact lists. Two consequences are worth knowing:

- `test:unit` hashes `worker/src/**/*.ts` minus the Worker test files, because
  six Worker modules (`public-routes.ts`, `auth-origins.ts`, `releases.ts`, …)
  are imported by app tests. Editing a Worker *test* therefore leaves `test:unit`
  cached; editing Worker *source* reruns it.
- Both Worker tasks hash all of `worker/src/**` except the migration suite and
  the Node-only shell test, so editing any Worker test reruns both of them. The
  alternative would be duplicating `vitest.worker.test-files.ts` into
  `turbo.json`, which drifts silently.

`test:unit` additionally hashes `src-tauri/*.json` and `src-tauri/capabilities/`,
which several `src/lib` tests read from disk, and `$TURBO_ROOT$/.env*`, because
Vite loads the repository root as its `envDir`.

The two Worker tasks run in parallel under Turborepo, which makes
`sequence.groupOrder` in `vitest.worker.config.ts` and `vitest.worker-d1.config.ts`
inert: `groupOrder` only orders projects inside a single Vitest run, and the
combined `vitest.worker-projects.config.ts` is now used only by the developer
script `bun run --cwd apps/briar test:worker`. Both configs still cap their pools
at 8 workers, so the parallel pair does not oversubscribe the machine.

Developer entry points are unchanged in spirit:

```sh
bun run --cwd apps/briar test            # test:unit, then both Worker projects
bun run --cwd apps/briar test:unit       # app/agent/CLI suite only
bun run --cwd apps/briar test:worker     # both Worker projects in one Vitest run
```

To rerun a cached suite against an unchanged tree:

```sh
bunx turbo run test:unit test:worker:unit test:worker:d1 --filter=@briar/app --force
```

### Shared Cargo target directory

The `rust` context builds into a shared Cargo target directory instead of
`apps/briar/src-tauri/target`, so `cargo fmt`, `cargo clippy`, and `cargo test`
stay incremental across git worktrees: a fresh Auto Hunt worktree reuses the
artifacts of previous runs rather than rebuilding every crate. The default is
`${XDG_CACHE_HOME:-~/.cache}/briar/cargo-target`, and the release scripts use
the same directory (Cargo keeps the `debug` and `release` profiles apart), so
CI runs and release builds warm each other's dependencies. The directory is
deliberately not under `DARWIN_USER_CACHE_DIR`: macOS treats that location as
purgeable, and each eviction turned a ~20s incremental Rust check into a
~10 minute cold build. Override it with `BRIAR_CI_CARGO_TARGET_DIR`, which must
be an absolute path ending in `/cargo-target`, or set
`BRIAR_CI_CARGO_TARGET_DIR=local` to fall back to the per-worktree target
directory when debugging a build. Unlike the release cache, the CI cache takes
no exclusive lock: Cargo's own file lock serialises concurrent access, so
several worktrees can run local CI at the same time and simply wait for each
other.

To relocate an existing cache without a cold rebuild, `mv` the directory to the
new path (or set the override to the old one), then delete every
`<profile>/build/*` entry whose `output` file still names the old path: Tauri
and its plugins record absolute `OUT_DIR` paths in their build-script output,
and `tauri-build` fails with "failed to read plugin permissions" until those
scripts rerun (about 30s). For example:

```sh
for o in ~/.cache/briar/cargo-target/*/build/*/output; do
  grep -q "$OLD_CACHE_PATH" "$o" && rm -rf "$(dirname "$o")"
done
```

The per-worktree
`apps/briar/src-tauri/target` directories are not used by local CI and can be
deleted to reclaim disk; only `bun run tauri dev` and similar development
builds write there.

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
assumes the repository dependencies have already been installed.

All four contexts, `d1-migrations` included, run in parallel. While the
`app-worker` context runs alongside it, `test:d1:migrations` is pinned to a
single Vitest worker: every migration test replays the full history from an
empty database, and at the machine-derived worker count those files time out
against the parallel Worker suites and the Rust build. The pin costs nothing on
a warm cache, where the step does not run at all. Set
`BRIAR_CI_SERIAL_CONTEXTS=true` to run the contexts one at a time on constrained
machines, or `VITEST_MAX_WORKERS` to pin the pool size yourself.

`d1:migrate:local` and `test:d1:migrations` are cached by Turborepo, so a run
that changes nothing under `apps/briar/migrations/` re-verifies nothing. Their
inputs are declared explicitly in `apps/briar/turbo.json`: the migration files
and the schema snapshot, every `.ts` file under `worker/src/` and `src/lib/`,
the Vitest configs they load (`vitest.worker-migrations.config.ts`,
`vitest.worker.shared.ts`, `vitest.max-workers.ts`), `wrangler.jsonc`, the
generated contracts, and the root manifest and lockfile.
`VITEST_MAX_WORKERS` is in `globalPassThroughEnv` and never enters the hash.

The globs cover whole directories rather than the exact import closure of the
16 migration tests. Editing an unrelated Worker test therefore reruns the
migration suite (~60s), but such a change also reruns the much longer
`app-worker` test step in parallel, so the critical path does not move — and no
list has to be kept in sync when a migration test is added.

Because Turborepo also hashes pass-through arguments, local CI applies the
migrations into the fixed, git-ignored `apps/briar/.wrangler/ci-d1-state`
instead of a fresh temporary directory, and removes it first so wrangler still
starts from an empty database.

To rerun either task against an unchanged tree:

```sh
bunx turbo run test:d1:migrations --filter=@briar/app --force
```

### The D1 schema snapshot

`apps/briar/migrations-snapshot/schema.sql` is a generated dump of the fully
migrated D1 database: every migration except
`0142_restore_cvs_slack_history.sql` (6 MB of restored customer messages, no
schema change), plus the rows that data-only migrations seed. The `worker-d1`
Vitest project loads it in one batch instead of replaying ~190 migrations into
each test file's isolated database.

The migrations remain the source of truth. `d1:migrate:local`, `d1:migrate:remote`
and the migration regression suite (`test:d1:migrations`, which covers
`worker/src/**/*.migration.test.ts`) still replay the real files, so migration
behaviour is never validated through the snapshot. `db.test.ts` and
`workflow-v2.test.ts` are repository integration tests rather than migration
tests and run in the `worker-d1` project on the snapshot schema.

After adding or editing a migration that changes the schema or seeds rows:

```sh
bun run d1:snapshot   # regenerate; takes ~45s
```

Commit the regenerated `schema.sql` with the migration. The `d1-migrations` CI
context runs `bun run d1:snapshot:check` right after `d1:migrate:local`; it
compares the `migrations-digest` and `snapshot-digest` lines in the snapshot
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
