#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
artifact_root="$workspace_root/release-artifacts"
release_env="$workspace_root/config/release.env"
release_secrets="$workspace_root/.env.release"
publish=false
release_temp=""
release_environment_file=""
original_keychains=()
original_args=("$@")

usage() {
  cat <<'EOF'
Usage: scripts/release-macos-production.sh [--publish]

Builds, signs, notarizes, staples, packages, and verifies a Production macOS
release from the exact signed vX.Y.Z tag at HEAD. By default it stops after
creating local artifacts. Pass --publish to create and publish the GitHub
Release, upload immutable versioned objects to R2, and promote latest.json.

Credentials are decrypted from .env.release with dotenvx using the ignored
.env.keys file. See docs/operations/production-release.md for setup and
required variables.
EOF
}

fail() {
  echo "[production-release] $*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "Missing required command: $command_name"
}

read_keychains() {
  local line
  local path
  while IFS= read -r line; do
    path="${line#*\"}"
    path="${path%\"*}"
    [[ -n "$path" ]] && original_keychains+=("$path")
  done < <(security list-keychains -d user)
}

cleanup() {
  if [[ ${#original_keychains[@]} -gt 0 ]]; then
    security list-keychains -d user -s "${original_keychains[@]}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BRIAR_PRODUCTION_KEYCHAIN:-}" && -f "$BRIAR_PRODUCTION_KEYCHAIN" ]]; then
    security delete-keychain "$BRIAR_PRODUCTION_KEYCHAIN" >/dev/null 2>&1 || true
  fi
  if [[ -n "$release_temp" ]]; then
    case "$release_temp" in
      /tmp/briar-production-release.*) rm -rf -- "$release_temp" ;;
      *) echo "Refusing to clean unexpected release path: $release_temp" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)
      publish=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

