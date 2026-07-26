# Local Production release

Briar Production releases are built and published from a trusted local macOS
release host. A release must be an exact signed `v*` tag contained in
`origin/main`. The local command fails before certificate import when a
credential, toolchain, tag, repository, or release invariant is missing.

## One-time trust ceremony

Create the updater key on an offline administrator machine:

```sh
bun tauri signer generate --ci --password '<generated password>' \
  --write-keys /secure/offline/briar-updater.key
```

Store two independently controlled encrypted backups of the private key and
password. Losing the key prevents future updates to every installed app that
trusts its public half. Never commit either value.

Production credentials are stored as ciphertext in the checked-in
`.env.release` file and decrypted by dotenvx when
`release:macos:production` starts. The corresponding private key is never
committed.

Populate each value with `dotenvx set`:

```sh
bunx dotenvx set APPLE_CERTIFICATE "$APPLE_CERTIFICATE" -f .env.release
```

Repeat that command for the following variables:

- `APPLE_CERTIFICATE` — base64 Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD` and `KEYCHAIN_PASSWORD`
- `APPLE_API_KEY_CONTENT`
- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`

Publishing additionally requires `CLOUDFLARE_API_TOKEN` in `.env.release` and
an authenticated GitHub CLI session from `gh auth login`. The current Wrangler
upload path uses Cloudflare's REST API, so the token needs Account /
`Workers R2 Storage` / Edit permission. Bucket-scoped R2 Object Read & Write
credentials are S3-only and are not compatible with this command path.

Set these non-secret values in the checked-in `config/release.env`:

- `APPLE_API_KEY` and `APPLE_API_ISSUER`
- `BRIAR_UPDATER_PUBLIC_KEY` — base64-encoded `.pub` file emitted by the Tauri
  signer
- `CLOUDFLARE_ACCOUNT_ID`

Worker deployment uses a separate credential. Dotenvx commits only ciphertext
and writes the matching private decryption key to the ignored `.env.keys` file
by default. Run `bun run secrets:verify-encrypted` before committing changes to
either encrypted environment file. The Production release command requires
`.env.keys` on the trusted release host; if it is missing the command exits
without decrypting secrets. Never commit `.env.keys`.

The release host requires macOS, Bun 1.3.14, Rust 1.96.0, Xcode command-line
tools, Syft, `gh`, `jq`, and a clean checkout with access to `origin`.

## Local Production release v1

1. Confirm local CI, the ad-hoc RC artifacts, and cross-version lifecycle QA.
2. Bump all app, CLI, and skill versions and set `BRIAR_PREVIOUS_VERSION`.
3. Create and push an annotated, signed `vX.Y.Z` tag on a commit contained in
   `origin/main`.
4. Check out that exact tag on the trusted macOS release host.
5. Ensure the ignored `.env.keys` file is present on the trusted release host.
   Without it the release command exits immediately.
6. Build and verify the notarized artifacts without publishing:

   ```sh
   bun run release:macos:production
   ```

7. Review `release-artifacts/`, then rebuild and publish from the same clean tag:

   ```sh
   bun run release:macos:production -- --publish
   ```

The command verifies the pinned toolchain, clean worktree, signed tag, remote
tag, and membership in `origin/main`. It then imports an ephemeral keychain,
signs with Developer ID, notarizes and staples, generates updater artifacts,
SPDX, provenance, checksums, and lifecycle evidence. The keychain and temporary
Apple API key are removed on every exit, and the user's original keychain search
list is restored.

`--publish` is required for every GitHub and R2 publication. Publication
creates a draft GitHub Release, uploads immutable versioned files to the private
R2 bucket, verifies the public updater archive, publishes the GitHub Release,
and promotes `releases/latest.json` last.

Promotion is fail-closed. The mutable update manifest is the final write, so a
partial build cannot be offered to installed clients. Versioned R2 objects
remain available for incident analysis. If publication stops after creating the
draft release, inspect the draft and uploaded versioned objects before retrying;
the command refuses to overwrite an existing GitHub Release.

Production lifecycle QA rejects the candidate unless the installed app exposes
a `Developer ID Application` authority, carries a valid stapled notarization
ticket, and passes Gatekeeper's `spctl` assessment. The signed lifecycle
evidence records `developer-id-notarized-gatekeeper`; an ad-hoc candidate cannot
produce that result.

The checked-in base Tauri configuration contains a public-only development
sentinel whose private key was destroyed and an endpoint that always returns
404. Ordinary local builds can initialize the updater without release
authority. The Production command replaces both values with the offline-backed
public key and stable endpoint; preflight rejects a missing or malformed
override.

## Verification

```sh
curl --fail https://briar-api.wbai.workers.dev/releases/latest.json | jq .
curl --fail --head \
  https://briar-api.wbai.workers.dev/releases/v1.1.1/Briar.app.tar.gz
(cd release-artifacts && shasum -a 256 --check SHA256SUMS)
spctl --assess --type execute --verbose=2 \
  src-tauri/target/release/bundle/macos/Briar.app
xcrun stapler validate src-tauri/target/release/bundle/macos/Briar.app
```

Tauri requires every updater archive to carry a signature; signature checks
cannot be disabled. The app exposes an explicit update check and only installs
archives accepted by its compiled public key.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/),
[macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/),
and [GitHub CLI releases](https://cli.github.com/manual/gh_release).
