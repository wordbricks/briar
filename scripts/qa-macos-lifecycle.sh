#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
previous_dir=""
candidate_dir=""
evidence_file=""
allow_same_version=false
allow_legacy_previous_signature=false
require_production_signature=false

while (( $# > 0 )); do
  case "$1" in
    --previous-dir)
      previous_dir="$2"
      shift 2
      ;;
    --candidate-dir)
      candidate_dir="$2"
      shift 2
      ;;
    --evidence-file)
      evidence_file="$2"
      shift 2
      ;;
    --allow-same-version)
      allow_same_version=true
      shift
      ;;
    --allow-legacy-previous-signature)
      allow_legacy_previous_signature=true
      shift
      ;;
    --require-production-signature)
      require_production_signature=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$previous_dir" || ! -d "$candidate_dir" ]]; then
  echo "Both --previous-dir and --candidate-dir must be artifact directories." >&2
  exit 1
fi

qa_root="$(mktemp -d /tmp/briar-lifecycle.XXXXXX)"
mounted_path=""

cleanup() {
  if [[ -n "$mounted_path" ]]; then
    hdiutil detach "$mounted_path" >/dev/null 2>&1 || true
  fi
  case "$qa_root" in
    /tmp/briar-lifecycle.*) rm -rf -- "$qa_root" ;;
    *) echo "Refusing to clean unexpected QA path: $qa_root" >&2 ;;
  esac
}
trap cleanup EXIT

