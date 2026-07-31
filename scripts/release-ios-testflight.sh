#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$workspace_root"

release_temp=""
installed_profile=""
original_keychains=()
release_temp_base="${TMPDIR:-/tmp}"
release_temp_base="${release_temp_base%/}"

fail() {
  echo "[ios-testflight] $*" >&2
  exit 1
}

cleanup() {
  if (( ${#original_keychains[@]} > 0 )); then
    security list-keychains -d user -s "${original_keychains[@]}" >/dev/null
  fi
  if [[ -n "$release_temp" ]]; then
    case "$release_temp" in
      "$release_temp_base"/briar-ios-testflight.*)
        rm -rf -- "$release_temp"
        ;;
      *)
        echo "[ios-testflight] Refusing to clean unexpected path: $release_temp" >&2
        ;;
    esac
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Usage: bun run release:ios:testflight [-- --build-number N] [--dry-run]

Builds, signs, validates, and uploads the current iOS version to TestFlight.
Without --build-number, the next suffix for the current version is selected
from App Store Connect (for example, 1.2.30.1 becomes 1.2.30.2).
EOF
}

build_number=""
dry_run=false
while (( $# > 0 )); do
  case "$1" in
    --build-number)
      (( $# >= 2 )) || fail "--build-number requires a value."
      build_number="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || fail "TestFlight releases require macOS."
for command_name in base64 bun curl jq openssl plutil security xcodebuild xcrun; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing command: $command_name"
done

set -a
# Checked-in public release configuration.
# shellcheck disable=SC1091
source "$workspace_root/config/release.env"
set +a

: "${APPLE_API_KEY:?APPLE_API_KEY is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
: "${APPLE_API_KEY_CONTENT:?APPLE_API_KEY_CONTENT is required}"
: "${APPLE_IOS_CERTIFICATE:?APPLE_IOS_CERTIFICATE is required}"
: "${APPLE_IOS_CERTIFICATE_PASSWORD:?APPLE_IOS_CERTIFICATE_PASSWORD is required}"
: "${APPLE_IOS_PROVISIONING_PROFILE:?APPLE_IOS_PROVISIONING_PROFILE is required}"
: "${KEYCHAIN_PASSWORD:?KEYCHAIN_PASSWORD is required}"

version="$(jq -er '.version | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' package.json)"
bundle_id="$(jq -er '.identifier' src-tauri/tauri.ios.conf.json)"
project_version="$(plutil -extract CFBundleShortVersionString raw src-tauri/gen/apple/briar_iOS/Info.plist)"
[[ "$project_version" == "$version" ]] ||
  fail "package.json is $version but the iOS project is $project_version. Update the iOS version first."
grep -Fq "CFBundleShortVersionString: $version" src-tauri/gen/apple/project.yml ||
  fail "src-tauri/gen/apple/project.yml is not set to iOS version $version."

while IFS= read -r keychain; do
  keychain="${keychain#*\"}"
  keychain="${keychain%\"*}"
  [[ -n "$keychain" ]] && original_keychains+=("$keychain")
done < <(security list-keychains -d user)

release_temp="$(mktemp -d "$release_temp_base/briar-ios-testflight.XXXXXX")"
chmod 700 "$release_temp"
keychain_path="$release_temp/signing.keychain-db"
certificate_path="$release_temp/ios-distribution.p12"
profile_path="$release_temp/app-store.mobileprovision"
profile_plist="$release_temp/profile.plist"
tauri_api_key_path="$release_temp/AuthKey_${APPLE_API_KEY}.p8"
upload_api_key_path="$release_temp/UploadAuthKey_${APPLE_API_KEY}.p8"

umask 077
printf '%s' "$APPLE_IOS_CERTIFICATE" | base64 --decode > "$certificate_path"
printf '%s' "$APPLE_IOS_PROVISIONING_PROFILE" | base64 --decode > "$profile_path"
printf '%s' "$APPLE_API_KEY_CONTENT" > "$tauri_api_key_path"
printf '%s' "$APPLE_API_KEY_CONTENT" > "$upload_api_key_path"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
security set-keychain-settings -t 3600 -u "$keychain_path"
security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$APPLE_IOS_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign >/dev/null
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$keychain_path" >/dev/null
security list-keychains -d user -s "$keychain_path" "${original_keychains[@]}"

signing_hash="$(
  security find-identity -v -p codesigning "$keychain_path" |
    awk '/Apple Distribution:/ { print $2; exit }'
)"
[[ -n "$signing_hash" ]] || fail "The encrypted iOS certificate is not an Apple Distribution identity."

security cms -D -i "$profile_path" > "$profile_plist"
profile_name="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$profile_plist")"
profile_uuid="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$profile_plist")"
profile_team="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$profile_plist")"
profile_app_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$profile_plist")"
[[ "$profile_team" == "QFJZ2V3829" ]] || fail "The iOS profile belongs to the wrong team."
[[ "$profile_app_id" == "QFJZ2V3829.$bundle_id" ]] || fail "The iOS profile is for the wrong bundle ID."
/usr/libexec/PlistBuddy \
  -c 'Print :Entitlements:com.apple.developer.associated-domains' \
  "$profile_plist" >/dev/null || fail "The iOS profile is missing Associated Domains."

