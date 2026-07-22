#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
bundle_root="$workspace_root/src-tauri/target/release/bundle"
artifact_root="$workspace_root/release-artifacts"
app_path="$bundle_root/macos/Briar.app"
version="$(bun -e "import config from './src-tauri/tauri.conf.json'; console.log(config.version)" --cwd "$workspace_root")"

if [[ "${GITHUB_REF_TYPE:-}" == "tag" && "${GITHUB_REF_NAME:-}" != "v$version" ]]; then
  echo "Release tag ${GITHUB_REF_NAME:-<missing>} does not match app version v$version." >&2
  exit 1
fi
if [[ ! -d "$app_path" ]]; then
  echo "Missing release app at $app_path. Run 'bun run tauri build' first." >&2
  exit 1
fi

rm -rf "$artifact_root"
mkdir -p "$artifact_root"
ditto -c -k --sequesterRsrc --keepParent \
  "$app_path" "$artifact_root/Briar_${version}_macos.app.zip"

shopt -s nullglob
dmg_files=("$bundle_root"/dmg/*.dmg)
if (( ${#dmg_files[@]} == 0 )); then
  echo "No DMG bundle was produced." >&2
  exit 1
fi
cp "${dmg_files[@]}" "$artifact_root/"

(
  cd "$artifact_root"
  shasum -a 256 -- * > SHA256SUMS
  shasum -a 256 --check SHA256SUMS
)

echo "Packaged Briar v$version release artifacts in $artifact_root"
