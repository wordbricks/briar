#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
qa_root="$(mktemp -d /tmp/briar-production-updater.XXXXXX)"
private_key="$qa_root/updater.key"
public_key="$private_key.pub"
production_config="$qa_root/tauri.production.json"
password="briar-ephemeral-ci-key"
version="$(bun -e "import config from './src-tauri/tauri.conf.json'; console.log(config.version)" --cwd "$workspace_root")"
bundle_root="${BRIAR_RELEASE_CARGO_TARGET_DIR:-${CARGO_TARGET_DIR:-$workspace_root/src-tauri/target}}/release/bundle"

cleanup() {
  case "$qa_root" in
    /tmp/briar-production-updater.*) rm -rf -- "$qa_root" ;;
    *) echo "Refusing to clean unexpected updater QA path: $qa_root" >&2 ;;
  esac
}
trap cleanup EXIT

CI=true bun run tauri signer generate \
  --password "$password" \
  --write-keys "$private_key" \
  --force >/dev/null

BRIAR_UPDATER_PUBLIC_KEY="$(cat "$public_key")" \
  "$workspace_root/scripts/with-release-env.sh" \
  bun run "$workspace_root/src-cli/production-release.ts" config \
    --version "$version" \
    --output "$production_config"

TAURI_SIGNING_PRIVATE_KEY="$private_key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$password" \
  "$workspace_root/scripts/with-release-env.sh" \
  bun run tauri build --config "$production_config"

shopt -s nullglob
archives=("$bundle_root"/macos/*.app.tar.gz)
signatures=("$bundle_root"/macos/*.app.tar.gz.sig)
shopt -u nullglob
if (( ${#archives[@]} != 1 || ${#signatures[@]} != 1 )); then
  echo "Production dry-run did not create one updater archive and signature." >&2
  exit 1
fi
if [[ ! -s "${archives[0]}" || ! -s "${signatures[0]}" ]]; then
  echo "Production dry-run updater output is empty." >&2
  exit 1
fi
"$workspace_root/scripts/verify-bundled-runtime.sh" \
  "$bundle_root/macos/Briar.app"

echo "Production updater dry-run passed for Briar v$version."
