#!/bin/bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${APPLE_CERTIFICATE:?APPLE_CERTIFICATE is required}"
: "${APPLE_CERTIFICATE_PASSWORD:?APPLE_CERTIFICATE_PASSWORD is required}"
: "${KEYCHAIN_PASSWORD:?KEYCHAIN_PASSWORD is required}"
: "${APPLE_API_KEY:?APPLE_API_KEY is required}"
: "${APPLE_API_KEY_CONTENT:?APPLE_API_KEY_CONTENT is required}"

keychain_path="$RUNNER_TEMP/briar-production.keychain-db"
certificate_path="$RUNNER_TEMP/briar-production.p12"
api_key_path="$RUNNER_TEMP/AuthKey_${APPLE_API_KEY}.p8"

umask 077
printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$certificate_path"
printf '%s' "$APPLE_API_KEY_CONTENT" > "$api_key_path"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$keychain_path"
security set-keychain-settings -t 3600 -u "$keychain_path"
security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$keychain_path" >/dev/null
security list-keychains -d user -s "$keychain_path"

identity="$(security find-identity -v -p codesigning "$keychain_path" \
  | awk -F'"' '/Developer ID Application/ { print $2; exit }')"
if [[ -z "$identity" ]]; then
  echo "No Developer ID Application identity found in Production certificate." >&2
  exit 1
fi

{
  printf 'APPLE_SIGNING_IDENTITY=%s\n' "$identity"
  printf 'APPLE_API_KEY_PATH=%s\n' "$api_key_path"
  printf 'BRIAR_PRODUCTION_KEYCHAIN=%s\n' "$keychain_path"
} >> "$GITHUB_ENV"

echo "Imported one Developer ID Application identity and App Store Connect API key."
