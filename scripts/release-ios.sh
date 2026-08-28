#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
release_env="$workspace_root/config/release.env"
release_secrets="$workspace_root/.env.release"
release_keys="$workspace_root/.env.keys"
channel=""
implementation_override=""
marketing_version=""
build_number=""
upload=false
original_args=("$@")
release_temp=""
release_temp_base="${TMPDIR:-/tmp}"
release_temp_base="${release_temp_base%/}"
ios_keychain=""
original_keychains=()

usage() {
  cat <<'EOF'
Usage: scripts/release-ios.sh --channel internal|production \
  --marketing-version X.Y.Z --build-number N \
  [--implementation tauri|native] [--upload]

Runs the complete mobile quality gate, archives the selected iOS implementation
with the existing app.briar.companion identity, verifies distribution signing,
exports an IPA, and optionally uploads that exact IPA to App Store Connect.

Internal releases may explicitly select native before stabilization. Production
native releases remain locked until config/ios-release.json records the passed
Internal TestFlight build. Omitting --implementation uses the checked-in default.
EOF
}

fail() {
  echo "[ios-release] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

cleanup() {
  if [[ ${#original_keychains[@]} -gt 0 ]]; then
    security list-keychains -d user -s "${original_keychains[@]}" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ios_keychain" && -f "$ios_keychain" ]]; then
    security delete-keychain "$ios_keychain" >/dev/null 2>&1 || true
  fi
  if [[ -n "$release_temp" ]]; then
    case "$release_temp" in
      "$release_temp_base"/briar-ios-release.*) rm -rf -- "$release_temp" ;;
      *) echo "[ios-release] Refusing to clean unexpected path: $release_temp" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

read_keychains() {
  local line
  local path
  while IFS= read -r line; do
    path="${line#*\"}"
    path="${path%\"*}"
    [[ -n "$path" ]] && original_keychains+=("$path")
  done < <(security list-keychains -d user)
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) channel="${2:-}"; shift ;;
    --implementation) implementation_override="${2:-}"; shift ;;
    --marketing-version) marketing_version="${2:-}"; shift ;;
    --build-number) build_number="${2:-}"; shift ;;
    --upload) upload=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "Unknown argument: $1" ;;
  esac
  shift
done

[[ "$channel" == "internal" || "$channel" == "production" ]] ||
  fail "--channel must be internal or production."
[[ "$marketing_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "--marketing-version must use X.Y.Z format."
[[ "$build_number" =~ ^[1-9][0-9]*$ ]] || fail "--build-number must be a positive integer."
if [[ -n "$implementation_override" ]]; then
  [[ "$implementation_override" == "tauri" || "$implementation_override" == "native" ]] ||
    fail "--implementation must be tauri or native."
fi
[[ "$(uname -s)" == "Darwin" ]] || fail "iOS releases require macOS."

for command_name in base64 bun codesign git jq rsync security shasum xcodebuild xcrun; do
  require_command "$command_name"
done
[[ -x /usr/libexec/PlistBuddy ]] || fail "Missing required command: /usr/libexec/PlistBuddy"

cd "$workspace_root"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] ||
  fail "The iOS release worktree must be clean."

set -a
# shellcheck disable=SC1090 -- fixed checked-in public release configuration.
source "$release_env"
set +a

if [[ "${BRIAR_IOS_RELEASE_SECRETS_LOADED:-}" != "true" ]]; then
  [[ -f "$release_secrets" ]] || fail "Missing encrypted release environment: $release_secrets"
  [[ -f "$release_keys" ]] || fail "Missing .env.keys for release credential decryption."
  dotenvx_bin="$workspace_root/node_modules/.bin/dotenvx"
  [[ -x "$dotenvx_bin" ]] || fail "Install dependencies before running the iOS release."
  exec "$dotenvx_bin" run --strict --redact --overload -f "$release_secrets" -- \
    env BRIAR_IOS_RELEASE_SECRETS_LOADED=true "$0" "${original_args[@]}"
fi

: "${APPLE_API_KEY:?APPLE_API_KEY is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
: "${APPLE_API_KEY_CONTENT:?APPLE_API_KEY_CONTENT is required}"
: "${IOS_DISTRIBUTION_CERTIFICATE:?IOS_DISTRIBUTION_CERTIFICATE is required}"
: "${IOS_DISTRIBUTION_CERTIFICATE_PASSWORD:?IOS_DISTRIBUTION_CERTIFICATE_PASSWORD is required}"
: "${IOS_PROVISIONING_PROFILE_UUID:?IOS_PROVISIONING_PROFILE_UUID is required}"
: "${KEYCHAIN_PASSWORD:?KEYCHAIN_PASSWORD is required}"

resolve_args=(resolve --channel "$channel")
if [[ -n "$implementation_override" ]]; then
  resolve_args+=(--implementation "$implementation_override")
fi
resolved="$(bun run scripts/ios-release-config.ts "${resolve_args[@]}")"
implementation="$(jq -r '.implementation' <<<"$resolved")"
bundle_id="$(jq -r '.bundleIdentifier' <<<"$resolved")"

echo "[ios-release] Running contract, Swift, accessibility/layout, and Tauri iOS/Android gates."
# The Tauri simulator regression build is explicitly unsigned.  Do not expose
# App Store Connect credentials to it: the Tauri CLI interprets a partial API
# key configuration as a code-signing request and rejects the missing key path.
env -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_CONTENT bun run mobile:ci

release_temp="$(mktemp -d "$release_temp_base/briar-ios-release.XXXXXX")"
private_keys="$release_temp/private_keys"
mkdir -p "$private_keys"
auth_key_path="$private_keys/AuthKey_${APPLE_API_KEY}.p8"
certificate_path="$release_temp/ios-distribution.p12"
ios_keychain="$release_temp/briar-ios.keychain-db"
umask 077
printf '%s' "$APPLE_API_KEY_CONTENT" >"$auth_key_path"
printf '%s' "$IOS_DISTRIBUTION_CERTIFICATE" | base64 --decode >"$certificate_path"

read_keychains
security create-keychain -p "$KEYCHAIN_PASSWORD" "$ios_keychain"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$ios_keychain"
security set-keychain-settings -t 3600 -u "$ios_keychain"
security import "$certificate_path" \
  -k "$ios_keychain" \
  -P "$IOS_DISTRIBUTION_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$ios_keychain" >/dev/null
security list-keychains -d user -s "$ios_keychain" "${original_keychains[@]}"
security find-identity -v -p codesigning "$ios_keychain" |
  grep -E '"(Apple Distribution|iPhone Distribution):' >/dev/null ||
  fail "The imported certificate contains no Apple Distribution identity."

artifact_root="$workspace_root/release-artifacts/ios/$marketing_version-$build_number/$implementation"
archive_path="$artifact_root/BriarCompanion.xcarchive"
export_path="$artifact_root/export"
mkdir -p "$artifact_root"

authentication_args=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$auth_key_path"
  -authenticationKeyID "$APPLE_API_KEY"
  -authenticationKeyIssuerID "$APPLE_API_ISSUER"
)
common_build_settings=(
  CODE_SIGN_STYLE=Manual
  CODE_SIGN_IDENTITY="Apple Distribution"
  PROVISIONING_PROFILE_SPECIFIER="$IOS_PROVISIONING_PROFILE_UUID"
  DEVELOPMENT_TEAM=QFJZ2V3829
  PRODUCT_BUNDLE_IDENTIFIER="$bundle_id"
  MARKETING_VERSION="$marketing_version"
  CURRENT_PROJECT_VERSION="$build_number"
  INFOPLIST_KEY_CFBundleShortVersionString="$marketing_version"
  INFOPLIST_KEY_CFBundleVersion="$build_number"
)

