#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$workspace_root"

readonly rust_toolchain="1.96.0"
readonly cargo_audit_version="0.22.2"
readonly gitleaks_version="8.30.1"
readonly all_contexts=("app-worker" "d1-migrations" "rust" "security")

selected_contexts=()
should_signoff=false
ci_temp=""
ci_temp_base="${TMPDIR:-/tmp}"
ci_temp_base="${ci_temp_base%/}"
timing_file=""
ci_started_at=0

usage() {
  cat <<'EOF'
Usage: scripts/ci-local.sh [--signoff] [all|app-worker|d1-migrations|rust|security ...]

Runs all repository CI checks locally. The default is all contexts.
Pass --signoff only after committing and pushing the exact revision under test.
EOF
}

fail() {
  echo "[local-ci] $*" >&2
  exit 1
}

timing_init() {
  timing_file="${BRIAR_CI_TIMING_FILE:-$ci_temp/timing.tsv}"
  : >"$timing_file"
}

# Appends one row to the shared timing file. Safe from parallel subshells:
# every row is a single short append.
timing_record() {
  local context="$1"
  local label="$2"
  local seconds="$3"
  local status="$4"
  echo "[local-ci] [timing] ${context} ${label} ${seconds}s ${status}" >&2
  [[ -n "$timing_file" ]] || return 0
  printf '%s\t%s\t%s\t%s\n' "$context" "$label" "$seconds" "$status" >>"$timing_file"
}

timed() {
  local context="$1"
  local label="$2"
  shift 2
  local started
  local elapsed
  started="$(date +%s)"
  if "$@"; then
    elapsed="$(($(date +%s) - started))"
    timing_record "$context" "$label" "$elapsed" "ok"
    return 0
  fi
  elapsed="$(($(date +%s) - started))"
  timing_record "$context" "$label" "$elapsed" "fail"
  return 1
}

timing_summary() {
  [[ -n "$timing_file" && -s "$timing_file" ]] || return 0
  echo
  echo "[local-ci] === timing: steps (slowest first) ==="
  awk -F'\t' \
    '$2 != "context-total" && $2 != "run-total" {
       printf "%6ds  %-16s %-44s %s\n", $3, $1, $2, $4
     }' "$timing_file" | sort -rn
  echo
  echo "[local-ci] === timing: contexts and total ==="
  awk -F'\t' \
    '$2 == "context-total" || $2 == "run-total" {
       printf "%6ds  %-16s %-44s %s\n", $3, $1, $2, $4
     }' "$timing_file" | sort -rn
  echo "[local-ci] timing file: ${timing_file}"
}

cleanup() {
  local exit_code="$?"
  if [[ "$ci_started_at" -gt 0 ]]; then
    timing_record "run" "run-total" "$(($(date +%s) - ci_started_at))" \
      "$([[ "$exit_code" -eq 0 ]] && echo ok || echo fail)"
  fi
  timing_summary
  if [[ -n "$ci_temp" ]]; then
    case "$ci_temp" in
      "$ci_temp_base"/briar-local-ci.*) rm -rf -- "$ci_temp" ;;
      *) echo "[local-ci] Refusing to clean unexpected path: $ci_temp" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

require_command() {
  local command_name="$1"
  local install_hint="$2"
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "Missing ${command_name}. ${install_hint}"
}

includes_context() {
  local expected="$1"
  local context
  for context in "${selected_contexts[@]}"; do
    [[ "$context" == "$expected" ]] && return 0
  done
  return 1
}

run_context() {
  local context="$1"
  shift
  echo
  echo "[local-ci] === ${context} ==="
  timed "$context" "context-total" "$@"
  echo "[local-ci] ✓ ${context}"
}