if [[ "${BRIAR_RELEASE_SECRETS_LOADED:-}" != "true" ]]; then
  [[ -f "$release_secrets" ]] ||
    fail "Missing checked-in encrypted release environment at $release_secrets."
  release_keys="$workspace_root/.env.keys"
  [[ -f "$release_keys" ]] ||
    fail "Missing .env.keys; cannot decrypt release secrets and will not continue."
  dotenvx_bin="$workspace_root/node_modules/.bin/dotenvx"
  [[ -x "$dotenvx_bin" ]] ||
    fail "Missing dotenvx. Run 'bun install --frozen-lockfile' first."
  if [[ ${#original_args[@]} -gt 0 ]]; then
    exec "$dotenvx_bin" run \
      --strict \
      --redact \
      --overload \
      -f "$release_secrets" \
      -- env BRIAR_RELEASE_SECRETS_LOADED=true "$0" "${original_args[@]}"
  fi
  exec "$dotenvx_bin" run \
    --strict \
    --redact \
    --overload \
    -f "$release_secrets" \
    -- env BRIAR_RELEASE_SECRETS_LOADED=true "$0"
fi

[[ "$(uname -s)" == "Darwin" ]] || fail "Production macOS releases require macOS."

for command_name in bun cargo codesign curl git jq rustc security shasum spctl syft xcrun; do
  require_command "$command_name"
done
if [[ "$publish" == true ]]; then
  require_command gh
fi

cd "$workspace_root"

expected_bun_version="$(bun -e "console.log((await Bun.file('package.json').json()).packageManager.split('@')[1])")"
[[ "$(bun --version)" == "$expected_bun_version" ]] ||
  fail "Expected Bun $expected_bun_version; found $(bun --version)."
rustc --version | grep -F "rustc 1.96.0 " >/dev/null ||
  fail "Expected the Rust 1.96.0 toolchain."
[[ -z "$(git status --porcelain --untracked-files=all)" ]] ||
  fail "The Production release worktree must be clean."

set -a
# shellcheck disable=SC1090 -- fixed repository path.
source "$release_env"
set +a

version="$(bun -e "import config from './src-tauri/tauri.conf.json'; console.log(config.version)")"
tag="v$version"
commit_sha="$(git rev-parse HEAD)"

git show-ref --verify --quiet "refs/tags/$tag" ||
  fail "Missing exact release tag $tag at HEAD."
[[ "$(git rev-list -n 1 "$tag")" == "$commit_sha" ]] ||
  fail "Release tag $tag does not point at HEAD."
[[ "$(git cat-file -t "$tag")" == "tag" ]] ||
  fail "Release tag $tag must be annotated and signed."
git verify-tag "$tag" >/dev/null ||
  fail "Release tag $tag does not have a valid Git signature."

git fetch --quiet origin main
git merge-base --is-ancestor "$commit_sha" FETCH_HEAD ||
  fail "Release commit $commit_sha is not contained in origin/main."
remote_commit="$(
  git ls-remote --tags origin "refs/tags/$tag^{}" |
    awk 'NR == 1 { print $1 }'
)"
[[ "$remote_commit" == "$commit_sha" ]] ||
  fail "Remote annotated tag $tag is missing or does not point at HEAD."

if [[ "$publish" == true ]]; then
  gh auth status --hostname github.com >/dev/null
  repository="${BRIAR_RELEASE_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
  export BRIAR_RELEASE_REPOSITORY="$repository"
  if gh release view "$tag" --repo "$repository" >/dev/null 2>&1; then
    fail "GitHub Release $tag already exists; refusing to overwrite it."
  fi
fi

release_temp="$(mktemp -d /tmp/briar-production-release.XXXXXX)"
release_environment_file="$release_temp/release.env"
touch "$release_environment_file"
chmod 600 "$release_environment_file"
export BRIAR_RELEASE_TEMP="$release_temp"
export BRIAR_RELEASE_ENV_FILE="$release_environment_file"
export BRIAR_RELEASE_COMMIT="$commit_sha"
export BRIAR_RELEASE_INVOCATION_ID="local:$tag:$commit_sha"

preflight_args=(preflight --version "$version")
if [[ "$publish" == true ]]; then
  preflight_args+=(--publish)
fi
scripts/with-release-env.sh \
  bun run src-cli/production-release.ts "${preflight_args[@]}"

read_keychains
scripts/import-apple-signing-assets.sh
set -a
# shellcheck disable=SC1090 -- generated mode-0600 file in validated temporary root.
source "$release_environment_file"
set +a

production_config="$release_temp/tauri.production.json"
scripts/with-release-env.sh \
  bun run src-cli/production-release.ts config \
    --version "$version" \
    --output "$production_config"
scripts/with-release-env.sh bun run tauri build --config "$production_config"

dmg_directory="$workspace_root/src-tauri/target/release/bundle/dmg"
dmg_path="$(
  find "$dmg_directory" -maxdepth 1 -type f -name 'Briar_*_aarch64.dmg' -print -quit
)"
[[ -n "$dmg_path" ]] || fail "Expected a signed Production DMG."
xcrun notarytool submit "$dmg_path" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait
xcrun stapler staple "$dmg_path"

scripts/package-production-release.sh

scripts/qa-macos-lifecycle.sh \
  --previous-dir "$artifact_root" \
  --candidate-dir "$artifact_root" \
  --allow-same-version \
  --require-production-signature \
  --evidence-file "$artifact_root/lifecycle-evidence.json"
bun run tauri signer sign "$artifact_root/lifecycle-evidence.json"
(
  cd "$artifact_root"
  find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 -- > SHA256SUMS
  shasum -a 256 --check SHA256SUMS
)

if [[ "$publish" != true ]]; then
  echo "Verified Production artifacts in $artifact_root"
  echo "Re-run from the same clean signed tag with --publish to publish them."
  exit 0
fi

gh release create "$tag" "$artifact_root"/* \
  --repo "$repository" \
  --draft \
  --verify-tag \
  --generate-notes \
  --title "Briar $tag"

for artifact in "$artifact_root"/*; do
  name="$(basename "$artifact")"
  bunx wrangler r2 object put \
    "briar-releases/releases/$tag/$name" \
    --file "$artifact" \
    --remote
done

curl --fail --silent --show-error --head \
  "${BRIAR_RELEASE_BASE_URL}/${tag}/Briar.app.tar.gz" >/dev/null
gh release edit "$tag" --repo "$repository" --draft=false --latest
bunx wrangler r2 object put \
  "briar-releases/releases/latest.json" \
  --file "$artifact_root/latest.json" \
  --remote
curl --fail --silent --show-error \
  "${BRIAR_UPDATE_ENDPOINT}?promoted=${version}" |
  jq -e --arg version "$version" '.version == $version' >/dev/null

release_url="$(gh release view "$tag" --repo "$repository" --json url --jq .url)"
echo "Published Briar $tag from the local release host: $release_url"