profile_directory="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profile_directory"
installed_profile="$profile_directory/$profile_uuid.mobileprovision"
cp "$profile_path" "$installed_profile"
chmod 600 "$installed_profile"

generate_jwt() {
  xcrun altool \
    --generate-jwt \
    --api-key "$APPLE_API_KEY" \
    --api-issuer "$APPLE_API_ISSUER" \
    --p8-file-path "$upload_api_key_path" 2>&1 |
    awk '/^eyJ/ { print; exit }'
}

if [[ -z "$build_number" ]]; then
  jwt="$(generate_jwt)"
  [[ -n "$jwt" ]] || fail "Could not generate an App Store Connect token."
  app_response="$(
    curl --fail --silent --show-error --get \
      -H "Authorization: Bearer $jwt" \
      --data-urlencode "filter[bundleId]=$bundle_id" \
      --data-urlencode 'limit=1' \
      https://api.appstoreconnect.apple.com/v1/apps
  )"
  app_id="$(printf '%s' "$app_response" | jq -er '.data[0].id')"
  builds_response="$(
    curl --fail --silent --show-error --get \
      -H "Authorization: Bearer $jwt" \
      --data-urlencode "filter[app]=$app_id" \
      --data-urlencode 'limit=200' \
      https://api.appstoreconnect.apple.com/v1/builds
  )"
  build_number="$(
    printf '%s' "$builds_response" |
      jq -er --arg prefix "$version." '
        [.data[].attributes.version
          | select(startswith($prefix))
          | ltrimstr($prefix)
          | select(test("^[0-9]+$"))
          | tonumber]
        | (max // 0) + 1
      '
  )"
fi

[[ "$build_number" =~ ^[1-9][0-9]*$ ]] || fail "Build number must be a positive integer."
bundle_version="$version.$build_number"
artifact_directory="$workspace_root/release-artifacts/testflight/$bundle_version"
[[ ! -e "$artifact_directory" ]] || fail "Artifact directory already exists: $artifact_directory"

if [[ "$dry_run" == true ]]; then
  echo "[ios-testflight] Credentials and profile are valid; next build is $bundle_version."
  exit 0
fi

export APPLE_API_KEY_PATH="$tauri_api_key_path"
bun tauri ios build \
  --build-number "$build_number" \
  --export-method app-store-connect \
  --archive-only \
  --ci

archive_path="$workspace_root/src-tauri/gen/apple/build/briar_iOS.xcarchive"
[[ -d "$archive_path" ]] || fail "Expected Tauri iOS archive at $archive_path"
archive_app="$archive_path/Products/Applications/Briar Companion.app"
actual_bundle_version="$(plutil -extract CFBundleVersion raw "$archive_app/Info.plist")"
[[ "$actual_bundle_version" == "$bundle_version" ]] ||
  fail "Expected archive build $bundle_version, found $actual_bundle_version."
mkdir -p "$artifact_directory"

export_options="$release_temp/ExportOptions.plist"
plutil -create xml1 "$export_options"
/usr/libexec/PlistBuddy -c 'Add :destination string export' "$export_options"
/usr/libexec/PlistBuddy -c 'Add :method string app-store-connect' "$export_options"
/usr/libexec/PlistBuddy -c 'Add :signingStyle string manual' "$export_options"
/usr/libexec/PlistBuddy -c "Add :signingCertificate string $signing_hash" "$export_options"
/usr/libexec/PlistBuddy -c "Add :teamID string $profile_team" "$export_options"
/usr/libexec/PlistBuddy -c 'Add :stripSwiftSymbols bool true' "$export_options"
/usr/libexec/PlistBuddy -c 'Add :provisioningProfiles dict' "$export_options"
/usr/libexec/PlistBuddy \
  -c "Add :provisioningProfiles:$bundle_id string $profile_name" \
  "$export_options"

export_path="$artifact_directory/export"
xcodebuild \
  -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$export_options"

ipa_path="$(find "$export_path" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
[[ -n "$ipa_path" ]] || fail "The signed IPA was not exported."
xcrun altool \
  --validate-app \
  -f "$ipa_path" \
  --api-key "$APPLE_API_KEY" \
  --api-issuer "$APPLE_API_ISSUER" \
  --p8-file-path "$upload_api_key_path"
xcrun altool \
  --upload-package "$ipa_path" \
  --api-key "$APPLE_API_KEY" \
  --api-issuer "$APPLE_API_ISSUER" \
  --p8-file-path "$upload_api_key_path" \
  --wait

echo "[ios-testflight] Uploaded $bundle_id $bundle_version to TestFlight: $ipa_path"
