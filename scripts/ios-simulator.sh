#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
readonly workspace_root

readonly xcodebuild_bin="/usr/bin/xcodebuild"
readonly xcode_select_bin="/usr/bin/xcode-select"
readonly xcrun_bin="/usr/bin/xcrun"

readonly swift_project="apps/briar/ios/BriarCompanion/BriarCompanion.xcodeproj"
readonly swift_dev_scheme="BriarCompanion-Dev"
readonly swift_production_scheme="BriarCompanion-Production"
readonly ios_runtime_version="${BRIAR_IOS_RUNTIME_VERSION:-26.5}"
readonly ios_runtime_identifier="com.apple.CoreSimulator.SimRuntime.iOS-${ios_runtime_version//./-}"
readonly iphone_name="${BRIAR_IOS_SIMULATOR_NAME:-Briar iPhone 17 Pro}"
readonly iphone_type="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
readonly ipad_name="${BRIAR_IPAD_SIMULATOR_NAME:-iPad Pro 13-inch (M5)}"
readonly ipad_type="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB"
readonly iphone_destination="${BRIAR_IOS_DESTINATION:-platform=iOS Simulator,name=$iphone_name,OS=$ios_runtime_version}"
readonly ipad_destination="${BRIAR_IPAD_DESTINATION:-platform=iOS Simulator,name=$ipad_name,OS=$ios_runtime_version}"
readonly iphone_destination_overridden="${BRIAR_IOS_DESTINATION:-}"
readonly ipad_destination_overridden="${BRIAR_IPAD_DESTINATION:-}"
readonly generic_simulator_destination="generic/platform=iOS Simulator"
derived_data_args=()
if [[ -n "${BRIAR_IOS_DERIVED_DATA_PATH:-}" ]]; then
  derived_data_args=(-derivedDataPath "$BRIAR_IOS_DERIVED_DATA_PATH")
fi
readonly -a derived_data_args

usage() {
  cat <<'EOF'
Usage: scripts/ios-simulator.sh <command>

Commands:
  bootstrap          Install the configured iOS runtime and default Briar simulators.
  build-for-testing  Build the Briar unit and UI test bundles for iOS Simulator.
  build-production   Analyze and build the unsigned Production simulator app.
  test               Run the Briar unit and UI tests on the configured iPhone simulator.
  test-ipad-accessibility
                     Run the focused accessibility and large-text UI test on iPad.
EOF
}

log() {
  printf '[ios-simulator] %s\n' "$*"
}

fail() {
  printf '[ios-simulator] ERROR: %s\n' "$*" >&2
  exit 1
}

require_xcode() {
  [[ -x "$xcodebuild_bin" ]] || fail "Full Xcode is not installed."
  [[ -x "$xcode_select_bin" ]] || fail "xcode-select is unavailable."
  [[ -x "$xcrun_bin" ]] || fail "xcrun is unavailable."

  local developer_dir
  developer_dir="$("$xcode_select_bin" -p)"
  [[ -x "$developer_dir/usr/bin/xcodebuild" ]] ||
    fail "Selected developer directory is not a full Xcode installation: $developer_dir"

  export DEVELOPER_DIR="$developer_dir"

  if ! "$xcodebuild_bin" -checkFirstLaunchStatus >/dev/null; then
    fail "Xcode first-launch tasks are incomplete. Run: sudo xcodebuild -runFirstLaunch"
  fi
}

runtime_is_available() {
  local runtimes
  runtimes="$("$xcrun_bin" simctl list runtimes available)"
  [[ "$runtimes" == *"$ios_runtime_identifier"* ]]
}

device_type_is_available() {
  local device_type="$1"
  local device_types

  device_types="$("$xcrun_bin" simctl list devicetypes)"
  [[ "$device_types" == *"($device_type)"* ]]
}

device_is_available() {
  local device_name="$1"
  local devices

  devices="$("$xcrun_bin" simctl list devices "$ios_runtime_identifier")"
  [[ "$devices" == *"$device_name ("* ]]
}