if [[ "$implementation" == "native" ]]; then
  bun run mobile:contract:check
  bun run ios:native:project
  xcodebuild \
    -project apps/briar/ios/BriarCompanion/BriarCompanion.xcodeproj \
    -scheme BriarCompanion-Production \
    -configuration Production \
    -destination 'generic/platform=iOS' \
    -archivePath "$archive_path" \
    "${authentication_args[@]}" \
    "${common_build_settings[@]}" \
    clean archive
else
  bun run build
  mkdir -p apps/briar/src-tauri/gen/apple/assets
  rsync -a --delete apps/briar/dist/ apps/briar/src-tauri/gen/apple/assets/
  xcodebuild \
    -project apps/briar/src-tauri/gen/apple/briar.xcodeproj \
    -scheme briar_iOS \
    -configuration release \
    -destination 'generic/platform=iOS' \
    -archivePath "$archive_path" \
    "${authentication_args[@]}" \
    "${common_build_settings[@]}" \
    clean archive
fi

scripts/verify-ios-archive.sh "$archive_path" "$bundle_id"
export_options_path="$release_temp/ios-export-options.plist"
cp "$workspace_root/config/ios-export-options.plist" "$export_options_path"
/usr/libexec/PlistBuddy -c 'Set :signingStyle manual' "$export_options_path"
/usr/libexec/PlistBuddy -c 'Add :provisioningProfiles dict' "$export_options_path"
/usr/libexec/PlistBuddy \
  -c "Add :provisioningProfiles:$bundle_id string $IOS_PROVISIONING_PROFILE_UUID" \
  "$export_options_path"
xcodebuild -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$export_options_path" \
  "${authentication_args[@]}"

ipa_path="$(find "$export_path" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
[[ -n "$ipa_path" ]] || fail "Xcode exported no IPA."
ipa_checksum="$(shasum -a 256 "$ipa_path" | awk '{print $1}')"
commit_sha="$(git rev-parse HEAD)"
jq -n \
  --arg channel "$channel" \
  --arg implementation "$implementation" \
  --arg bundleId "$bundle_id" \
  --arg marketingVersion "$marketing_version" \
  --arg buildNumber "$build_number" \
  --arg commitSha "$commit_sha" \
  --arg ipaSha256 "$ipa_checksum" \
  '{schemaVersion:1, channel:$channel, implementation:$implementation, bundleId:$bundleId, marketingVersion:$marketingVersion, buildNumber:$buildNumber, commitSha:$commitSha, ipaSha256:$ipaSha256}' \
  >"$artifact_root/release-manifest.json"

if [[ "$upload" == true ]]; then
  (
    cd "$release_temp"
    xcrun altool --upload-app --type ios --file "$ipa_path" \
      --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
  )
  echo "[ios-release] Uploaded the verified $implementation IPA. Record its processed App Store build ID before native promotion."
else
  echo "[ios-release] Exported verified IPA and manifest in $artifact_root (not uploaded)."
fi