run_app_worker() {
  if [[ -d .github/workflows ]] &&
    find .github/workflows -type f -print -quit | grep -q .; then
    fail "GitHub Actions workflows are not allowed; use the local CI and release scripts."
  fi
  timed app-worker check bun run check
  timed app-worker managed-computer-image-check bun run managed-computer:image:check
  timed app-worker qa-managed-computer-health \
    bash scripts/qa-managed-computer-health.sh
  timed app-worker test bun run test
  timed app-worker shell-syntax bash -n \
    scripts/import-apple-signing-assets.sh \
    scripts/ci-mobile.sh \
    scripts/ios-simulator.sh \
    scripts/release-ios.sh \
    scripts/verify-ios-archive.sh \
    scripts/package-macos-release.sh \
    scripts/package-production-release.sh \
    scripts/release-macos-candidate.sh \
    scripts/release-macos-production.sh \
    scripts/verify-bundled-runtime.sh \
    scripts/qa-production-updater-build.sh \
    scripts/qa-macos-lifecycle.sh \
    scripts/qa-managed-computer-health.sh \
    scripts/release-cargo-cache.sh \
    infrastructure/managed-computers/assert-debian-13-x86_64 \
    infrastructure/managed-computers/bootstrap-ssm.sh.tftpl \
    infrastructure/managed-computers/briar \
    infrastructure/managed-computers/briar-managed-computer-health \
    infrastructure/managed-computers/briar-managed-enroll \
    infrastructure/managed-computers/briar-remote-desktop \
    infrastructure/managed-computers/build-managed-computer-image \
    infrastructure/managed-computers/configure-debian-snapshot \
    infrastructure/managed-computers/install-image-runtime \
    infrastructure/managed-computers/install-remote-desktop \
    infrastructure/managed-computers/prepare-image-artifacts \
    infrastructure/managed-computers/prepare-image-for-capture \
    infrastructure/managed-computers/resolve-remote-desktop-packages \
    infrastructure/managed-computers/verify-managed-image \
    infrastructure/managed-computers/verify-remote-desktop
  timed app-worker ios-release-verify bun run ios:release:verify
  timed app-worker build bun run build
  timed app-worker build-release bun run build:release
  timed app-worker worker-check bun run worker:check
  timed app-worker worker-build bun run worker:build
  timed app-worker worker-startup bun run worker:startup
}

run_d1_migrations() {
  local d1_state_dir
  d1_state_dir="$(mktemp -d "${TMPDIR:-/tmp}/briar-local-ci-d1.XXXXXX")"
  trap 'rm -rf "$d1_state_dir"' RETURN

  timed d1-migrations migrate-local \
    bun run d1:migrate:local -- --persist-to "$d1_state_dir"
  timed d1-migrations test-migrations bun run test:d1:migrations

  rm -rf "$d1_state_dir"
  trap - RETURN
}

run_rust() {
  timed rust toolchain-install \
    rustup toolchain install "$rust_toolchain" \
    --profile minimal \
    --component rustfmt,clippy
  timed rust cargo-fmt \
    rustup run "$rust_toolchain" cargo fmt \
    --manifest-path apps/briar/src-tauri/Cargo.toml --all --check
  timed rust cargo-clippy \
    rustup run "$rust_toolchain" cargo clippy \
    --manifest-path apps/briar/src-tauri/Cargo.toml \
    --all-targets \
    -- \
    -D warnings
  timed rust cargo-test \
    rustup run "$rust_toolchain" cargo test \
    --manifest-path apps/briar/src-tauri/Cargo.toml
}

run_security() {
  local detected_cargo_audit_version
  local detected_gitleaks_version

  detected_cargo_audit_version="$(cargo-audit --version)"
  [[ "$detected_cargo_audit_version" == "cargo-audit ${cargo_audit_version}" ]] ||
    fail "Expected cargo-audit ${cargo_audit_version}, found ${detected_cargo_audit_version}."

  detected_gitleaks_version="$(gitleaks version)"
  [[ "$detected_gitleaks_version" == "$gitleaks_version" ]] ||
    fail "Expected gitleaks ${gitleaks_version}, found ${detected_gitleaks_version}."

  timed security audit-dependencies bun run audit:dependencies
  timed security audit-rust bun run audit:rust
  timed security secrets-verify-encrypted bun run secrets:verify-encrypted
  timed security gitleaks gitleaks git \
    --config .gitleaks.toml \
    --redact \
    --no-banner \
    --log-opts="--all" \
    .
}

