#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$workspace_root"

readonly swift_project="apps/briar/ios/BriarCompanion/BriarCompanion.xcodeproj"
readonly swift_scheme="BriarCompanion-Dev"
readonly simulator_destination="${BRIAR_IOS_DESTINATION:-platform=iOS Simulator,name=Briar iPhone 17 Pro}"
readonly ipad_destination="${BRIAR_IPAD_DESTINATION:-platform=iOS Simulator,name=iPad Pro 13-inch (M5)}"
mobile_temp_base="${TMPDIR:-/tmp}"
mobile_temp_base="${mobile_temp_base%/}"
mobile_ci_temp="$(mktemp -d "$mobile_temp_base/briar-mobile-ci.XXXXXX")"

cleanup() {
  case "$mobile_ci_temp" in
    "$mobile_temp_base"/briar-mobile-ci.*) rm -rf -- "$mobile_ci_temp" ;;
    *) echo "[mobile-ci] Refusing to clean unexpected path: $mobile_ci_temp" >&2 ;;
  esac
}
trap cleanup EXIT

require_command() {
  local command_name="$1"
  local install_hint="$2"
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "[mobile-ci] Missing ${command_name}. ${install_hint}" >&2
    exit 1
  }
}

require_command bun "Install the repository-pinned Bun version."
require_command rg "Install ripgrep for the mobile security checks."
require_command xcodebuild "Run mobile CI on a macOS worker with Xcode installed."
require_command rsync "Install rsync to create an isolated mobile build copy."

if ! java -version >/dev/null 2>&1; then
  mobile_java_home="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  if [[ ! -x "$mobile_java_home/bin/java" ]]; then
    echo "[mobile-ci] Missing JDK 17. Install it and set JAVA_HOME for the Android build." >&2
    exit 1
  fi
  export JAVA_HOME="$mobile_java_home"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

echo "[mobile-ci] Validating the shared Companion API contract."
bun run mobile:contract

echo "[mobile-ci] Validating the fail-closed iOS release selector and regenerating Xcode inputs."
bun run ios:release:verify
bun run ios:native:project

echo "[mobile-ci] Building and testing the independent SwiftUI app on iPhone."
xcodebuild \
  -project "$swift_project" \
  -scheme "$swift_scheme" \
  -destination "$simulator_destination" \
  -derivedDataPath "$mobile_ci_temp/swift-derived-data" \
  CODE_SIGNING_ALLOWED=NO \
  test

echo "[mobile-ci] Exercising VoiceOver/Dynamic Type and layout UI tests on iPad."
xcodebuild \
  -project "$swift_project" \
  -scheme "$swift_scheme" \
  -destination "$ipad_destination" \
  -derivedDataPath "$mobile_ci_temp/ipad-derived-data" \
  -only-testing:BriarCompanionUITests/BriarCompanionUITests/testAccessibilityAndLargestDynamicTypeLayout \
  CODE_SIGNING_ALLOWED=NO \
  test

echo "[mobile-ci] Analyzing and building the Production native configuration without signing."
xcodebuild \
  -project "$swift_project" \
  -scheme BriarCompanion-Production \
  -configuration Production \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$mobile_ci_temp/production-derived-data" \
  CODE_SIGNING_ALLOWED=NO \
  analyze build

echo "[mobile-ci] Checking session, download-memory, and log security invariants."
rg -F 'kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly' apps/briar/ios/BriarCompanion/App/SessionStore.swift >/dev/null
rg -F 'session.download(for: request)' apps/briar/ios/BriarCompanion/App/MobileAPIContract.swift >/dev/null
if rg -n '(^|[^A-Za-z])(print|debugPrint|dump)\(' apps/briar/ios/BriarCompanion/App; then
  echo "[mobile-ci] Production Swift sources must not use unredacted console logging." >&2
  exit 1
fi

mobile_build_root="$mobile_ci_temp/worktree"
mkdir -p "$mobile_build_root"
rsync -a \
  --files-from=<(git ls-files -co --exclude-standard) \
  "$workspace_root/" \
  "$mobile_build_root/"
if [[ -f "$workspace_root/.env.keys" ]]; then
  rsync -a "$workspace_root/.env.keys" "$mobile_build_root/.env.keys"
fi
ln -s "$workspace_root/node_modules" "$mobile_build_root/node_modules"
ln -s \
  "$workspace_root/apps/briar/node_modules" \
  "$mobile_build_root/apps/briar/node_modules"
cd "$mobile_build_root"

echo "[mobile-ci] Building the existing Tauri iOS release path for the simulator."
bun --cwd apps/briar tauri ios build --debug --target aarch64-sim --ci --no-sign

echo "[mobile-ci] Building the existing Tauri Android debug release path."
bun run android:build:debug

echo "[mobile-ci] All mobile contract and build checks passed."