ensure_device() {
  local device_name="$1"
  local device_type="$2"

  if device_is_available "$device_name"; then
    log "Simulator already available: $device_name"
    return
  fi

  if ! device_type_is_available "$device_type"; then
    fail "Simulator device type is unavailable in the selected Xcode: $device_type"
  fi

  local device_identifier
  device_identifier="$(
    "$xcrun_bin" simctl create \
      "$device_name" \
      "$device_type" \
      "$ios_runtime_identifier"
  )"

  log "Created simulator: $device_name ($device_identifier)"
}

require_runtime() {
  runtime_is_available ||
    fail "iOS $ios_runtime_version Simulator runtime is unavailable. Run: bun run ios:bootstrap"
}

require_default_device() {
  local destination_override="$1"
  local device_name="$2"

  if [[ -z "$destination_override" ]] && ! device_is_available "$device_name"; then
    fail "Simulator $device_name is unavailable for iOS $ios_runtime_version. Run: bun run ios:bootstrap"
  fi
}

bootstrap() {
  require_xcode

  log "Using developer directory: $DEVELOPER_DIR"
  "$xcodebuild_bin" -version

  if runtime_is_available; then
    log "Simulator runtime already available: iOS $ios_runtime_version"
  else
    log "Downloading and installing the iOS $ios_runtime_version Simulator runtime."
    "$xcodebuild_bin" \
      -downloadPlatform iOS \
      -buildVersion "$ios_runtime_version" \
      -architectureVariant arm64

    runtime_is_available ||
      fail "Xcode completed the download, but runtime $ios_runtime_identifier is unavailable."
  fi

  if [[ -z "$iphone_destination_overridden" ]]; then
    ensure_device "$iphone_name" "$iphone_type"
  else
    log "Using caller-provided iPhone destination; default simulator creation skipped."
  fi

  if [[ -z "$ipad_destination_overridden" ]]; then
    ensure_device "$ipad_name" "$ipad_type"
  else
    log "Using caller-provided iPad destination; default simulator creation skipped."
  fi

  log "Available Briar simulator destinations:"
  "$xcrun_bin" simctl list devices available |
    /usr/bin/grep -F -e "$iphone_name" -e "$ipad_name" || true

  log "iOS Simulator bootstrap complete."
}

build_for_testing() {
  require_xcode
  require_runtime
  cd "$workspace_root"

  "$xcodebuild_bin" \
    -project "$swift_project" \
    -scheme "$swift_dev_scheme" \
    -configuration 'Dev Debug' \
    -destination "$generic_simulator_destination" \
    "${derived_data_args[@]}" \
    CODE_SIGNING_ALLOWED=NO \
    build-for-testing
}

run_tests() {
  require_xcode
  require_runtime
  require_default_device "$iphone_destination_overridden" "$iphone_name"
  cd "$workspace_root"

  "$xcodebuild_bin" \
    -project "$swift_project" \
    -scheme "$swift_dev_scheme" \
    -destination "$iphone_destination" \
    "${derived_data_args[@]}" \
    CODE_SIGNING_ALLOWED=NO \
    test
}

run_ipad_accessibility_test() {
  require_xcode
  require_runtime
  require_default_device "$ipad_destination_overridden" "$ipad_name"
  cd "$workspace_root"

  "$xcodebuild_bin" \
    -project "$swift_project" \
    -scheme "$swift_dev_scheme" \
    -destination "$ipad_destination" \
    "${derived_data_args[@]}" \
    -only-testing:BriarCompanionUITests/BriarCompanionUITests/testAccessibilityAndLargestDynamicTypeLayout \
    CODE_SIGNING_ALLOWED=NO \
    test
}

build_production() {
  require_xcode
  require_runtime
  cd "$workspace_root"

  "$xcodebuild_bin" \
    -project "$swift_project" \
    -scheme "$swift_production_scheme" \
    -configuration Production \
    -destination "$generic_simulator_destination" \
    "${derived_data_args[@]}" \
    CODE_SIGNING_ALLOWED=NO \
    analyze build
}

case "${1:-}" in
  bootstrap) bootstrap ;;
  build-for-testing) build_for_testing ;;
  build-production) build_production ;;
  test) run_tests ;;
  test-ipad-accessibility) run_ipad_accessibility_test ;;
  -h | --help | help) usage ;;
  *)
    usage >&2
    exit 64
    ;;
esac
