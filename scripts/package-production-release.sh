#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
set -a
# shellcheck disable=SC1091 -- fixed repository path.
source "$workspace_root/config/release.env"
set +a
bundle_root="${BRIAR_RELEASE_CARGO_TARGET_DIR:-${CARGO_TARGET_DIR:-$workspace_root/apps/briar/src-tauri/target}}/release/bundle"
artifact_root="$workspace_root/release-artifacts"
app_path="$bundle_root/macos/Briar.app"
version="$(bun -e "import config from './apps/briar/src-tauri/tauri.conf.json'; console.log(config.version)" --cwd "$workspace_root")"
base_url="${BRIAR_RELEASE_BASE_URL:?BRIAR_RELEASE_BASE_URL is required}"
syft_bin="${SYFT_BIN:-syft}"

"$workspace_root/scripts/package-macos-release.sh"

shopt -s nullglob
updater_archives=("$bundle_root"/macos/*.app.tar.gz)
updater_signatures=("$bundle_root"/macos/*.app.tar.gz.sig)
shopt -u nullglob
if (( ${#updater_archives[@]} != 1 || ${#updater_signatures[@]} != 1 )); then
  echo "Expected one signed macOS updater archive." >&2
  exit 1
fi
cp "${updater_archives[0]}" "${updater_signatures[0]}" "$artifact_root/"

codesign --verify --deep --strict "$app_path"
xcrun stapler validate "$app_path"
spctl --assess --type execute --verbose=2 "$app_path"
dmg_path="$(find "$artifact_root" -maxdepth 1 -type f -name 'Briar_*_aarch64.dmg' -print -quit)"
xcrun stapler validate "$dmg_path"

"$syft_bin" "dir:$app_path" -o "spdx-json=$artifact_root/briar.spdx.json"
bun run "$workspace_root/apps/briar/src-cli/production-release.ts" metadata \
  --root "$artifact_root" \
  --version "$version" \
  --base-url "$base_url"

bun --cwd apps/briar tauri signer sign "$artifact_root/provenance.intoto.jsonl"
bun --cwd apps/briar tauri signer sign "$artifact_root/briar.spdx.json"

(
  cd "$artifact_root"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 -- > SHA256SUMS
  shasum -a 256 --check SHA256SUMS
)

echo "Packaged notarized Briar v$version Production artifacts in $artifact_root"