resolve_single() {
  local directory="$1"
  local pattern="$2"
  local label="$3"
  local matches=()
  shopt -s nullglob
  matches=("$directory"/$pattern)
  shopt -u nullglob
  if (( ${#matches[@]} != 1 )); then
    echo "Expected exactly one $label in $directory; found ${#matches[@]}." >&2
    exit 1
  fi
  printf '%s\n' "${matches[0]}"
}

verify_artifact_directory() {
  local directory="$1"
  local require_manifest="$2"
  if [[ ! -f "$directory/SHA256SUMS" ]]; then
    echo "Missing SHA256SUMS in $directory." >&2
    exit 1
  fi
  (cd "$directory" && shasum -a 256 --check SHA256SUMS)
  if [[ -f "$directory/release-manifest.json" ]]; then
    bun run "$workspace_root/src-cli/release-manifest.ts" verify --root "$directory"
  elif [[ "$require_manifest" == "true" ]]; then
    echo "Candidate is missing release-manifest.json." >&2
    exit 1
  fi
}

app_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
    "$1/Contents/Info.plist"
}

assert_app_bundle() {
  local app="$1"
  local signature_required="$2"
  local expected_version="$3"
  local identifier
  identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")"
  if [[ "$identifier" != "app.briar.desktop" ]]; then
    echo "Unexpected bundle identifier: $identifier" >&2
    exit 1
  fi
  if [[ "$(app_version "$app")" != "$expected_version" ]]; then
    echo "Installed app version does not match $expected_version." >&2
    exit 1
  fi
  if ! file "$app/Contents/MacOS/briar" | grep -q 'arm64'; then
    echo "Installed app is not arm64." >&2
    exit 1
  fi
  if [[ "$(tr -d '\n' < "$app/Contents/Resources/skills/briar-workflow/VERSION")" != "$expected_version" ]]; then
    echo "Bundled workflow skill version does not match the app." >&2
    exit 1
  fi
  if [[ "$(tr -d '\n' < "$app/Contents/Resources/skills/browser/VERSION")" != "$expected_version" ]]; then
    echo "Bundled browser skill version does not match the app." >&2
    exit 1
  fi
  if ! codesign --verify --deep --strict "$app"; then
    if [[ "$signature_required" == "true" ]]; then
      echo "Candidate app has an invalid ad-hoc signature." >&2
      exit 1
    fi
    echo "Legacy previous app signature is incomplete; allowed for the 0.2.0 baseline." >&2
  fi
}

version_is_newer() {
  BRIAR_PREVIOUS_VERSION="$1" BRIAR_CANDIDATE_VERSION="$2" bun -e '
    const parse = (value) => {
      const [core, prerelease] = value.split("-", 2);
      return { parts: core.split(".").map(Number), prerelease };
    };
    const previous = parse(process.env.BRIAR_PREVIOUS_VERSION);
    const candidate = parse(process.env.BRIAR_CANDIDATE_VERSION);
    for (let index = 0; index < 3; index += 1) {
      if (candidate.parts[index] !== previous.parts[index]) {
        process.exit(candidate.parts[index] > previous.parts[index] ? 0 : 1);
      }
    }
    if (candidate.prerelease === undefined && previous.prerelease !== undefined) process.exit(0);
    if (candidate.prerelease === previous.prerelease) process.exit(1);
    if (candidate.prerelease === undefined) process.exit(0);
    if (previous.prerelease === undefined) process.exit(1);
    process.exit(candidate.prerelease.localeCompare(previous.prerelease, "en", { numeric: true }) > 0 ? 0 : 1);
  '
}

install_dmg() {
  local dmg="$1"
  local destination="$2"
  local mount="$3"
  mkdir -p "$mount"
  hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
  mounted_path="$mount"
  local source_app
  source_app="$(find "$mount" -maxdepth 2 -type d -name 'Briar.app' -print -quit)"
  if [[ -z "$source_app" ]]; then
    echo "DMG does not contain Briar.app." >&2
    exit 1
  fi
  ditto "$source_app" "$destination"
  hdiutil detach "$mounted_path" >/dev/null
  mounted_path=""
}

state_hash() {
  (
    cd "$1"
    find . -type f | LC_ALL=C sort | while IFS= read -r file; do
      shasum -a 256 "$file"
    done
  ) | shasum -a 256 | awk '{print $1}'
}

verify_artifact_directory "$previous_dir" false
verify_artifact_directory "$candidate_dir" true

previous_dmg="$(resolve_single "$previous_dir" 'Briar_*_aarch64.dmg' 'previous DMG')"
candidate_dmg="$(resolve_single "$candidate_dir" 'Briar_*_aarch64.dmg' 'candidate DMG')"
previous_zip="$(resolve_single "$previous_dir" 'Briar_*_macos.app.zip' 'previous app ZIP')"
candidate_zip="$(resolve_single "$candidate_dir" 'Briar_*_macos.app.zip' 'candidate app ZIP')"

mkdir -p "$qa_root/inspect/previous" "$qa_root/inspect/candidate"
ditto -x -k "$previous_zip" "$qa_root/inspect/previous"
ditto -x -k "$candidate_zip" "$qa_root/inspect/candidate"
previous_version="$(app_version "$qa_root/inspect/previous/Briar.app")"
candidate_version="$(app_version "$qa_root/inspect/candidate/Briar.app")"

if [[ "$allow_same_version" != "true" ]]; then
  if ! version_is_newer "$previous_version" "$candidate_version"; then
    echo "Candidate version $candidate_version must be newer than $previous_version." >&2
    exit 1
  fi
fi

state_root="$qa_root/user-state"
mkdir -p \
  "$state_root/Library/Application Support/app.briar.desktop" \
  "$state_root/.config/briar"
printf '%s\n' '{"token":"session-preservation-sentinel"}' \
  > "$state_root/Library/Application Support/app.briar.desktop/session.json"
printf '%s\n' '{"projects":[{"id":"project-preservation-sentinel"}]}' \
  > "$state_root/.config/briar/config.json"
initial_state_hash="$(state_hash "$state_root")"

applications_root="$qa_root/Applications"
installed_app="$applications_root/Briar.app"
rollback_app="$qa_root/rollback/Briar.app"
failed_candidate_app="$qa_root/failed-candidate/Briar.app"
mkdir -p "$applications_root" "$(dirname "$rollback_app")" "$(dirname "$failed_candidate_app")"

install_dmg "$previous_dmg" "$installed_app" "$qa_root/mount-previous"
previous_signature_required=true
if [[ "$allow_legacy_previous_signature" == "true" ]]; then
  previous_signature_required=false
fi
assert_app_bundle "$installed_app" "$previous_signature_required" "$previous_version"
[[ "$(state_hash "$state_root")" == "$initial_state_hash" ]]

mv "$installed_app" "$rollback_app"
install_dmg "$candidate_dmg" "$installed_app" "$qa_root/mount-candidate"
assert_app_bundle "$installed_app" true "$candidate_version"
"$workspace_root/scripts/verify-bundled-runtime.sh" "$installed_app"
[[ "$(state_hash "$state_root")" == "$initial_state_hash" ]]

candidate_signature="strict-ad-hoc"
if [[ "$require_production_signature" == "true" ]]; then
  if ! candidate_codesign_details="$(codesign -d --verbose=4 "$installed_app" 2>&1)"; then
    echo "Production candidate has an invalid code signature." >&2
    exit 1
  fi
  if ! grep -q '^Authority=Developer ID Application:' \
    <<< "$candidate_codesign_details"; then
    echo "Production candidate is not signed by a Developer ID Application identity." >&2
    exit 1
  fi
  xcrun stapler validate "$installed_app"
  spctl --assess --type execute --verbose=2 "$installed_app"
  candidate_signature="developer-id-notarized-gatekeeper"
fi

mv "$installed_app" "$failed_candidate_app"
mv "$rollback_app" "$installed_app"
assert_app_bundle "$installed_app" "$previous_signature_required" "$previous_version"
[[ "$(state_hash "$state_root")" == "$initial_state_hash" ]]

if [[ -n "$evidence_file" ]]; then
  BRIAR_EVIDENCE_FILE="$evidence_file" \
  BRIAR_PREVIOUS_VERSION="$previous_version" \
  BRIAR_CANDIDATE_VERSION="$candidate_version" \
  BRIAR_CANDIDATE_SIGNATURE="$candidate_signature" \
  BRIAR_STATE_HASH="$initial_state_hash" \
    bun -e 'await Bun.write(process.env.BRIAR_EVIDENCE_FILE, JSON.stringify({schemaVersion:1, result:"passed", previousVersion:process.env.BRIAR_PREVIOUS_VERSION, candidateVersion:process.env.BRIAR_CANDIDATE_VERSION, checksumsVerified:true, candidateManifestVerified:true, candidateSignature:process.env.BRIAR_CANDIDATE_SIGNATURE, statePreserved:true, stateHash:process.env.BRIAR_STATE_HASH, install:"dmg", update:"bundle-replacement", rollback:"retained-previous-bundle"}, null, 2) + "\n")'
fi

echo "Lifecycle QA passed: $previous_version -> $candidate_version -> $previous_version; state preserved."
