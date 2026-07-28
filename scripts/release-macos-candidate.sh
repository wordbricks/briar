#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
artifact_root="$workspace_root/release-artifacts"
release_temp=""
force=false

usage() {
  cat <<'EOF'
Usage: scripts/release-macos-candidate.sh [--force]

Builds the ad-hoc macOS release candidate when release, signing, packaging, or
bundle configuration changed since BRIAR_PREVIOUS_VERSION. Routine releases
use this automatic gate. Use --force only to test release-pipeline changes
regardless of the detected impact.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) force=true ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

cleanup() {
  release_cargo_cache_cleanup
  if [[ -n "$release_temp" ]]; then
    case "$release_temp" in
      /tmp/briar-macos-candidate.*) rm -rf -- "$release_temp" ;;
      *) echo "Refusing to clean unexpected candidate path: $release_temp" >&2 ;;
    esac
  fi
}
# shellcheck disable=SC1091 -- fixed repository path.
source "$workspace_root/scripts/release-cargo-cache.sh"
trap cleanup EXIT

cd "$workspace_root"

expected_bun_version="$(bun -e "console.log((await Bun.file('package.json').json()).packageManager.split('@')[1])")"
[[ "$(bun --version)" == "$expected_bun_version" ]] || {
  echo "Expected Bun $expected_bun_version; found $(bun --version)." >&2
  exit 1
}
set -a
# shellcheck disable=SC1091 -- fixed repository path.
source "$workspace_root/config/release.env"
set +a

if [[ "$force" != true && -z "$(git status --porcelain --untracked-files=all)" ]]; then
  set +e
  bun run src-cli/release-impact.ts --base-ref "v${BRIAR_PREVIOUS_VERSION}"
  impact_status=$?
  set -e
  case "$impact_status" in
    0) ;;
    20) exit 0 ;;
    *) echo "Release impact check failed with status $impact_status." >&2; exit "$impact_status" ;;
  esac
elif [[ "$force" == true ]]; then
  echo "Candidate build forced by --force."
else
  echo "Candidate build required because the worktree has uncommitted changes."
fi

rustc --version | grep -F "rustc 1.96.0 " >/dev/null || {
  echo "Expected the Rust 1.96.0 toolchain." >&2
  exit 1
}

release_temp="$(mktemp -d /tmp/briar-macos-candidate.XXXXXX)"
configure_release_cargo_cache
reset_release_bundle_output
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
