# macOS RC lifecycle

The RC gate proves that a Briar candidate can be installed from its DMG,
replace a retained previous app, and be rolled back without changing the user's
session or project configuration. It intentionally uses an isolated temporary
Applications directory and synthetic sentinel state, so it cannot overwrite a
developer's installed app or real credentials.

## Acceptance run

Build, package, and self-test a same-version candidate locally:

```sh
bun run release:macos:candidate
```

The wrapper may skip this build when the diff from the configured previous
version does not touch release or bundle mechanics. Routine releases should
use that automatic gate. Use `bun run release:macos:candidate -- --force` only
for an unconditional acceptance run while changing the release pipeline.

For a real cross-version acceptance run, use an accepted previous artifact:

```sh
scripts/qa-macos-lifecycle.sh \
  --previous-dir /path/to/previous-artifacts \
  --candidate-dir release-artifacts \
  --evidence-file /tmp/briar-lifecycle.json
```

The first 0.2.0 → 0.3.0 transition may add
`--allow-legacy-previous-signature`. Version 0.2.0 predates complete bundle
ad-hoc signing, so only that retained baseline is exempted; the candidate must
always pass strict deep signature verification. CI exercises the same mechanics
against a candidate twice with `--allow-same-version`.

The command rejects missing or mismatched checksums, a missing candidate
manifest, non-forward versions, the wrong bundle identifier or architecture, a
skill/app version mismatch, incomplete candidate signing, or any state hash
change. On success it writes machine-readable evidence and removes only its
validated `/tmp/briar-lifecycle.*` work area. The local candidate command also
exercises the mechanics against the candidate twice with
`--allow-same-version`.

## Failure and rollback

If candidate installation or launch fails, leave the user-state directories in
place, remove the failed candidate bundle, and restore the retained previous
bundle. Never roll back D1 schema or data as part of a desktop rollback. Keep
the previous artifact and its verified checksum until the candidate completes
production QA.

## Production gates

RC artifacts are ad-hoc signed and are not public releases. Production still
requires an Apple Developer ID certificate, notarization and stapling, a Tauri
updater signing key held outside the repository, a compiled updater public key,
and a versioned HTTPS update endpoint. Tauri updater signatures cannot be
disabled, so bundle replacement remains the explicit RC mechanism rather than
pretending to exercise the production updater.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/),
[macOS signing](https://v2.tauri.app/distribute/sign/macos/), and
[DMG distribution](https://v2.tauri.app/distribute/dmg/).