context_runner() {
  case "$1" in
    app-worker) echo run_app_worker ;;
    d1-migrations) echo run_d1_migrations ;;
    rust) echo run_rust ;;
    security) echo run_security ;;
    *) fail "Unknown CI context: $1" ;;
  esac
}

prepare_parallel_inputs() {
  if includes_context rust; then
    echo
    echo "[local-ci] === shared build inputs ==="
    timed shared-inputs runtime-prepare bun run runtime:prepare
    timed shared-inputs cli-build bun run cli:build
    timed shared-inputs agent-build bun run agent:build
    echo "[local-ci] ✓ shared build inputs"
  fi
}

run_selected_contexts() {
  local context
  local runner
  local log_path
  local index
  local pid
  local failed=false
  local contexts_to_run=("${selected_contexts[@]}")
  local pids=()
  local logs=()

  if includes_context app-worker && includes_context d1-migrations; then
    echo
    echo "[local-ci] Running d1-migrations before the parallel contexts."
    run_context d1-migrations run_d1_migrations
    contexts_to_run=()
    for context in "${selected_contexts[@]}"; do
      [[ "$context" == "d1-migrations" ]] || contexts_to_run+=("$context")
    done
  fi

  if [[ "${BRIAR_CI_SERIAL_CONTEXTS:-false}" == "true" ]]; then
    echo
    echo "[local-ci] Running ${#contexts_to_run[@]} context(s) serially."
    for context in "${contexts_to_run[@]}"; do
      runner="$(context_runner "$context")"
      run_context "$context" "$runner"
    done
    return
  fi

  echo
  echo "[local-ci] Running ${#contexts_to_run[@]} context(s) in parallel."

  for context in "${contexts_to_run[@]}"; do
    runner="$(context_runner "$context")"
    log_path="$ci_temp/${context}.log"
    logs+=("$log_path")
    (
      run_context "$context" "$runner"
    ) >"$log_path" 2>&1 &
    pid="$!"
    pids+=("$pid")
    echo "[local-ci] Started ${context} (pid ${pid})."
  done

  for index in "${!contexts_to_run[@]}"; do
    if ! wait "${pids[$index]}"; then
      failed=true
    fi
    cat "${logs[$index]}"
  done

  if [[ "$failed" == true ]]; then
    fail "One or more CI contexts failed."
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --signoff)
      should_signoff=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    all)
      selected_contexts=("${all_contexts[@]}")
      ;;
    app-worker|d1-migrations|rust|security)
      selected_contexts+=("$1")
      ;;
    *)
      usage >&2
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

if [[ ${#selected_contexts[@]} -eq 0 ]]; then
  selected_contexts=("${all_contexts[@]}")
fi

require_command bun "Install Bun before running local CI."
require_command rustup "Install rustup before running the Rust checks."

if includes_context security; then
  require_command cargo-audit \
    "Run: cargo install cargo-audit --version ${cargo_audit_version} --locked"
  require_command gitleaks \
    "Install gitleaks ${gitleaks_version}: https://github.com/gitleaks/gitleaks"
fi

if $should_signoff; then
  require_command gh "Install the GitHub CLI and authenticate it."
  gh extension list | grep -q '^gh signoff' ||
    fail "Install gh-signoff first: gh extension install basecamp/gh-signoff"
fi

ci_temp="$(mktemp -d "$ci_temp_base/briar-local-ci.XXXXXX")"
timing_init
ci_started_at="$(date +%s)"

timed setup bun-install bun install --frozen-lockfile

prepare_parallel_inputs
run_selected_contexts

if $should_signoff; then
  gh signoff "${selected_contexts[@]}"
else
  echo
  echo "[local-ci] All selected checks passed."
  echo "[local-ci] After committing and pushing, run: bun run ci:signoff"
fi
