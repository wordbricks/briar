#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
artifact_root="$workspace_root/release-artifacts"
release_temp="$(mktemp -d /tmp/briar-macos-candidate.XXXXXX)"

cleanup() {
  case "$release_temp" in
    /tmp/briar-macos-candidate.*) rm -rf -- "$release_temp" ;;
    *) echo "Refusing to clean unexpected candidate path: $release_temp" >&2 ;;
  esac
}
trap cleanup EXIT

cd "$workspace_root"

expected_bun_version="$(bun -e "console.log((await Bun.file('package.json').json()).packageManager.split('@')[1])")"
[[ "$(bun --version)" == "$expected_bun_version" ]] || {
  echo "Expected Bun $expected_bun_version; found $(bun --version)." >&2
  exit 1
}
rustc --version | grep -F "rustc 1.96.0 " >/dev/null || {
  echo "Expected the Rust 1.96.0 toolchain." >&2
  exit 1
}

bun run qa:release-updater
scripts/package-macos-release.sh
scripts/qa-macos-lifecycle.sh \
  --previous-dir "$artifact_root" \
  --candidate-dir "$artifact_root" \
  --allow-same-version \
  --evidence-file "$artifact_root/lifecycle-evidence.json"

(
  cd "$artifact_root"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 -- > SHA256SUMS
  shasum -a 256 --check SHA256SUMS
)

rejection_log="$release_temp/production-signature-rejection.log"
if scripts/qa-macos-lifecycle.sh \
  --previous-dir "$artifact_root" \
  --candidate-dir "$artifact_root" \
  --allow-same-version \
  --require-production-signature \
  >"$rejection_log" 2>&1; then
  echo "Ad-hoc candidate unexpectedly passed the Production signature gate." >&2
  exit 1
fi
grep -F \
  "Production candidate is not signed by a Developer ID Application identity." \
  "$rejection_log" >/dev/null

echo "Built and verified the local macOS release candidate in $artifact_root"
