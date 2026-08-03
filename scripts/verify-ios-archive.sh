#!/bin/bash
set -euo pipefail

archive_path="${1:-}"
expected_bundle_id="${2:-app.briar.companion}"

fail() {
  echo "[ios-archive] $*" >&2
  exit 1
}

[[ -n "$archive_path" ]] || fail "Usage: verify-ios-archive.sh <archive.xcarchive> [bundle-id]"
[[ -d "$archive_path" ]] || fail "Archive does not exist: $archive_path"

app_path="$(find "$archive_path/Products/Applications" -maxdepth 1 -type d -name '*.app' -print -quit)"
[[ -n "$app_path" ]] || fail "Archive contains no application bundle."
info_plist="$app_path/Info.plist"
[[ -f "$info_plist" ]] || fail "Application Info.plist is missing."

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist")"
marketing_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info_plist")"
build_number="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info_plist")"
[[ "$bundle_id" == "$expected_bundle_id" ]] ||
  fail "Expected bundle ID $expected_bundle_id, found $bundle_id."
[[ "$marketing_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "Marketing version must use X.Y.Z format, found $marketing_version."
[[ "$build_number" =~ ^[1-9][0-9]*$ ]] ||
  fail "Build number must be a positive integer, found $build_number."

codesign --verify --deep --strict "$app_path"

archive_temp_base="${TMPDIR:-/tmp}"
archive_temp_base="${archive_temp_base%/}"
archive_temp="$(mktemp -d "$archive_temp_base/briar-ios-archive.XXXXXX")"
cleanup() {
  case "$archive_temp" in
    "$archive_temp_base"/briar-ios-archive.*) rm -rf -- "$archive_temp" ;;
    *) echo "[ios-archive] Refusing to clean unexpected path: $archive_temp" >&2 ;;
  esac
}
trap cleanup EXIT

entitlements="$archive_temp/entitlements.plist"
codesign -d --entitlements :- "$app_path" >"$entitlements" 2>/dev/null
[[ -s "$entitlements" ]] || fail "Signed entitlements are missing."

application_identifier="$(/usr/libexec/PlistBuddy -c 'Print :application-identifier' "$entitlements" 2>/dev/null || true)"
[[ "$application_identifier" == *".$expected_bundle_id" ]] ||
  fail "Signed application identifier does not end with $expected_bundle_id."
get_task_allow="$(/usr/libexec/PlistBuddy -c 'Print :get-task-allow' "$entitlements" 2>/dev/null || true)"
[[ "$get_task_allow" != "true" ]] || fail "Archive has the development get-task-allow entitlement."

associated_domain="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.associated-domains:0' "$entitlements" 2>/dev/null || true)"
[[ "$associated_domain" == "applinks:briar-api.wbai.workers.dev" ]] ||
  fail "Required Briar universal-link entitlement is missing."

profile="$app_path/embedded.mobileprovision"
[[ -f "$profile" ]] || fail "App Store provisioning profile is missing."
profile_plist="$archive_temp/profile.plist"
security cms -D -i "$profile" >"$profile_plist"
profile_identifier="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$profile_plist")"
[[ "$profile_identifier" == *".$expected_bundle_id" ]] ||
  fail "Provisioning profile does not authorize $expected_bundle_id."
profile_debug="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$profile_plist" 2>/dev/null || true)"
[[ "$profile_debug" != "true" ]] || fail "Provisioning profile permits debugger attachment."

echo "[ios-archive] Verified $bundle_id $marketing_version ($build_number), signature, profile, and entitlements."
