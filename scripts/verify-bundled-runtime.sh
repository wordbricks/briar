#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
app_path="${1:-}"

if [[ -z "$app_path" || ! -d "$app_path" ]]; then
  echo "Usage: scripts/verify-bundled-runtime.sh /path/to/Briar.app" >&2
  exit 1
fi

runtime="$app_path/Contents/MacOS/bun"
license="$app_path/Contents/Resources/licenses/bun-LICENSE.md"
expected_version="$(
  bun -e "console.log((await Bun.file('package.json').json()).packageManager.split('@')[1])" \
    --cwd "$workspace_root"
)"

if [[ ! -x "$runtime" ]]; then
  echo "Briar.app is missing its executable bundled Bun runtime." >&2
  exit 1
fi
if [[ "$("$runtime" --version)" != "$expected_version" ]]; then
  echo "Bundled Bun version does not match package.json ($expected_version)." >&2
  exit 1
fi
if [[ ! -s "$license" ]]; then
  echo "Briar.app is missing the bundled Bun license notice." >&2
  exit 1
fi

app_architectures="$(lipo -archs "$app_path/Contents/MacOS/briar")"
runtime_architectures="$(lipo -archs "$runtime")"
if [[ "$runtime_architectures" != "$app_architectures" ]]; then
  echo "Bundled Bun architecture ($runtime_architectures) does not match Briar ($app_architectures)." >&2
  exit 1
fi
codesign --verify --strict "$runtime"

echo "Verified bundled Bun $expected_version ($runtime_architectures)."
