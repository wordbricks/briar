# Production release

Briar Production releases are exact protected `v*` tags built from `main`.
The release job is attached to the GitHub `production` environment and fails
before certificate import when any required credential or release invariant is
missing. An ad-hoc-signed main artifact is never promoted as a public release.

## One-time trust ceremony

Create the updater key on an offline administrator machine:

```sh
bun tauri signer generate --ci --password '<generated password>' \
  --write-keys /secure/offline/briar-updater.key
```

Store two independently controlled encrypted backups of the private key and
password before adding them to GitHub. Losing the key prevents future updates
to every installed app that trusts its public half. Never commit either value.

Configure these GitHub `production` environment secrets:

- `APPLE_CERTIFICATE` — base64 Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD` and `KEYCHAIN_PASSWORD`
- `APPLE_API_KEY`, `APPLE_API_ISSUER`, and `APPLE_API_KEY_CONTENT`
- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`

Configure the base64-encoded `.pub` file emitted by the Tauri signer as the
`BRIAR_UPDATER_PUBLIC_KEY` environment variable. It is public,
but changes still require Production approval because rotating it strands
existing installations. Limit the Production Cloudflare token to R2 object
read/write on the `briar-releases` bucket; Worker deployment uses a separate
credential. The environment must accept only protected `v*` tags. Enable
required reviewers and prevent self-review when the GitHub plan supports those
controls.

Repository setup includes an active `Protect Production release tags` ruleset
that blocks deletion and non-fast-forward updates for `refs/tags/v*`, plus a
`production` environment whose only deployment tag policy is `v*`.

The organization currently uses GitHub Team with a private repository, where
GitHub Sigstore artifact attestations are unavailable. The workflow therefore
generates SLSA v1 in-toto provenance plus an SPDX SBOM and signs both with the
offline-backed Tauri updater key. Add `actions/attest` when the repository is
public or the organization moves to GitHub Enterprise Cloud.

## Release transaction

1. Confirm main CI, the ad-hoc RC artifact, and cross-version lifecycle QA.
2. Bump all app/CLI/skill versions and set `BRIAR_PREVIOUS_VERSION`.
3. Create an annotated, signed `vX.Y.Z` tag on the protected main SHA.
4. Approve the GitHub `production` deployment.
5. The workflow imports an ephemeral keychain, signs with Developer ID,
   notarizes and staples, generates updater artifacts, SPDX, provenance,
   checksums, and lifecycle evidence.
6. It creates a draft GitHub Release, uploads immutable versioned files to the
   private R2 bucket, verifies the public Worker URL, publishes the GitHub
   Release, and promotes `releases/latest.json` last.

Promotion is fail-closed. The regular main artifact workflow does not run on
tags, so only this Production workflow can create a tagged GitHub Release. The
mutable update manifest is the final write, so a partial build cannot be
offered to installed clients. Versioned R2 objects are immutable and remain
available for incident analysis.

Production lifecycle QA is stricter than the main RC check. It rejects the
candidate unless the installed app exposes a `Developer ID Application`
authority, carries a valid stapled notarization ticket, and passes Gatekeeper's
`spctl` assessment. The signed lifecycle evidence records
`developer-id-notarized-gatekeeper`; an ad-hoc candidate cannot produce that
result.

Every main artifact build uses an ephemeral updater key to prove that Tauri can
create an archive and signature without granting Production authority. That
private key is deleted with its validated temporary directory and is never a
trusted release key.

The checked-in base Tauri configuration contains a public-only development
sentinel whose private key was destroyed and an endpoint that always returns
404. This lets ordinary local builds initialize the updater without granting
release authority. The Production workflow replaces both values with the
offline-backed public key and stable endpoint; its preflight rejects a missing
or malformed override.

## Verification

```sh
curl --fail https://briar-api.wbai.workers.dev/releases/latest.json | jq .
curl --fail --head \
  https://briar-api.wbai.workers.dev/releases/v1.0.0/Briar.app.tar.gz
shasum -a 256 --check SHA256SUMS
spctl --assess --type execute --verbose=2 Briar.app
xcrun stapler validate Briar.app
```

Tauri requires every updater archive to carry a signature; signature checks
cannot be disabled. The app exposes an explicit update check and only installs
archives accepted by its compiled public key.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/),
[macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/),
[GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
and [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).
